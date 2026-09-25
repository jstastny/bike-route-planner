/**
 * Matching of OSM stop-sign and traffic-signal nodes to a route, with
 * direction awareness and clustering. Pure functions only.
 *
 * Overview
 * --------
 * 1. Every candidate node is projected onto the route polyline. Nodes more
 *    than `maxOffset` (12 m) away are ignored entirely.
 * 2. For the rest we look at the node's parent highway ways (from Overpass
 *    `way(bn.n)`). A parent way "runs along the route" at the node when
 *      a) its local bearing at the node is within `parallelTolerance` (35 deg)
 *         of the route's travel bearing (or of its reverse), and
 *      b) short sample points on that way ~10 m either side of the node also
 *         lie near the route AND project onto the route in a spread-out way
 *         (so the route really travels along this stretch of the way rather
 *         than just touching its end at a corner).
 *    A node that sits only on ways that do NOT run along the route belongs
 *    to a cross street and never applies to the cyclist.
 * 3. Direction tags. OSM `direction=forward|backward` on a stop node (and
 *    `traffic_signals:direction` on a signal node) is relative to the
 *    direction of the way the node lies on:
 *      - forward  applies to traffic travelling in the way's drawing direction
 *      - backward applies to traffic travelling against it
 *    So we compute the parallel way's forward bearing at the node and the
 *    route's travel bearing over the shared stretch. `forward` applies when
 *    those differ by less than 90 deg; `backward` when they differ by more.
 *    `both` or a missing / unparseable value applies in either direction.
 * 4. A node without a usable direction that is also a junction with a
 *    (non-footpath) cross street is counted but flagged "uncertain": the sign
 *    may govern the cross street rather than us. `stop=all` is never uncertain.
 * 5. Nodes within `endpointExclusion` (15 m) of the route's start or end are
 *    dropped (you are already stopped there).
 * 6. Remaining nodes are sorted by distance along the route and clustered:
 *    stop nodes within 25 m -> one stop; signal nodes within 40 m -> one
 *    traffic light. Signalised pedestrian crossings (`highway=crossing` +
 *    `crossing=traffic_signals`) count as a light only when no real
 *    `highway=traffic_signals` cluster is within 40 m.
 */

import {
  type LatLon,
  type XY,
  ProjectedPolyline,
  angleDiff,
  bearingXY,
  distXY,
  isParallel,
} from './geo';
import type { OsmData, OsmNode, OsmWay } from './osm';

export interface MatchOptions {
  /** Max distance from the route for a node to be considered, meters. */
  maxOffset: number;
  /** Max bearing difference for a way to count as running along the route, degrees. */
  parallelTolerance: number;
  /** Ignore nodes this close (along the route) to the start or end, meters. */
  endpointExclusion: number;
  /** Stop nodes this close along the route merge into one stop, meters. */
  stopClusterDistance: number;
  /** Signal nodes this close along the route merge into one light, meters. */
  signalClusterDistance: number;
  /** How far along the parent way we sample on each side of the node, meters. */
  waySampleDistance: number;
  /** Max distance of those samples from the route, meters. */
  wayCoverageMaxOffset: number;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  maxOffset: 12,
  parallelTolerance: 35,
  endpointExclusion: 15,
  stopClusterDistance: 25,
  signalClusterDistance: 40,
  waySampleDistance: 10,
  wayCoverageMaxOffset: 15,
};

export type ControlKind = 'stop' | 'signal' | 'crossing';
export type DirectionTag = 'forward' | 'backward' | 'both' | 'none';

/** A single OSM node that was judged to apply to the cyclist. */
export interface MatchedNode {
  node: OsmNode;
  kind: ControlKind;
  /** Meters from route start to the node's projection onto the route. */
  along: number;
  /** Perpendicular distance from the route, meters. */
  offset: number;
  direction: DirectionTag;
  /** Name of the way that runs along the route at this node, if any. */
  street?: string;
  /** Names of cross streets meeting at this node. */
  crossStreets: string[];
  uncertain: boolean;
  /** Human readable explanation of the decision. */
  reason: string;
}

/** A node near the route that was NOT counted, with the reason. */
export interface RejectedNode {
  node: OsmNode;
  kind: ControlKind;
  along: number;
  offset: number;
  reason: string;
}

