import { describe, expect, it } from 'vitest';
import { fetchOverpass, OVERPASS_ENDPOINTS } from './overpass';

const bbox = { south: 37.43, west: -122.17, north: 37.46, east: -122.12 };

describe('fetchOverpass timeout', () => {
  it('falls back to the next endpoint when the first one hangs', async () => {
    const calls: string[] = [];
    const fetchImpl = ((url: string, init?: RequestInit) => {
      calls.push(url);
      if (url === OVERPASS_ENDPOINTS[0]) {
        // Never resolve; only reject once the per-attempt signal aborts.
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        });
      }
      return Promise.resolve(
        new Response(JSON.stringify({ elements: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch;

    const data = await fetchOverpass(bbox, undefined, fetchImpl, 20);
    expect(calls).toEqual(OVERPASS_ENDPOINTS);
    expect(data.nodes).toEqual([]);
  });

  it('reports the timeout when every endpoint hangs', async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      })) as unknown as typeof fetch;
    await expect(fetchOverpass(bbox, undefined, fetchImpl, 20)).rejects.toThrow(/timed out/);
  });
});
