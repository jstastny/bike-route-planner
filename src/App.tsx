import { useCallback, useMemo, useRef, useState } from 'react';
import { Controls } from './components/Controls';
import { type FocusRequest, MapView } from './components/MapView';
import { SidePanel } from './components/SidePanel';
import { WaypointList } from './components/WaypointList';
import { useRoute } from './hooks/useRoute';
import { useTrafficControls } from './hooks/useTrafficControls';
import { useUrlSync } from './hooks/useUrlSync';
import { formatCoord } from './lib/format';
import type { LatLon } from './lib/geo';
import type { TrafficControl } from './lib/signals';
import {
  DEFAULT_END,
  DEFAULT_ROUTE_OPTIONS,
  DEFAULT_START,
  type Place,
  type RouteOptions,
  type Waypoint,
  makeWaypoint,
} from './lib/types';
import { parseState } from './lib/urlState';
import { insertAt, insertionIndex } from './lib/waypoints';

function initialState() {
  const s = parseState(window.location.hash);
  // Keep the friendly default address label when the hash holds the default point.
  const place = (p: LatLon | undefined, fallback: Place): Place => {
    if (!p) return fallback;
    const known = [DEFAULT_START, DEFAULT_END].find(
      (d) => Math.abs(p.lat - d.lat) < 1e-5 && Math.abs(p.lon - d.lon) < 1e-5,
    );
    return known ?? { ...p, label: formatCoord(p.lat, p.lon) };
  };
  return {
    start: place(s.start, DEFAULT_START),
    end: place(s.end, DEFAULT_END),
    waypoints: (s.waypoints ?? []).map(makeWaypoint),
    options: { ...DEFAULT_ROUTE_OPTIONS, ...s.options },
  };
}

const droppedLabel = (p: LatLon): Place => ({ ...p, label: formatCoord(p.lat, p.lon) });

export default function App() {
  const [init] = useState(initialState);
  const [start, setStart] = useState<Place>(init.start);
  const [end, setEnd] = useState<Place>(init.end);
  const [waypoints, setWaypoints] = useState<Waypoint[]>(init.waypoints);
  const [options, setOptions] = useState<RouteOptions>(init.options);
  const [showRejected, setShowRejected] = useState(false);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [fitRequest, setFitRequest] = useState(0);

  const points = useMemo(() => [start, ...waypoints, end], [start, waypoints, end]);
  const { route, loading: routeLoading, error: routeError } = useRoute(points, options);
  const { result: controls, loading: controlsLoading, error: controlsError } = useTrafficControls(route);
  useUrlSync(start, end, waypoints, options);

  // The route legs only line up with the waypoint list when they belong to
  // the current set of points; keep a ref so callbacks stay stable.
  const routeRef = useRef(route);
  routeRef.current = route;

  const addWaypoint = useCallback((p: LatLon, legHint?: LatLon) => {
    setWaypoints((wps) => {
      const legs = routeRef.current?.legs;
      const idx = insertionIndex(legHint ?? p, legs, wps.length);
      return insertAt(wps, idx, makeWaypoint(p));
    });
  }, []);

  const moveWaypoint = useCallback((id: string, p: LatLon) => {
    setWaypoints((wps) => wps.map((w) => (w.id === id ? { ...w, lat: p.lat, lon: p.lon } : w)));
  }, []);

  const removeWaypoint = useCallback((id: string) => {
    setWaypoints((wps) => wps.filter((w) => w.id !== id));
  }, []);

  const focusOn = useCallback((p: LatLon, zoom = 18) => {
    setFocus({ lat: p.lat, lon: p.lon, zoom, nonce: Date.now() });
  }, []);

  const focusControl = useCallback((c: TrafficControl) => focusOn(c), [focusOn]);

  const swap = () => {
    setStart(end);
    setEnd(start);
    setWaypoints((wps) => [...wps].reverse());
  };

  return (
    <div className="app">
      <SidePanel
        route={route}
        routeLoading={routeLoading}
        routeError={routeError}
        controls={controls}
        controlsLoading={controlsLoading}
        controlsError={controlsError}
        showRejected={showRejected}
        onShowRejected={setShowRejected}
        onFocusControl={focusControl}
        onFocusPoint={(p) => focusOn(p, 17)}
      >
        <Controls
          start={start}
          end={end}
          options={options}
          onStart={(p) => {
            setStart(p);
            setFitRequest((n) => n + 1);
          }}
          onEnd={(p) => {
            setEnd(p);
            setFitRequest((n) => n + 1);
          }}
          onSwap={swap}
          onOptions={setOptions}
        />
        <WaypointList
          waypoints={waypoints}
          onRemove={removeWaypoint}
          onClear={() => setWaypoints([])}
          onFocus={(p) => focusOn(p, 17)}
        />
      </SidePanel>
      <main className="map-wrap">
        <MapView
          start={start}
          end={end}
          waypoints={waypoints}
          route={route}
          controls={controls}
          showRejected={showRejected}
          focus={focus}
          fitRequest={fitRequest}
          onMoveStart={(p) => setStart(droppedLabel(p))}
          onMoveEnd={(p) => setEnd(droppedLabel(p))}
          onMoveWaypoint={moveWaypoint}
          onRemoveWaypoint={removeWaypoint}
          onAddWaypoint={addWaypoint}
        />
        {(routeLoading || controlsLoading) && <div className="map-busy">{routeLoading ? 'Routing…' : 'Counting…'}</div>}
      </main>
    </div>
  );
}
