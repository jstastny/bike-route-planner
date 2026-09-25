import { type LatLon, ProjectedPolyline } from './geo';

/**
 * Where should a new waypoint clicked at `p` go in the ordered waypoint list?
 * Leg i runs from break point i to i+1 (break point 0 = start, break point
 * k = waypoint k-1). Inserting into the nearest leg i means the new waypoint
 * becomes waypoints[i]. Without a route, append.
 */
export function insertionIndex(p: LatLon, legs: LatLon[][] | undefined, waypointCount: number): number {
  if (!legs || legs.length !== waypointCount + 1) return waypointCount;
  let best = waypointCount;
  let bestD = Infinity;
  legs.forEach((leg, i) => {
    if (leg.length === 0) return;
    const d = new ProjectedPolyline(leg).project(p).distance;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

export function insertAt<T>(list: T[], index: number, item: T): T[] {
  return [...list.slice(0, index), item, ...list.slice(index)];
}
