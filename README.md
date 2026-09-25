# Bike Route Planner: stop signs & traffic lights

A single-page web app that plans a **bicycle** route on an OpenStreetMap map
(default: 2746 Cowper St, Palo Alto to 80 Willow Rd, Menlo Park), lets you shape
it with waypoints, and **counts the stop signs and traffic lights you will
actually face** along the chosen route.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run build      # type-check + production build into dist/
```

## Using it

- **Start / end**: drag the green `S` / red `E` markers, or type an address and
  press *Geocode* (Nominatim). The swap button reverses the direction.
- **Waypoints**: click the map to add one. It is inserted into the leg of the
  route nearest to the click. Or press on the blue route line and drag to pull
  a new waypoint out of it. Drag numbered waypoints to move them; right-click
  one, or use the x in the panel, to remove it.
- **Options**: bike type (Hybrid/Road/Cross/Mountain), *Use roads* and
  *Use hills* (Valhalla `bicycle` costing options).
- **Results**: count tiles for stop signs, traffic lights, distance and time;
  ordered lists (click an item to zoom to it); turn-by-turn directions.
  *Show unmatched nearby* draws the nodes within 12 m of the route that were
  **not** counted (grey), with the reason in the tooltip.
- The state (start, end, waypoints, options) lives in the URL hash, so links are
  shareable.

## How counting works

Source: OSM nodes `highway=stop`, `highway=traffic_signals`, and
`highway=crossing` + `crossing=traffic_signals`, plus their parent highway ways
with geometry, from one Overpass query over the route bbox. Results are cached
by bbox, so small edits don't refetch. The logic is in `src/lib/signals.ts`
(pure functions, unit tested):

1. **Proximity**: each node is projected onto the route. Only nodes within
   12 m are considered.
2. **On our road, not a cross street**: at least one parent way must *run
   along the route* at the node. Its bearing there must be within 35 degrees
   of the route's travel bearing, or of its reverse. Sample points 10 m either
   side of the node along the way must also lie near the route and spread out
   along it. This rejects signs on side streets and on the street you turn
   onto but sit behind the corner.
3. **Direction**: in this area most stop nodes carry `direction=forward|backward`,
   relative to the way's drawing direction. A sign counts only if it faces
   your travel direction. `forward` needs the way's bearing within 90 degrees
   of your travel bearing; `backward` needs more than 90. For signals,
   `traffic_signals:direction` is used the same way.
4. **No direction tag**: the sign counts. If the node is also a junction with
   a cross street, it is flagged *uncertain*, because it may govern the cross
   street. `stop=all` is never uncertain.
5. Nodes within 15 m of the route start or end are ignored.
6. **Clustering** by distance along the route: stop nodes within 25 m make one
   stop, and signal nodes within 40 m make one traffic light. A signalised
   pedestrian crossing counts as a light only if no real traffic light is
   within 40 m.

### Limitations

- Counts are only as good as OSM tagging. Unmapped signs are missed. Stop
  nodes without a direction tag at junctions are ambiguous and are flagged.
- Cross-street names come only from ways returned by the query, which are the
  parents of stop and signal nodes. Some items therefore show only the street
  you ride on.
- A side path or service road running parallel within 12 m of the route could
  in theory contribute a sign.
- Signals are counted per intersection, even if you turn there.
- The public Valhalla and Overpass servers are rate limited and can be slow.
  Each Overpass request is capped at 30 s; on failure or timeout the app falls
  back to a second Overpass mirror, then shows an error.

## Data sources

- Map tiles and data: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL). Optional [CyclOSM](https://www.cyclosm.org) layer.
- Routing: [Valhalla](https://github.com/valhalla/valhalla), public server `valhalla1.openstreetmap.de` operated by [FOSSGIS e.V.](https://www.fossgis.de/)
- Stop signs and signals: [Overpass API](https://overpass-api.de/) (fallback `overpass.kumi.systems`).
- Geocoding: [Nominatim](https://nominatim.org/).

## Code layout

```
src/
  lib/geo.ts          haversine, bearings, local projection, polyline decode (precision 6), projection onto polyline, bbox
  lib/signals.ts      matching, direction filtering, clustering (pure)
  lib/valhalla.ts     route request/parse
  lib/overpass.ts     query builder, fetch with mirror fallback, bbox cache
  lib/nominatim.ts    geocoding
  lib/waypoints.ts    waypoint insertion by nearest leg
  lib/urlState.ts     URL hash (de)serialisation
  hooks/              useRoute, useTrafficControls, useUrlSync
  components/         MapView, SidePanel, Controls, WaypointList, ResultsList, ManeuverList, icons
  App.tsx
```
