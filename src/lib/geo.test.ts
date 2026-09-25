import { describe, expect, it } from 'vitest';
import {
  LocalProjection,
  ProjectedPolyline,
  angleDiff,
  bboxContains,
  bboxOf,
  bearing,
  decodePolyline,
  encodePolyline,
  haversine,
  isParallel,
  padBBox,
} from './geo';

describe('decodePolyline', () => {
  it('decodes precision-6 (Valhalla) polylines', () => {
    // Known example from the Valhalla docs format: encode then decode round trip
    const pts = [
      { lat: 37.430468, lon: -122.131298 },
      { lat: 37.431, lon: -122.132 },
      { lat: 37.4537714, lon: -122.1643322 },
    ];
    const enc = encodePolyline(pts, 6);
    const dec = decodePolyline(enc, 6);
    expect(dec).toHaveLength(3);
    dec.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(pts[i]!.lat, 6);
      expect(p.lon).toBeCloseTo(pts[i]!.lon, 6);
    });
  });

  it('decodes the canonical Google example at precision 5', () => {
    const dec = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
    expect(dec).toEqual([
      { lat: 38.5, lon: -120.2 },
      { lat: 40.7, lon: -120.95 },
      { lat: 43.252, lon: -126.453 },
    ]);
  });

  it('the same string means 10x smaller coordinates at precision 6', () => {
    const dec = decodePolyline('_p~iF~ps|U', 6);
    expect(dec[0]!.lat).toBeCloseTo(3.85, 6);
    expect(dec[0]!.lon).toBeCloseTo(-12.02, 6);
  });

  it('throws on truncated input', () => {
    expect(() => decodePolyline('_p~iF~ps|', 6)).toThrow();
  });
});

describe('haversine & bearing', () => {
  it('measures one degree of latitude as ~111.2 km', () => {
    expect(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111195, -1);
  });

  it('computes cardinal bearings', () => {
    const o = { lat: 37.44, lon: -122.15 };
    expect(bearing(o, { lat: 37.45, lon: -122.15 })).toBeCloseTo(0, 5);
    expect(bearing(o, { lat: 37.44, lon: -122.14 })).toBeCloseTo(90, 1);
    expect(bearing(o, { lat: 37.43, lon: -122.15 })).toBeCloseTo(180, 5);
    expect(bearing(o, { lat: 37.44, lon: -122.16 })).toBeCloseTo(270, 1);
  });

  it('angleDiff wraps around north', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(20);
    expect(angleDiff(0, 180)).toBe(180);
    expect(angleDiff(-90, 270)).toBe(0);
  });

  it('isParallel accepts both same and opposite directions', () => {
    expect(isParallel(10, 30, 35)).toBe(true);
    expect(isParallel(10, 200, 35)).toBe(true);
    expect(isParallel(0, 90, 35)).toBe(false);
    expect(isParallel(0, 50, 35)).toBe(false);
  });
});

describe('ProjectedPolyline', () => {
  const proj = new LocalProjection({ lat: 37.44, lon: -122.15 });
  // An L-shaped line: 100 m north, then 100 m east.
  const line = [
    proj.toLatLon({ x: 0, y: 0 }),
    proj.toLatLon({ x: 0, y: 100 }),
    proj.toLatLon({ x: 100, y: 100 }),
  ];
  const pl = new ProjectedPolyline(line, proj);

  it('has the right length', () => {
    expect(pl.length).toBeCloseTo(200, 6);
  });

  it('projects onto the nearest segment with along-distance', () => {
    const r = pl.project(proj.toLatLon({ x: 5, y: 40 }));
    expect(r.distance).toBeCloseTo(5, 6);
    expect(r.segmentIndex).toBe(0);
    expect(r.along).toBeCloseTo(40, 6);
    const r2 = pl.project(proj.toLatLon({ x: 60, y: 108 }));
    expect(r2.distance).toBeCloseTo(8, 6);
    expect(r2.segmentIndex).toBe(1);
    expect(r2.along).toBeCloseTo(160, 6);
  });

  it('clamps beyond the ends', () => {
    const r = pl.project(proj.toLatLon({ x: 0, y: -30 }));
    expect(r.distance).toBeCloseTo(30, 6);
    expect(r.along).toBe(0);
  });

  it('reports local bearings', () => {
    expect(pl.bearingAt(50)).toBeCloseTo(0, 6);
    expect(pl.bearingAt(150)).toBeCloseTo(90, 6);
    expect(pl.bearingAt(100, 5, 'before')).toBeCloseTo(0, 6);
    expect(pl.bearingAt(100, 5, 'after')).toBeCloseTo(90, 6);
  });

  it('pointAt interpolates', () => {
    const p = pl.pointAt(150);
    expect(p.x).toBeCloseTo(50, 6);
    expect(p.y).toBeCloseTo(100, 6);
  });
});

describe('bbox helpers', () => {
  it('computes, pads and tests containment', () => {
    const b = bboxOf([
      { lat: 1, lon: 2 },
      { lat: 3, lon: -1 },
    ]);
    expect(b).toEqual({ south: 1, west: -1, north: 3, east: 2 });
    const padded = padBBox(b, 1000);
    expect(padded.south).toBeLessThan(1);
    expect(bboxContains(padded, b)).toBe(true);
    expect(bboxContains(b, padded)).toBe(false);
  });
});
