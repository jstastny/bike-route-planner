import { useEffect } from 'react';
import type { LatLon } from '../lib/geo';
import type { RouteOptions } from '../lib/types';
import { serializeState } from '../lib/urlState';

/** Mirror the planner state into the URL hash (debounced, without history entries). */
export function useUrlSync(
  start: LatLon,
  end: LatLon,
  waypoints: LatLon[],
  options: RouteOptions,
  debounceMs = 400,
): void {
  const hash = serializeState(start, end, waypoints, options);
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (window.location.hash !== hash) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
      }
    }, debounceMs);
    return () => window.clearTimeout(t);
  }, [hash, debounceMs]);
}