/** One counted stop sign or traffic light (possibly several OSM nodes). */
export interface TrafficControl {
  id: string;
  kind: ControlKind;
  lat: number;
  lon: number;
  along: number;
  members: MatchedNode[];
  /** For stop signs: `stop=all` (all-way) or `stop=minor`. */
  stopType?: 'all' | 'minor';
  uncertain: boolean;
  street?: string;
  crossStreet?: string;
  label: string;
}

export interface TrafficControlResult {
  stops: TrafficControl[];
  signals: TrafficControl[];
  rejected: RejectedNode[];
  routeLength: number;
}

/* ------------------------------------------------------------------------ */
/* Tag helpers                                                               */
/* ------------------------------------------------------------------------ */

export function classifyNode(node: OsmNode): ControlKind | null {
  const hw = node.tags.highway;
  if (hw === 'stop') return 'stop';
  if (hw === 'traffic_signals') return 'signal';
  if (hw === 'crossing' && node.tags.crossing === 'traffic_signals') return 'crossing';
  return null;
}

/** Normalise a direction tag. Numeric or other values are treated as unknown ('none'). */
export function parseDirection(value: string | undefined): DirectionTag {
  switch (value?.trim().toLowerCase()) {
    case 'forward':
      return 'forward';
    case 'backward':
      return 'backward';
    case 'both':
      return 'both';
    default:
      return 'none';
  }
}

export function directionOf(node: OsmNode, kind: ControlKind): DirectionTag {
  if (kind === 'stop') return parseDirection(node.tags.direction);
  return parseDirection(node.tags['traffic_signals:direction'] ?? node.tags.direction);
}

/**
 * Does a direction-tagged control apply to someone travelling on bearing
 * `travelBearing` along a way whose drawing direction at the node is
 * `wayForwardBearing`?
 */
export function appliesToTravel(
  direction: DirectionTag,
  wayForwardBearing: number,
  travelBearing: number,
): boolean {
  const withTheWay = angleDiff(wayForwardBearing, travelBearing) < 90;
  if (direction === 'forward') return withTheWay;
  if (direction === 'backward') return !withTheWay;
  return true;
}

const FOOTLIKE = new Set([
  'footway',
  'path',
  'cycleway',
  'steps',
  'pedestrian',
  'bridleway',
  'corridor',
  'elevator',
  'platform',
]);

/** Ways that are not roads for motor traffic; a junction with these isn't a real cross street. */
export function isFootLike(way: OsmWay): boolean {
  return FOOTLIKE.has(way.tags.highway ?? '');
}

/* ------------------------------------------------------------------------ */
/* Way geometry at a node                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Forward bearing of a way at the vertex with index `idx`: from the previous
 * vertex to the next one (one-sided at the ends of the way).
 */
export function wayBearingAt(xy: XY[], idx: number): number {
  const prev = xy[Math.max(0, idx - 1)]!;
  const next = xy[Math.min(xy.length - 1, idx + 1)]!;
  return bearingXY(prev, next);
}

/**
 * Walk `dist` meters along a way from vertex `idx` in direction `dir`
 * (+1 = forward, -1 = backward). Returns the reached point and how far we
 * actually got (less than `dist` if the way ends).
 */
export function walkAlongWay(
  xy: XY[],
  idx: number,
  dir: 1 | -1,
  dist: number,
): { point: XY; walked: number } {
  let walked = 0;
  let i = idx;
  let cur = xy[idx]!;
  while (walked < dist) {
    const j = i + dir;
    if (j < 0 || j >= xy.length) break;
    const nxt = xy[j]!;
    const seg = distXY(cur, nxt);
    if (walked + seg >= dist) {
      const t = seg === 0 ? 0 : (dist - walked) / seg;
      return {
        point: { x: cur.x + t * (nxt.x - cur.x), y: cur.y + t * (nxt.y - cur.y) },
        walked: dist,
      };
    }
    walked += seg;
    cur = nxt;
    i = j;
  }
  return { point: cur, walked };
}

export interface WayAtNode {
  way: OsmWay;
  /** Forward (drawing-direction) bearing of the way at the node. */
  forwardBearing: number;
  /** Does this way run along the route at the node? */
  alongRoute: boolean;
  /** Route travel bearing over the stretch shared with this way (if alongRoute). */
  travelBearing?: number;
  /** Explanation when not along the route. */
  why?: string;
}

/**
 * Analyse one occurrence of the node in a parent way relative to the route.
 */
