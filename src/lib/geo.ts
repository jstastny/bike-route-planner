/**
 * Pure geometry helpers. No browser APIs here, so everything is unit-testable
 * and importable from Node.
 *
 * At the scale of a city bike ride (a few km) an equirectangular "local
 * meters" projection around a fixed origin is accurate to well under 0.1 %,
 * which is far better than OSM node placement accuracy. We use it for all
 * nearest-point / along-route computations and haversine for reported
 * distances between two points.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Mean Earth radius in meters (IUGG). */
export const EARTH_RADIUS_M = 6371008.8;
const DEG = Math.PI / 180;

export function toRad(deg: number): number {
  return deg * DEG;
}

export function toDeg(rad: number): number {
  return rad / DEG;
}

/** Great-circle distance in meters. */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial compass bearing from a to b in degrees, 0 = north, 90 = east, range [0, 360). */
export function bearing(a: LatLon, b: LatLon): number {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return normalizeBearing(toDeg(Math.atan2(y, x)));
}

export function normalizeBearing(deg: number): number {
  const r = deg % 360;
  return r < 0 ? r + 360 : r;
}

/** Smallest absolute difference between two bearings, in [0, 180]. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(normalizeBearing(a) - normalizeBearing(b));
  return d > 180 ? 360 - d : d;
}

/**
 * True when two bearings describe the same line regardless of travel
 * direction, i.e. they differ by at most `tolerance` degrees or are within
 * `tolerance` of being opposite.
 */
export function isParallel(a: number, b: number, tolerance: number): boolean {
  const d = angleDiff(a, b);
  return d <= tolerance || d >= 180 - tolerance;
}

/* ------------------------------------------------------------------------ */
/* Local planar projection                                                   */
/* ------------------------------------------------------------------------ */

export interface XY {
  x: number;
  y: number;
}

/** Equirectangular projection to meters around a fixed origin. */
export class LocalProjection {
  readonly origin: LatLon;
  private readonly kx: number;
  private readonly ky: number;

  constructor(origin: LatLon) {
    this.origin = origin;
    this.ky = EARTH_RADIUS_M * DEG;
    this.kx = this.ky * Math.cos(toRad(origin.lat));
  }

  toXY(p: LatLon): XY {
    return { x: (p.lon - this.origin.lon) * this.kx, y: (p.lat - this.origin.lat) * this.ky };
  }

  toLatLon(p: XY): LatLon {
    return { lat: this.origin.lat + p.y / this.ky, lon: this.origin.lon + p.x / this.kx };
  }
}

/** Planar bearing (0 = north / +y, clockwise) between two projected points. */
export function bearingXY(a: XY, b: XY): number {
  return normalizeBearing(toDeg(Math.atan2(b.x - a.x, b.y - a.y)));
}

export function distXY(a: XY, b: XY): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/* ------------------------------------------------------------------------ */
/* Polylines                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * Decode an encoded polyline (Google algorithm). Valhalla uses precision 6
 * (coordinates * 1e6); Google/OSRM use precision 5.
 */
export function decodePolyline(encoded: string, precision = 6): LatLon[] {
  const factor = 10 ** precision;
  const out: LatLon[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < encoded.length) {
    for (let coord = 0; coord < 2; coord++) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        if (index >= encoded.length) throw new Error('Malformed polyline');
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (coord === 0) lat += delta;
      else lon += delta;
    }
    out.push({ lat: lat / factor, lon: lon / factor });
  }
  return out;
}

/** Encode (used in tests to round-trip). */
export function encodePolyline(points: LatLon[], precision = 6): string {
  const factor = 10 ** precision;
  let prevLat = 0;
  let prevLon = 0;
  let out = '';
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * factor);
    const lon = Math.round(p.lon * factor);
    out += enc(lat - prevLat) + enc(lon - prevLon);
    prevLat = lat;
    prevLon = lon;
  }
  return out;
}

export function bboxOf(points: LatLon[]): BBox {
  if (points.length === 0) throw new Error('bboxOf: empty point list');
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const p of points) {
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
    if (p.lon < west) west = p.lon;
    if (p.lon > east) east = p.lon;
  }
  return { south, west, north, east };
}

/** Grow a bbox by `meters` on every side. */
export function padBBox(b: BBox, meters: number): BBox {
  const dLat = meters / (EARTH_RADIUS_M * DEG);
  const midLat = (b.south + b.north) / 2;
  const dLon = dLat / Math.cos(toRad(midLat));
  return { south: b.south - dLat, west: b.west - dLon, north: b.north + dLat, east: b.east + dLon };
}

export function bboxContains(outer: BBox, inner: BBox): boolean {
  return (
    outer.south <= inner.south &&
    outer.west <= inner.west &&
    outer.north >= inner.north &&
    outer.east >= inner.east
  );
}

