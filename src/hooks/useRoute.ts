import { useEffect, useState } from 'react';
import type { LatLon } from '../lib/geo';
import type { RouteOptions } from '../lib/types';
import { type Route, fetchRoute } from '../lib/valhalla';

export interface RouteState {
  route: Route | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetch a Valhalla bicycle route whenever the points or options change.
 * Debounced (300 ms) and stale requests are aborted. The previous route stays
 * visible while a new one loads.
 */
export function useRoute(points: LatLon[], options: RouteOptions, debounceMs = 300): RouteState {
  const [state, setState] = useState<RouteState>({ route: null, loading: false, error: null });
  const key = JSON.stringify({ points: points.map((p) => [p.lat, p.lon]), options });

  useEffect(() => {
    const { points: pts, options: opts } = JSON.parse(key) as {
      points: [number, number][];
      options: RouteOptions;
    };
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    const timer = window.setTimeout(() => {
      fetchRoute(
        pts.map(([lat, lon]) => ({ lat, lon })),
        opts,
        ctrl.signal,
      )
        .then((route) => {
          if (!ctrl.signal.aborted) setState({ route, loading: false, error: null });
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          const msg = e instanceof Error ? e.message : String(e);
          setState((s) => ({ ...s, loading: false, error: msg }));
        });
    }, debounceMs);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [key, debounceMs]);

  return state;
}
