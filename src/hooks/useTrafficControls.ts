import { useEffect, useMemo, useRef, useState } from 'react';
import { type BBox, bboxContains, bboxOf, padBBox } from '../lib/geo';
import { OverpassCache, fetchOverpass } from '../lib/overpass';
import type { OsmData } from '../lib/osm';
import { type TrafficControlResult, matchTrafficControls } from '../lib/signals';
import type { Route } from '../lib/valhalla';

/** Padding around the route bbox that the matching needs (m). */
const MATCH_PAD_M = 50;
/**
 * Extra padding when fetching, so that small route edits stay inside an
 * already-fetched bbox and are served from cache.
 */
const FETCH_PAD_M = 300;

export interface TrafficControlsState {
  result: TrafficControlResult | null;
  loading: boolean;
  error: string | null;
}

export function useTrafficControls(route: Route | null, debounceMs = 400): TrafficControlsState {
  const cache = useRef(new OverpassCache());
  const [data, setData] = useState<{ bbox: BBox; data: OsmData } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needed = useMemo(
    () => (route && route.shape.length > 1 ? padBBox(bboxOf(route.shape), MATCH_PAD_M) : null),
    [route],
  );

  useEffect(() => {
    if (!needed) return;
    const cached = cache.current.get(needed);
    if (cached) {
      setData((d) => (d?.data === cached ? d : { bbox: needed, data: cached }));
      setLoading(false);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const fetchBox = padBBox(needed, FETCH_PAD_M);
    const timer = window.setTimeout(() => {
      fetchOverpass(fetchBox, ctrl.signal)
        .then((osm) => {
          if (ctrl.signal.aborted) return;
          cache.current.set(fetchBox, osm);
          setData({ bbox: fetchBox, data: osm });
          setError(null);
          setLoading(false);
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        });
    }, debounceMs);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [needed, debounceMs]);

  const result = useMemo(() => {
    if (!route || !needed || !data || !bboxContains(data.bbox, needed)) return null;
    return matchTrafficControls(route.shape, data.data);
  }, [route, needed, data]);

  return { result, loading, error };
}
