import { describe, expect, it } from 'vitest';
import { LocalProjection, type LatLon } from './geo';
import type { OsmData, OsmNode, OsmWay } from './osm';
import {
  appliesToTravel,
  clusterByAlong,
  matchTrafficControls,
  parseDirection,
  walkAlongWay,
  wayBearingAt,
} from './signals';

const proj = new LocalProjection({ lat: 37.44, lon: -122.15 });
const at = (x: number, y: number): LatLon => proj.toLatLon({ x, y });

let nextId = 1000;
function node(x: number, y: number, tags: Record<string, string>, id = nextId++): OsmNode {
  return { id, ...at(x, y), tags };
}
/** Build a way through the given nodes (plain vertices get fresh ids). */
function way(points: (OsmNode | [number, number])[], tags: Record<string, string>): OsmWay {
  const nodes: number[] = [];
  const geometry: LatLon[] = [];
  for (const p of points) {
    if (Array.isArray(p)) {
      nodes.push(nextId++);
      geometry.push(at(p[0], p[1]));
    } else {
      nodes.push(p.id);
      geometry.push({ lat: p.lat, lon: p.lon });
    }
  }
  return { id: nextId++, nodes, geometry, tags };
}

/** A route straight north along x = 0 from y = -300 to y = 300. */
const northRoute = [at(0, -300), at(0, 300)];

describe('direction helpers', () => {
  it('parses direction tags, ignoring numeric values', () => {
    expect(parseDirection('forward')).toBe('forward');
    expect(parseDirection('Backward')).toBe('backward');
    expect(parseDirection('both')).toBe('both');
    expect(parseDirection('45')).toBe('none');
    expect(parseDirection(undefined)).toBe('none');
  });

  it('applies forward/backward relative to the way direction', () => {
    // Way drawn northwards (0 deg).
    expect(appliesToTravel('forward', 0, 5)).toBe(true);
    expect(appliesToTravel('forward', 0, 180)).toBe(false);
    expect(appliesToTravel('backward', 0, 180)).toBe(true);
    expect(appliesToTravel('backward', 0, 10)).toBe(false);
    expect(appliesToTravel('both', 0, 180)).toBe(true);
    expect(appliesToTravel('none', 0, 0)).toBe(true);
    // Wrap-around: way at 350 deg, travelling at 10 deg is "with the way".
    expect(appliesToTravel('forward', 350, 10)).toBe(true);
  });

  it('computes way bearings at interior and end vertices', () => {
    const xy = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
    ];
    expect(wayBearingAt(xy, 0)).toBeCloseTo(0);
    expect(wayBearingAt(xy, 1)).toBeCloseTo(45);
    expect(wayBearingAt(xy, 2)).toBeCloseTo(90);
  });

  it('walks along a way and stops at its ends', () => {
    const xy = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
    ];
    const f = walkAlongWay(xy, 1, 1, 4);
    expect(f.walked).toBe(4);
    expect(f.point.x).toBeCloseTo(4);
    const b = walkAlongWay(xy, 1, -1, 20);
    expect(b.walked).toBeCloseTo(10);
  });
});

describe('matchTrafficControls: stop sign direction', () => {
  function scenario(wayDrawnNorth: boolean, direction: string) {
    const stop = node(0, 50, { highway: 'stop', direction });
    const pts: (OsmNode | [number, number])[] = [[0, -300], [0, 0], stop, [0, 100], [0, 300]];
    const w = way(wayDrawnNorth ? pts : [...pts].reverse(), { highway: 'residential', name: 'Main St' });
    return matchTrafficControls(northRoute, { nodes: [stop], ways: [w] });
  }

  it('counts direction=forward when travelling with the way', () => {
    const r = scenario(true, 'forward');
    expect(r.stops).toHaveLength(1);
    expect(r.stops[0]!.street).toBe('Main St');
    expect(r.stops[0]!.along).toBeCloseTo(350, 0);
  });

  it('rejects direction=forward when travelling against the way', () => {
    const r = scenario(false, 'forward');
    expect(r.stops).toHaveLength(0);
    expect(r.rejected[0]!.reason).toMatch(/other way/);
  });

  it('counts direction=backward when travelling against the way', () => {
    expect(scenario(false, 'backward').stops).toHaveLength(1);
  });

  it('rejects direction=backward when travelling with the way', () => {
    expect(scenario(true, 'backward').stops).toHaveLength(0);
  });

  it('counts direction=both and untagged stops on the route way (not uncertain)', () => {
    const both = scenario(true, 'both');
    expect(both.stops).toHaveLength(1);
    expect(both.stops[0]!.uncertain).toBe(false);
  });
});

