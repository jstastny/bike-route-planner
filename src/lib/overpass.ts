import { type BBox, bboxContains } from './geo';
import type { OsmData, OsmNode, OsmWay } from './osm';

export interface OverpassEndpoint {
  url: string;
  /** GET lets Vercel's CDN cache the proxy response; mirrors are queried by POST. */
  method: 'GET' | 'POST';
}

/**
 * Order matters. The same-origin proxy (api/overpass.ts) goes first: it sends
 * an identifying User-Agent, rotates mirrors server-side and caches on the CDN.
 * The direct mirrors are a last resort if the proxy itself is unavailable;
 * overpass-api.de is deliberately absent because it answers browser
 * User-Agents with HTTP 406 and no CORS headers.
 */
export const OVERPASS_ENDPOINTS: OverpassEndpoint[] = [
  { url: '/api/overpass', method: 'GET' },
  { url: 'https://overpass.kumi.systems/api/interpreter', method: 'POST' },
  { url: 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', method: 'POST' },
];

/** Overpass QL for stop signs, signals, signalised crossings and their parent highway ways. */
export function buildQuery(b: BBox): string {
  const box = [b.south, b.west, b.north, b.east].map((v) => v.toFixed(6)).join(',');
  return [
    '[out:json][timeout:25];',
    '(',
    `node["highway"="stop"](${box});`,
    `node["highway"="traffic_signals"](${box});`,
    `node["highway"="crossing"]["crossing"="traffic_signals"](${box});`,
    ')->.n;',
    '.n out;',
    'way(bn.n)["highway"];',
    'out geom;',
  ].join('');
}

interface OverpassElementNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}
interface OverpassElementWay {
  type: 'way';
  id: number;
  nodes?: number[];
  geometry?: ({ lat: number; lon: number } | null)[];
  tags?: Record<string, string>;
}
interface OverpassResponse {
  elements?: (OverpassElementNode | OverpassElementWay | { type: string })[];
  remark?: string;
}

export function parseOverpass(json: OverpassResponse): OsmData {
  const nodes: OsmNode[] = [];
  const ways: OsmWay[] = [];
  for (const el of json.elements ?? []) {
    if (el.type === 'node') {
      const n = el as OverpassElementNode;
      nodes.push({ id: n.id, lat: n.lat, lon: n.lon, tags: n.tags ?? {} });
    } else if (el.type === 'way') {
      const w = el as OverpassElementWay;
      if (!w.nodes || !w.geometry || w.geometry.some((g) => g === null)) continue;
      ways.push({
        id: w.id,
        nodes: w.nodes,
        geometry: w.geometry as { lat: number; lon: number }[],
        tags: w.tags ?? {},
      });
    }
  }
  return { nodes, ways };
}

/**
 * Per-endpoint wall-clock limit. The public Overpass servers sometimes queue a
 * request for a long time without answering; without this the UI would sit on
 * "Counting..." forever instead of trying the mirror.
 */
export const OVERPASS_REQUEST_TIMEOUT_MS = 60_000;

/** Try each Overpass endpoint in turn; throws if all fail. */
export async function fetchOverpass(
  b: BBox,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = OVERPASS_REQUEST_TIMEOUT_MS,
): Promise<OsmData> {
  const params = new URLSearchParams({ data: buildQuery(b) }).toString();
  const errors: string[] = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const label = endpoint.url.startsWith('/') ? 'proxy' : new URL(endpoint.url).host;
    // Combine the caller's abort signal with a per-attempt timeout.
    const attempt = new AbortController();
    const onOuterAbort = () => attempt.abort();
    signal?.addEventListener('abort', onOuterAbort, { once: true });
    const timer = setTimeout(() => attempt.abort(), timeoutMs);
    try {
      const res =
        endpoint.method === 'GET'
          ? await fetchImpl(`${endpoint.url}?${params}`, { method: 'GET', signal: attempt.signal })
          : await fetchImpl(endpoint.url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: params,
              signal: attempt.signal,
            });
      if (!res.ok) {
        let detail = '';
        try {
          const err = (await res.json()) as { error?: string };
          if (err.error) detail = ` (${err.error})`;
        } catch {
          /* body was not JSON */
        }
        errors.push(`${label}: HTTP ${res.status}${detail}`);
        continue;
      }
      const json = (await res.json()) as OverpassResponse;
      if (json.remark && /runtime error|timed out/i.test(json.remark)) {
        errors.push(`${label}: ${json.remark}`);
        continue;
      }
      return parseOverpass(json);
    } catch (e) {
      if (signal?.aborted) throw e;
      const msg = attempt.signal.aborted
        ? `timed out after ${Math.round(timeoutMs / 1000)}s`
        : e instanceof Error
          ? e.message
          : String(e);
      errors.push(`${label}: ${msg}`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }
  }
  throw new Error(`Overpass query failed (${errors.join('; ')})`);
}

/**
 * Cache of Overpass results keyed by the fetched bbox. A request is served
 * from cache when a previously fetched bbox fully contains it, so small drags
 * of waypoints do not trigger new queries.
 */
export class OverpassCache {
  private entries: { bbox: BBox; data: OsmData }[] = [];
  constructor(private readonly maxEntries = 8) {}

  get(b: BBox): OsmData | undefined {
    return this.entries.find((e) => bboxContains(e.bbox, b))?.data;
  }

  set(b: BBox, data: OsmData): void {
    this.entries.unshift({ bbox: b, data });
    if (this.entries.length > this.maxEntries) this.entries.pop();
  }
}
