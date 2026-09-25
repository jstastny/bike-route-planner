import type { LatLon } from './geo';

export type BicycleType = 'Hybrid' | 'Road' | 'Cross' | 'Mountain';
export const BICYCLE_TYPES: BicycleType[] = ['Hybrid', 'Road', 'Cross', 'Mountain'];

export interface RouteOptions {
  bicycleType: BicycleType;
  /** Valhalla `use_roads`, 0..1 (0 = avoid roads, prefer paths). */
  useRoads: number;
  /** Valhalla `use_hills`, 0..1 (0 = avoid hills). */
  useHills: number;
}

export const DEFAULT_ROUTE_OPTIONS: RouteOptions = {
  bicycleType: 'Hybrid',
  useRoads: 0.5,
  useHills: 0.5,
};

export interface Waypoint extends LatLon {
  id: string;
}

export interface Place extends LatLon {
  label: string;
}

export const DEFAULT_START: Place = {
  lat: 37.430468,
  lon: -122.1312979,
  label: '2746 Cowper St, Palo Alto, CA',
};

export const DEFAULT_END: Place = {
  lat: 37.4537714,
  lon: -122.1643322,
  label: '80 Willow Rd, Menlo Park, CA',
};

let wpCounter = 0;
export function makeWaypoint(p: LatLon): Waypoint {
  wpCounter += 1;
  return { lat: p.lat, lon: p.lon, id: `wp${Date.now().toString(36)}${wpCounter}` };
}