export function analyseWayAtNode(
  way: OsmWay,
  idx: number,
  wayXY: XY[],
  route: ProjectedPolyline,
  nodeAlong: number,
  opts: MatchOptions,
): WayAtNode {
  const forwardBearing = wayBearingAt(wayXY, idx);

  // Sample the way on both sides of the node.
  const back = walkAlongWay(wayXY, idx, -1, opts.waySampleDistance);
  const fwd = walkAlongWay(wayXY, idx, 1, opts.waySampleDistance);
  const minSide = 2; // a side shorter than this is "the way ends here"
  const sides: { point: XY; walked: number; sign: -1 | 1 }[] = [];
  if (back.walked >= minSide) sides.push({ ...back, sign: -1 });
  if (fwd.walked >= minSide) sides.push({ ...fwd, sign: 1 });
  if (sides.length === 0) {
    return { way, forwardBearing, alongRoute: false, why: 'degenerate way' };
  }

  // Every sample must be near the route.
  const projections = sides.map((s) => ({ side: s, proj: route.projectXY(s.point) }));
  for (const { proj } of projections) {
    if (proj.distance > opts.wayCoverageMaxOffset) {
      return { way, forwardBearing, alongRoute: false, why: 'way leaves the route next to the node' };
    }
  }

  // The samples must also be spread out along the route: if the route only
  // touches the way at a corner, the samples' projections pile up at the
  // corner vertex. Require at least half the sampled way length to show up
  // as route length.
  const alongMinus =
    projections.find((p) => p.side.sign === -1)?.proj.along ?? nodeAlong;
  const alongPlus = projections.find((p) => p.side.sign === 1)?.proj.along ?? nodeAlong;
  const sampledLength =
    (sides.find((s) => s.sign === -1)?.walked ?? 0) + (sides.find((s) => s.sign === 1)?.walked ?? 0);
  const spread = Math.abs(alongPlus - alongMinus);
  if (spread < 0.5 * sampledLength) {
    return { way, forwardBearing, alongRoute: false, why: 'route only touches this way at a corner' };
  }

  // Route travel bearing over the shared stretch, in travel order.
  const lo = Math.min(alongMinus, alongPlus);
  const hi = Math.max(alongMinus, alongPlus);
  const travelBearing = bearingXY(route.pointAt(lo), route.pointAt(hi));

  if (!isParallel(forwardBearing, travelBearing, opts.parallelTolerance)) {
    return { way, forwardBearing, alongRoute: false, why: 'way crosses the route' };
  }
  return { way, forwardBearing, alongRoute: true, travelBearing };
}

/* ------------------------------------------------------------------------ */
/* Matching                                                                  */
/* ------------------------------------------------------------------------ */

interface Indexed {
  waysByNode: Map<number, { way: OsmWay; idx: number }[]>;
  wayXY: Map<number, XY[]>;
}

function indexWays(ways: OsmWay[], route: ProjectedPolyline): Indexed {
  const waysByNode = new Map<number, { way: OsmWay; idx: number }[]>();
  const wayXY = new Map<number, XY[]>();
  for (const way of ways) {
    if (way.geometry.length !== way.nodes.length || way.geometry.length < 2) continue;
    wayXY.set(way.id, way.geometry.map((p) => route.proj.toXY(p)));
    way.nodes.forEach((nid, idx) => {
      let list = waysByNode.get(nid);
      if (!list) waysByNode.set(nid, (list = []));
      list.push({ way, idx });
    });
  }
  return { waysByNode, wayXY };
}

type NodeDecision =
  | { ok: true; matched: MatchedNode }
  | { ok: false; rejected: RejectedNode }
  | null;

