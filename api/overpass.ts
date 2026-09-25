/**
 * Vercel serverless proxy for the Overpass API.
 *
 * Why this exists: the public Overpass servers reject requests carrying a
 * generic browser User-Agent (HTTP 406 without CORS headers, which the browser
 * reports as a CORS failure) and are frequently overloaded (504). Running the
 * request server-side lets us send an identifying User-Agent as the Overpass
 * usage policy asks, rotate through several mirrors, and cache successful
 * answers on Vercel's CDN so the same bbox is fetched from Overpass only once
 * a day instead of on every page load.
 *
 * Usage: GET /api/overpass?data=<Overpass QL>   (GET so the CDN can cache it)
 *        POST /api/overpass with form body data=<Overpass QL>
 */

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const USER_AGENT = 'bike-route-planner/1.0 (+https://github.com/jstastny/bike-route-planner)';
const PER_MIRROR_TIMEOUT_MS = 45_000;
const TOTAL_BUDGET_MS = 170_000;
const MAX_QUERY_LENGTH = 4_000;

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function jsonResponse(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store', ...extra },
  });
}

async function readQuery(request: Request): Promise<string | null> {
  const url = new URL(request.url);
  if (request.method === 'GET') return url.searchParams.get('data');
  if (request.method === 'POST') {
    const text = await request.text();
    return new URLSearchParams(text).get('data');
  }
  return null;
}

/** Only allow the kind of query this app sends: JSON output, bounded size. */
function isAllowedQuery(q: string): boolean {
  return q.length > 0 && q.length <= MAX_QUERY_LENGTH && q.trimStart().startsWith('[out:json]');
}

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, { Allow: 'GET, POST' });
  }
  const query = await readQuery(request);
  if (!query || !isAllowedQuery(query)) {
    return jsonResponse({ error: 'Missing or invalid Overpass query in "data"' }, 400);
  }

  const started = Date.now();
  const errors: string[] = [];
  const body = new URLSearchParams({ data: query }).toString();

  for (const mirror of MIRRORS) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - started);
    if (remaining < 5_000) break;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(PER_MIRROR_TIMEOUT_MS, remaining));
    const host = new URL(mirror).host;
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        body,
        signal: ctrl.signal,
      });
      if (!res.ok) {
        errors.push(`${host}: HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      let parsed: { remark?: string; elements?: unknown[] };
      try {
        parsed = JSON.parse(text) as typeof parsed;
      } catch {
        errors.push(`${host}: non-JSON response`);
        continue;
      }
      if (parsed.remark && /runtime error|timed out/i.test(parsed.remark)) {
        errors.push(`${host}: ${parsed.remark}`);
        continue;
      }
      return new Response(text, {
        status: 200,
        headers: {
          ...JSON_HEADERS,
          // Cache on Vercel's CDN for a day; serve stale for a week while revalidating.
          'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
          'X-Overpass-Mirror': host,
        },
      });
    } catch (e) {
      errors.push(
        ctrl.signal.aborted
          ? `${host}: timed out`
          : `${host}: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return jsonResponse({ error: `All Overpass mirrors failed (${errors.join('; ')})` }, 502);
}

export const GET = handler;
export const POST = handler;
