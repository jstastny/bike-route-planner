import { type LatLon, decodePolyline } from './geo';
import type { RouteOptions } from './types';

export const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';

export interface Maneuver {
  instruction: string;
  streetNames: string[];
  /** miles */
  length: number;
  /** seconds */
  time: number;
  type: number;
  legIndex: number;
  /** Index into the concatenated route shape. */
  shapeIndex: number;
}

export interface Route {
  /** Full route geometry (all legs concatenated, duplicate joints removed). */
  shape: LatLon[];
  /** Geometry of each leg (between consecutive break locations). */
  legs: LatLon[][];
  /** Miles. */
  lengthMiles: number;
  /** Seconds. */
  timeSeconds: number;
  maneuvers: Maneuver[];
}

interface ValhallaManeuver {
  instruction: string;
  street_names?: string[];
  length: number;
  time: number;
  type: number;
  begin_shape_index: number;
}

interface ValhallaLeg {
  shape: string;
  maneuvers: ValhallaManeuver[];
}

interface ValhallaResponse {
  trip?: {
    legs: ValhallaLeg[];
    summary: { length: number; time: number };
  };
  error?: string;
  error_code?: number;
}

export type LocationType = 'break' | 'through';

export function buildRouteRequest(
  points: LatLon[],
  options: RouteOptions,
  intermediateType: LocationType = 'through',
): object {
  return {
    locations: points.map((p, i) => ({
      lat: Number(p.lat.toFixed(6)),
      lon: Number(p.lon.toFixed(6)),
      type: i === 0 || i === points.length - 1 ? 'break' : intermediateType,
    })),
    costing: 'bicycle',
    costing_options: {
      bicycle: {
        bicycle_type: options.bicycleType,
        use_roads: options.useRoads,
        use_hills: options.useHills,
      },
    },
    directions_options: { units: 'miles' },
  };
}

/**
 * Parse a Valhalla response. With `through` intermediate locations Valhalla
 * returns a single leg; we then split it at the shape points closest to the
 * waypoints so that each "leg" still spans consecutive user points (needed
 * to decide where a newly clicked waypoint goes).
 */
export function parseRouteResponse(json: ValhallaResponse, points: LatLon[]): Route {
  if (!json.trip) throw new Error(json.error ?? 'No route found');
  const shape: LatLon[] = [];
  const rawLegs: LatLon[][] = [];
  const maneuvers: Maneuver[] = [];
  json.trip.legs.forEach((leg, legIndex) => {
    const pts = decodePolyline(leg.shape, 6);
    rawLegs.push(pts);
    const offset = shape.length === 0 ? 0 : shape.length - 1;
    if (shape.length === 0) shape.push(...pts);
    else shape.push(...pts.slice(1));
    for (const m of leg.maneuvers) {
      // Skip the "arrive"/"depart" pair at internal break points.
      maneuvers.push({
        instruction: m.instruction,
        streetNames: m.street_names ?? [],
        length: m.length,
        time: m.time,
        type: m.type,
        legIndex,
        shapeIndex: offset + m.begin_shape_index,
      });
    }
  });
  const legs = rawLegs.length === points.length - 1 ? rawLegs : splitIntoLegs(shape, points);
  return {
    shape,
    legs,
    lengthMiles: json.trip.summary.length,
    timeSeconds: json.trip.summary.time,
    maneuvers,
  };
}

/** Split a shape into consecutive pieces at the (in-order) vertices nearest to each intermediate point. */
export function splitIntoLegs(shape: LatLon[], points: LatLon[]): LatLon[][] {
  const cuts: number[] = [0];
  let from = 0;
  for (let k = 1; k < points.length - 1; k++) {
    const p = points[k]!;
    let best = from;
    let bestD = Infinity;
    for (let i = from; i < shape.length; i++) {
      const s = shape[i]!;
      const d = (s.lat - p.lat) ** 2 + ((s.lon - p.lon) * Math.cos((p.lat * Math.PI) / 180)) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    cuts.push(best);
    from = best;
  }
  cuts.push(shape.length - 1);
  const legs: LatLon[][] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const piece = shape.slice(cuts[i]!, cuts[i + 1]! + 1);
    legs.push(piece.length >= 2 ? piece : [shape[cuts[i]!]!, shape[cuts[i]!]!]);
  }
  return legs;
}

async function requestRoute(
  points: LatLon[],
  options: RouteOptions,
  intermediateType: LocationType,
  signal?: AbortSignal,
): Promise<ValhallaResponse> {
  const body = buildRouteRequest(points, options, intermediateType);
  const url = `${VALHALLA_URL}?json=${encodeURIComponent(JSON.stringify(body))}`;
  const res = await fetch(url, { signal });
  let json: ValhallaResponse;
  try {
    json = (await res.json()) as ValhallaResponse;
  } catch {
    throw new Error(`Routing server error (HTTP ${res.status})`);
  }
  if (!res.ok && !json.error) json.error = `Routing server error (HTTP ${res.status})`;
  return json;
}

/**
 * Fetch a bicycle route through all points. Intermediate waypoints are sent
 * as `through` (no forced stop / U-turn); if the server rejects that we fall
 * back to `break`.
 */
export async function fetchRoute(
  points: LatLon[],
  options: RouteOptions,
  signal?: AbortSignal,
): Promise<Route> {
  if (points.length < 2) throw new Error('Need at least two points');
  let json = await requestRoute(points, options, 'through', signal);
  if (!json.trip && points.length > 2) {
    json = await requestRoute(points, options, 'break', signal);
  }
  if (!json.trip) throw new Error(json.error ?? 'No route found');
  return parseRouteResponse(json, points);
}