function decideNode(
  node: OsmNode,
  route: ProjectedPolyline,
  index: Indexed,
  opts: MatchOptions,
): NodeDecision {
  const kind = classifyNode(node);
  if (!kind) return null;
  const proj = route.project(node);
  if (proj.distance > opts.maxOffset) return null;
  const base = { node, kind, along: proj.along, offset: proj.distance };
  const reject = (reason: string): NodeDecision => ({ ok: false, rejected: { ...base, reason } });

  if (proj.along < opts.endpointExclusion) return reject('at the route start');
  if (proj.along > route.length - opts.endpointExclusion) return reject('at the route end');

  const parents = index.waysByNode.get(node.id) ?? [];
  if (parents.length === 0) return reject('no parent highway way found');

  const analysed = parents.map(({ way, idx }) =>
    analyseWayAtNode(way, idx, index.wayXY.get(way.id)!, route, proj.along, opts),
  );
  const along = analysed.filter((a) => a.alongRoute);
  const cross = analysed.filter((a) => !a.alongRoute);
  const crossStreets = [
    ...new Set(cross.map((c) => c.way.tags.name).filter((n): n is string => !!n)),
  ];

  if (along.length === 0) {
    const why = cross[0]?.why ?? 'not on the route';
    return reject(`on a cross street (${why})`);
  }

  // Prefer a named, non-footpath way when several run along the route.
  const primary =
    along.find((a) => !isFootLike(a.way) && a.way.tags.name) ??
    along.find((a) => !isFootLike(a.way)) ??
    along[0]!;
  const direction = directionOf(node, kind);
  const travel = primary.travelBearing!;

  if (direction === 'forward' || direction === 'backward') {
    if (!appliesToTravel(direction, primary.forwardBearing, travel)) {
      return reject(
        `faces the other way (direction=${direction}, way ${Math.round(primary.forwardBearing)} deg, travel ${Math.round(travel)} deg)`,
      );
    }
    return {
      ok: true,
      matched: {
        ...base,
        direction,
        street: primary.way.tags.name,
        crossStreets,
        uncertain: false,
        reason: `direction=${direction} matches travel direction`,
      },
    };
  }

  // No usable direction: applies both ways along our road. If the node is a
  // junction with a real cross street, the sign may be for that street.
  const carCross = cross.some((c) => !isFootLike(c.way));
  const allWay = kind === 'stop' && node.tags.stop === 'all';
  const uncertain = kind === 'stop' && carCross && !allWay;
  return {
    ok: true,
    matched: {
      ...base,
      direction,
      street: primary.way.tags.name,
      crossStreets,
      uncertain,
      reason: uncertain
        ? 'no direction tag at a junction; may apply to the cross street'
        : direction === 'both'
          ? 'direction=both'
          : 'no direction tag, on the route way',
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Clustering                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Group items (sorted or not) whose `along` values chain within `maxGap`
 * meters of the previous item. Returns clusters in along-route order.
 */
export function clusterByAlong<T extends { along: number }>(items: T[], maxGap: number): T[][] {
  const sorted = [...items].sort((a, b) => a.along - b.along);
  const clusters: T[][] = [];
  let current: T[] = [];
  for (const it of sorted) {
    const last = current[current.length - 1];
    if (last && it.along - last.along <= maxGap) current.push(it);
    else {
      if (current.length) clusters.push(current);
      current = [it];
    }
  }
  if (current.length) clusters.push(current);
  return clusters;
}

function mostCommon(values: (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | undefined;
  let bestN = 0;
  for (const [v, n] of counts)
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  return best;
}

const ROAD_RANK: Record<string, number> = {
  motorway: 6,
  trunk: 6,
  primary: 5,
  secondary: 4,
  tertiary: 3,
  unclassified: 2,
  residential: 2,
  living_street: 1,
  service: 1,
};

/** Importance of a road for naming purposes (links rank like their parent class). */
export function roadRank(way: OsmWay): number {
  return ROAD_RANK[(way.tags.highway ?? '').replace(/_link$/, '')] ?? 0;
}

/**
 * Find a named way that is not `street` and not parallel to the route within
 * `maxDist` of `p`. With `preferMajor` (used for traffic lights, which sit on
 * the intersection with the busier road) the highest-ranked road wins and
 * distance breaks ties; otherwise the nearest one wins.
 */
function nearestCrossStreetName(
  p: XY,
  street: string | undefined,
  travelBearing: number,
  ways: OsmWay[],
  wayXY: Map<number, XY[]>,
  maxDist: number,
  preferMajor: boolean,
): string | undefined {
  let best: string | undefined;
  let bestD = maxDist;
  let bestRank = -1;
  for (const way of ways) {
    const name = way.tags.name;
    if (!name || name === street || isFootLike(way)) continue;
    const xy = wayXY.get(way.id);
    if (!xy) continue;
    const rank = preferMajor ? roadRank(way) : 0;
    if (rank < bestRank) continue;
    for (let i = 0; i < xy.length - 1; i++) {
      const a = xy[i]!;
      const b = xy[i + 1]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      const d = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
      if (d > maxDist || isParallel(bearingXY(a, b), travelBearing, 30)) continue;
      if (rank > bestRank || d < bestD) {
        bestD = d;
        bestRank = rank;
        best = name;
      }
    }
  }
  return best;
}

function buildControl(
  members: MatchedNode[],
  kind: ControlKind,
  route: ProjectedPolyline,
  ways: OsmWay[],
  wayXY: Map<number, XY[]>,
): TrafficControl {
  const first = members[0]!;
  const lat = members.reduce((s, m) => s + m.node.lat, 0) / members.length;
  const lon = members.reduce((s, m) => s + m.node.lon, 0) / members.length;
  const along = members.reduce((s, m) => s + m.along, 0) / members.length;
  const street = mostCommon(members.map((m) => m.street));
  let crossStreet = mostCommon(
    members.flatMap((m) => m.crossStreets).filter((n) => n !== street),
  );
  if (!crossStreet) {
    crossStreet = nearestCrossStreetName(
      route.proj.toXY({ lat, lon }),
      street,
      route.bearingAt(along, 10),
      ways,
      wayXY,
      35,
      kind !== 'stop',
    );
  }
  const uncertain = members.every((m) => m.uncertain);
  let stopType: 'all' | 'minor' | undefined;
  if (kind === 'stop') {
    if (members.some((m) => m.node.tags.stop === 'all')) stopType = 'all';
    else if (members.some((m) => m.node.tags.stop === 'minor')) stopType = 'minor';
  }
  const where =
    street && crossStreet
      ? `${street} & ${crossStreet}`
      : street
        ? crossStreet
          ? `${street} & ${crossStreet}`
          : street
        : (crossStreet ?? 'unnamed road');
  const label =
    kind === 'stop'
      ? `${stopType === 'all' ? 'All-way stop' : 'Stop'}: ${where}`
      : kind === 'crossing'
        ? `Signalized crossing: ${where}`
        : `Traffic light: ${where}`;
  return {
    id: `${kind}-${first.node.id}`,
    kind,
    lat,
    lon,
    along,
    members,
    stopType,
    uncertain,
    street,
    crossStreet,
    label,
  };
}

/* ------------------------------------------------------------------------ */
/* Entry point                                                               */
/* ------------------------------------------------------------------------ */

export function matchTrafficControls(
  routePoints: LatLon[],
  data: OsmData,
  options: Partial<MatchOptions> = {},
): TrafficControlResult {
  const opts = { ...DEFAULT_MATCH_OPTIONS, ...options };
  const route = new ProjectedPolyline(routePoints);
  const index = indexWays(data.ways, route);

  const matched: MatchedNode[] = [];
  const rejected: RejectedNode[] = [];
  for (const node of data.nodes) {
    const d = decideNode(node, route, index, opts);
    if (!d) continue;
    if (d.ok) matched.push(d.matched);
    else rejected.push(d.rejected);
  }

  const stops = clusterByAlong(
    matched.filter((m) => m.kind === 'stop'),
    opts.stopClusterDistance,
  ).map((c) => buildControl(c, 'stop', route, data.ways, index.wayXY));

  const signalClusters = clusterByAlong(
    matched.filter((m) => m.kind === 'signal'),
    opts.signalClusterDistance,
  ).map((c) => buildControl(c, 'signal', route, data.ways, index.wayXY));

  // Signalised crossings count only where there is no real traffic light nearby.
  const crossingClusters: TrafficControl[] = [];
  for (const c of clusterByAlong(
    matched.filter((m) => m.kind === 'crossing'),
    opts.signalClusterDistance,
  )) {
    const near = signalClusters.some((s) =>
      s.members.some((sm) => c.some((cm) => Math.abs(sm.along - cm.along) <= opts.signalClusterDistance)),
    );
    if (near) {
      for (const cm of c)
        rejected.push({
          node: cm.node,
          kind: cm.kind,
          along: cm.along,
          offset: cm.offset,
          reason: 'pedestrian signal belonging to a counted traffic light',
        });
    } else {
      crossingClusters.push(buildControl(c, 'crossing', route, data.ways, index.wayXY));
    }
  }

  const signals = [...signalClusters, ...crossingClusters].sort((a, b) => a.along - b.along);
  rejected.sort((a, b) => a.along - b.along);
  return { stops, signals, rejected, routeLength: route.length };
}
