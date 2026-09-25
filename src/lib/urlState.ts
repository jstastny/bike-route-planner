import type { LatLon } from './geo';
import { BICYCLE_TYPES, type BicycleType, type RouteOptions } from './types';

export interface UrlState {
  start?: LatLon;
  end?: LatLon;
  waypoints?: LatLon[];
  options?: Partial<RouteOptions>;
}

const fmt = (p: LatLon) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;

function parsePoint(s: string | null | undefined): LatLon | undefined {
  if (!s) return undefined;
  const [a, b] = s.split(',').map(Number);
  if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return undefined;
  return { lat: a, lon: b };
}

function parseUnit(s: string | null): number | undefined {
  if (s === null) return undefined;
  const v = Number(s);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : undefined;
}

export function serializeState(
  start: LatLon,
  end: LatLon,
  waypoints: LatLon[],
  options: RouteOptions,
): string {
  const parts = [`s=${fmt(start)}`, `e=${fmt(end)}`];
  if (waypoints.length) parts.push(`w=${waypoints.map(fmt).join(';')}`);
  parts.push(`bt=${options.bicycleType}`, `ur=${options.useRoads}`, `uh=${options.useHills}`);
  return `#${parts.join('&')}`;
}

export function parseState(hash: string): UrlState {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const state: UrlState = {};
  state.start = parsePoint(params.get('s'));
  state.end = parsePoint(params.get('e'));
  const w = params.get('w');
  if (w) state.waypoints = w.split(';').map(parsePoint).filter((p): p is LatLon => !!p);
  const options: Partial<RouteOptions> = {};
  const bt = params.get('bt');
  if (bt && (BICYCLE_TYPES as string[]).includes(bt)) options.bicycleType = bt as BicycleType;
  const ur = parseUnit(params.get('ur'));
  if (ur !== undefined) options.useRoads = ur;
  const uh = parseUnit(params.get('uh'));
  if (uh !== undefined) options.useHills = uh;
  state.options = options;
  return state;
}