describe('matchTrafficControls: cross streets', () => {
  it('ignores a stop sign on a perpendicular cross street near the route', () => {
    const inter = node(0, 100, {});
    const crossStop = node(-8, 100, { highway: 'stop', direction: 'forward' });
    const main = way([[0, -300], inter, [0, 300]], { highway: 'residential', name: 'Main St' });
    const cross = way([[-100, 100], crossStop, inter, [100, 100]], {
      highway: 'residential',
      name: 'Cross Ave',
    });
    const r = matchTrafficControls(northRoute, { nodes: [crossStop], ways: [main, cross] });
    expect(r.stops).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.reason).toMatch(/cross street/);
  });

  it('flags an untagged stop at a junction node as uncertain, but not stop=all', () => {
    const inter = node(0, 100, { highway: 'stop' });
    const main = way([[0, -300], inter, [0, 300]], { highway: 'residential', name: 'Main St' });
    const cross = way([[-100, 100], inter, [100, 100]], { highway: 'residential', name: 'Cross Ave' });
    const r = matchTrafficControls(northRoute, { nodes: [inter], ways: [main, cross] });
    expect(r.stops).toHaveLength(1);
    expect(r.stops[0]!.uncertain).toBe(true);
    expect(r.stops[0]!.crossStreet).toBe('Cross Ave');

    const allWay = { ...inter, tags: { highway: 'stop', stop: 'all' } };
    const r2 = matchTrafficControls(northRoute, { nodes: [allWay], ways: [main, cross] });
    expect(r2.stops[0]!.uncertain).toBe(false);
    expect(r2.stops[0]!.stopType).toBe('all');
    expect(r2.stops[0]!.label).toBe('All-way stop: Main St & Cross Ave');
  });

  it('does not count a stop on the street we turn onto that sits behind the corner', () => {
    // Route: north along x=0 to (0,100), then east along y=100.
    const route = [at(0, -300), at(0, 100), at(300, 100)];
    const corner = node(0, 100, {});
    // Stop for eastbound traffic on Cross Ave, 4 m WEST of the corner: we never ride it.
    const behind = node(-4, 100, { highway: 'stop', direction: 'forward' });
    // Stop for northbound traffic on Main St, 6 m before the corner: we do ride it.
    const ours = node(0, 94, { highway: 'stop', direction: 'forward' });
    const main = way([[0, -300], ours, corner, [0, 300]], { highway: 'residential', name: 'Main St' });
    const cross = way([[-100, 100], behind, corner, [300, 100]], {
      highway: 'residential',
      name: 'Cross Ave',
    });
    const r = matchTrafficControls(route, { nodes: [behind, ours], ways: [main, cross] });
    expect(r.stops.map((s) => s.members[0]!.node.id)).toEqual([ours.id]);
  });

  it('excludes controls at the very start or end', () => {
    const s = node(0, -290, { highway: 'stop' });
    const w = way([[0, -300], s, [0, 300]], { highway: 'residential' });
    const r = matchTrafficControls(northRoute, { nodes: [s], ways: [w] });
    expect(r.stops).toHaveLength(0);
    expect(r.rejected[0]!.reason).toMatch(/start/);
  });

  it('ignores nodes further than 12 m from the route', () => {
    const s = node(20, 0, { highway: 'stop' });
    const w = way([[20, -300], s, [20, 300]], { highway: 'residential' });
    const r = matchTrafficControls(northRoute, { nodes: [s], ways: [w] });
    expect(r.stops).toHaveLength(0);
    expect(r.rejected).toHaveLength(0);
  });
});

describe('clustering', () => {
  it('chains items within the gap', () => {
    const c = clusterByAlong([{ along: 0 }, { along: 30 }, { along: 10 }, { along: 100 }], 25);
    expect(c.map((g) => g.map((i) => i.along))).toEqual([[0, 10, 30], [100]]);
  });

  it('merges signal nodes of one intersection into one traffic light', () => {
    const a = node(0, 95, { highway: 'traffic_signals', 'traffic_signals:direction': 'forward' });
    const b = node(0, 105, { highway: 'traffic_signals' });
    const far = node(0, 200, { highway: 'traffic_signals' });
    const w = way([[0, -300], a, b, far, [0, 300]], { highway: 'primary', name: 'Main St' });
    const r = matchTrafficControls(northRoute, { nodes: [a, b, far], ways: [w] });
    expect(r.signals).toHaveLength(2);
    expect(r.signals[0]!.members).toHaveLength(2);
  });

  it('merges duplicate stop nodes of an all-way stop', () => {
    const a = node(0, 90, { highway: 'stop', stop: 'all' });
    const b = node(0, 110, { highway: 'stop', stop: 'all' });
    const w = way([[0, -300], a, b, [0, 300]], { highway: 'residential' });
    const r = matchTrafficControls(northRoute, { nodes: [a, b], ways: [w] });
    expect(r.stops).toHaveLength(1);
  });

  it('counts a signalized crossing only when no traffic light is nearby', () => {
    const sig = node(0, 0, { highway: 'traffic_signals' });
    const xingNear = node(0, 20, { highway: 'crossing', crossing: 'traffic_signals' });
    const xingAlone = node(0, 200, { highway: 'crossing', crossing: 'traffic_signals' });
    const w = way([[0, -300], sig, xingNear, xingAlone, [0, 300]], { highway: 'secondary' });
    const data: OsmData = { nodes: [sig, xingNear, xingAlone], ways: [w] };
    const r = matchTrafficControls(northRoute, data);
    expect(r.signals.map((s) => s.kind)).toEqual(['signal', 'crossing']);
    expect(r.rejected.some((x) => x.node.id === xingNear.id)).toBe(true);
  });

  it('respects traffic_signals:direction', () => {
    const s = node(0, 0, { highway: 'traffic_signals', 'traffic_signals:direction': 'backward' });
    const w = way([[0, -300], s, [0, 300]], { highway: 'secondary' });
    expect(matchTrafficControls(northRoute, { nodes: [s], ways: [w] }).signals).toHaveLength(0);
  });
});
