import { describe, expect, it } from 'vitest';
import { LocalProjection } from './geo';
import { insertAt, insertionIndex } from './waypoints';
import { parseState, serializeState } from './urlState';
import { DEFAULT_ROUTE_OPTIONS } from './types';
import { buildQuery } from './overpass';
import { splitIntoLegs } from './valhalla';

const proj = new LocalProjection({ lat: 37.44, lon: -122.15 });
const at = (x: number, y: number) => proj.toLatLon({ x, y });

describe('waypoint insertion', () => {
  const legs = [
    [at(0, 0), at(0, 100)],
    [at(0, 100), at(100, 100)],
  ];
  it('inserts into the nearest leg', () => {
    expect(insertionIndex(at(3, 50), legs, 1)).toBe(0);
    expect(insertionIndex(at(50, 95), legs, 1)).toBe(1);
  });
  it('appends when there is no route', () => {
    expect(insertionIndex(at(3, 50), undefined, 2)).toBe(2);
  });
  it('insertAt is immutable', () => {
    const a = [1, 2];
    expect(insertAt(a, 1, 9)).toEqual([1, 9, 2]);
    expect(a).toEqual([1, 2]);
  });
});

describe('url state', () => {
  it('round-trips', () => {
    const s = { lat: 37.1, lon: -122.1 };
    const e = { lat: 37.2, lon: -122.2 };
    const w = [{ lat: 37.15, lon: -122.15 }];
    const hash = serializeState(s, e, w, { ...DEFAULT_ROUTE_OPTIONS, bicycleType: 'Road' });
    const parsed = parseState(hash);
    expect(parsed.start).toEqual(s);
    expect(parsed.end).toEqual(e);
    expect(parsed.waypoints).toEqual(w);
    expect(parsed.options?.bicycleType).toBe('Road');
  });
  it('ignores garbage', () => {
    const p = parseState('#s=abc&bt=Tandem&ur=7');
    expect(p.start).toBeUndefined();
    expect(p.options).toEqual({});
  });
});

describe('overpass query', () => {
  it('includes nodes and parent ways with geometry', () => {
    const q = buildQuery({ south: 1, west: 2, north: 3, east: 4 });
    expect(q).toContain('node["highway"="stop"](1.000000,2.000000,3.000000,4.000000)');
    expect(q).toContain('way(bn.n)["highway"]');
    expect(q).toContain('out geom');
  });
});

describe('splitIntoLegs', () => {
  it('splits a single-leg shape at intermediate points', () => {
    const shape = [at(0, 0), at(0, 50), at(0, 100), at(0, 150)];
    const legs = splitIntoLegs(shape, [at(0, 0), at(1, 100), at(0, 150)]);
    expect(legs).toHaveLength(2);
    expect(legs[0]).toHaveLength(3);
    expect(legs[1]).toHaveLength(2);
  });
});
