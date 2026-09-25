import type { LatLon } from './geo';

/** An OSM node as returned by Overpass `out;`. */
export interface OsmNode {
  id: number;
  lat: number;
  lon: number;
  tags: Record<string, string>;
}

/** An OSM way as returned by Overpass `out geom;` (node ids + parallel geometry). */
export interface OsmWay {
  id: number;
  nodes: number[];
  geometry: LatLon[];
  tags: Record<string, string>;
}

export interface OsmData {
  nodes: OsmNode[];
  ways: OsmWay[];
}