/* ------------------------------------------------------------------------ */
/* Projection onto a polyline                                                */
/* ------------------------------------------------------------------------ */

export interface PolylineProjection {
  /** Distance from the query point to the polyline, meters. */
  distance: number;
  /** Index i of the closest segment (points[i] -> points[i+1]). */
  segmentIndex: number;
  /** Position within that segment, 0..1. */
  t: number;
  /** Distance along the polyline from its first point to the projection, meters. */
  along: number;
  /** The projected point. */
  point: LatLon;
}

/**
 * A polyline pre-projected into local meters, with cumulative distances, so
 * that many points can be projected onto it cheaply.
 */
export class ProjectedPolyline {
  readonly points: LatLon[];
  readonly proj: LocalProjection;
  readonly xy: XY[];
  /** cum[i] = distance along the line from points[0] to points[i], meters. */
  readonly cum: number[];

  constructor(points: LatLon[], proj?: LocalProjection) {
    if (points.length === 0) throw new Error('ProjectedPolyline: empty line');
    this.points = points;
    this.proj = proj ?? new LocalProjection(points[0]!);
    this.xy = points.map((p) => this.proj.toXY(p));
    this.cum = [0];
    for (let i = 1; i < this.xy.length; i++) {
      this.cum.push(this.cum[i - 1]! + distXY(this.xy[i - 1]!, this.xy[i]!));
    }
  }

  get length(): number {
    return this.cum[this.cum.length - 1]!;
  }

  /** Nearest point on the polyline to `p`. */
  project(p: LatLon): PolylineProjection {
    return this.projectXY(this.proj.toXY(p));
  }

  projectXY(q: XY): PolylineProjection {
    const n = this.xy.length;
    if (n === 1) {
      const only = this.xy[0]!;
      return { distance: distXY(q, only), segmentIndex: 0, t: 0, along: 0, point: this.points[0]! };
    }
    let best = { d2: Infinity, i: 0, t: 0 };
    for (let i = 0; i < n - 1; i++) {
      const a = this.xy[i]!;
      const b = this.xy[i + 1]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = len2 === 0 ? 0 : ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const px = a.x + t * dx - q.x;
      const py = a.y + t * dy - q.y;
      const d2 = px * px + py * py;
      if (d2 < best.d2) best = { d2, i, t };
    }
    const a = this.xy[best.i]!;
    const b = this.xy[best.i + 1]!;
    const pt = { x: a.x + best.t * (b.x - a.x), y: a.y + best.t * (b.y - a.y) };
    return {
      distance: Math.sqrt(best.d2),
      segmentIndex: best.i,
      t: best.t,
      along: this.cum[best.i]! + best.t * distXY(a, b),
      point: this.proj.toLatLon(pt),
    };
  }

  /** Point located `along` meters from the start (clamped to the line). */
  pointAt(along: number): XY {
    const n = this.xy.length;
    if (n === 1 || along <= 0) return this.xy[0]!;
    if (along >= this.length) return this.xy[n - 1]!;
    // binary search for the segment
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid]! <= along) lo = mid;
      else hi = mid;
    }
    const a = this.xy[lo]!;
    const b = this.xy[lo + 1]!;
    const segLen = this.cum[lo + 1]! - this.cum[lo]!;
    const t = segLen === 0 ? 0 : (along - this.cum[lo]!) / segLen;
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  }

  /**
   * Travel bearing of the line around `along`, measured as the chord from
   * `along - window` to `along + window` (or one-sided with `side`).
   * Using a small window rather than a single segment avoids noise from
   * very short segments in the route geometry.
   */
  bearingAt(along: number, window = 5, side: 'both' | 'before' | 'after' = 'both'): number {
    const from = side === 'after' ? along : along - window;
    const to = side === 'before' ? along : along + window;
    let a = this.pointAt(Math.max(0, from));
    let b = this.pointAt(Math.min(this.length, to));
    if (distXY(a, b) < 0.01) {
      // Degenerate (at an end of the line): fall back to nearest segment.
      const i = Math.min(Math.max(0, this.segmentIndexAt(along)), this.xy.length - 2);
      a = this.xy[i]!;
      b = this.xy[i + 1] ?? a;
    }
    return bearingXY(a, b);
  }

  private segmentIndexAt(along: number): number {
    for (let i = 0; i < this.cum.length - 1; i++) if (this.cum[i + 1]! >= along) return i;
    return this.cum.length - 2;
  }
}

/** Convenience: distance from a point to a polyline, meters. */
export function distanceToPolyline(p: LatLon, line: LatLon[]): number {
  return new ProjectedPolyline(line).project(p).distance;
}
