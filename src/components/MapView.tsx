import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayersControl,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import type { LatLon } from '../lib/geo';
import { formatMiles } from '../lib/format';
import type { RejectedNode, TrafficControl, TrafficControlResult } from '../lib/signals';
import type { Place, Waypoint } from '../lib/types';
import type { Route } from '../lib/valhalla';
import { endpointIcon, rejectedIcon, signalIcon, stopIcon, waypointIcon } from './icons';

export interface FocusRequest extends LatLon {
  zoom: number;
  nonce: number;
}

interface Props {
  start: Place;
  end: Place;
  waypoints: Waypoint[];
  route: Route | null;
  controls: TrafficControlResult | null;
  showRejected: boolean;
  focus: FocusRequest | null;
  /** Incremented when the map should fit the route/endpoints. */
  fitRequest: number;
  onMoveStart: (p: LatLon) => void;
  onMoveEnd: (p: LatLon) => void;
  onMoveWaypoint: (id: string, p: LatLon) => void;
  onRemoveWaypoint: (id: string) => void;
  /** Add a waypoint at `p`; `legHint` is where on the route line the user grabbed it. */
  onAddWaypoint: (p: LatLon, legHint?: LatLon) => void;
}

const toLL = (p: LatLon): L.LatLngTuple => [p.lat, p.lon];
const fromLL = (ll: L.LatLng): LatLon => ({ lat: ll.lat, lon: ll.lng });

export function MapView(props: Props) {
  const { start, end } = props;
  const initialBounds = useMemo(
    () => L.latLngBounds([toLL(start), toLL(end)]).pad(0.15),
    // Only the initial bounds matter; later fits are driven by fitRequest.
    [],
  );
  return (
    <MapContainer bounds={initialBounds} className="map" zoomControl={true}>
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="OpenStreetMap">
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="CyclOSM">
          <TileLayer
            url="https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png"
            subdomains="abc"
            maxZoom={20}
            attribution='<a href="https://www.cyclosm.org">CyclOSM</a> | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
        </LayersControl.BaseLayer>
      </LayersControl>
      <MapBehaviour {...props} />
    </MapContainer>
  );
}

/** Everything that needs the map instance. */
function MapBehaviour({
  start,
  end,
  waypoints,
  route,
  controls,
  showRejected,
  focus,
  fitRequest,
  onMoveStart,
  onMoveEnd,
  onMoveWaypoint,
  onRemoveWaypoint,
  onAddWaypoint,
}: Props) {
  const map = useMap();
  const suppressClickUntil = useRef(0);
  const [ghost, setGhost] = useState<LatLon | null>(null);

  // Click on the map: add a waypoint.
  useMapEvents({
    click(e) {
      if (Date.now() < suppressClickUntil.current) return;
      onAddWaypoint(fromLL(e.latlng));
    },
  });

  // Fit to the route when requested. After a request we wait for a route
  // object different from the one current at request time (the new route).
  const lastFitRequest = useRef(fitRequest);
  const awaitingFit = useRef<{ staleRoute: Route | null } | null>({ staleRoute: null });
  useEffect(() => {
    if (fitRequest !== lastFitRequest.current) {
      lastFitRequest.current = fitRequest;
      awaitingFit.current = { staleRoute: route };
      map.fitBounds(L.latLngBounds([toLL(start), toLL(end)]), { padding: [40, 40] });
      return;
    }
    const pending = awaitingFit.current;
    if (pending && route && route !== pending.staleRoute) {
      map.fitBounds(L.latLngBounds(route.shape.map(toLL)), { padding: [30, 30] });
      awaitingFit.current = null;
    }
  }, [fitRequest, route, map, start, end]);

  useEffect(() => {
    if (focus) map.flyTo(toLL(focus), focus.zoom, { duration: 0.6 });
  }, [focus, map]);

  // Drag the route line to create a waypoint (Google-Maps style).
  const routeHandlers = useMemo<L.LeafletEventHandlerFnMap>(
    () => ({
      mousedown(e: L.LeafletMouseEvent) {
        if (e.originalEvent.button !== 0) return;
        L.DomEvent.stop(e.originalEvent);
        map.dragging.disable();
        const grabbed = fromLL(e.latlng);
        let current = grabbed;
        setGhost(grabbed);
        const onMove = (ev: MouseEvent) => {
          current = fromLL(map.mouseEventToLatLng(ev));
          setGhost(current);
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          map.dragging.enable();
          setGhost(null);
          suppressClickUntil.current = Date.now() + 400;
          onAddWaypoint(current, grabbed);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      },
    }),
    [map, onAddWaypoint],
  );

  const routeLatLngs = useMemo(() => route?.shape.map(toLL) ?? [], [route]);

  return (
    <>
      {routeLatLngs.length > 1 && (
        <>
          <Polyline
            positions={routeLatLngs}
            pathOptions={{ color: '#ffffff', weight: 11, opacity: 0.85, interactive: false }}
          />
          <Polyline
            positions={routeLatLngs}
            pathOptions={{ color: '#1d4ed8', weight: 6, opacity: 0.7, interactive: false }}
          />
          {/* Wide invisible hit area for grabbing the line. */}
          <Polyline
            positions={routeLatLngs}
            pathOptions={{ color: '#000', weight: 22, opacity: 0, bubblingMouseEvents: false, className: 'route-hit' }}
            eventHandlers={routeHandlers}
          >
            <Tooltip sticky>Drag to add a waypoint</Tooltip>
          </Polyline>
        </>
      )}

      {showRejected &&
        controls?.rejected.map((r) => <RejectedMarker key={`rej-${r.node.id}`} r={r} />)}
      {controls?.stops.map((c) => <ControlMarker key={c.id} c={c} />)}
      {controls?.signals.map((c) => <ControlMarker key={c.id} c={c} />)}

      {waypoints.map((w, i) => (
        <Marker
          key={w.id}
          position={toLL(w)}
          icon={waypointIcon(i + 1)}
          draggable
          zIndexOffset={900}
          eventHandlers={{
            dragend: (e) => onMoveWaypoint(w.id, fromLL((e.target as L.Marker).getLatLng())),
            contextmenu: (e) => {
              L.DomEvent.preventDefault(e.originalEvent);
              onRemoveWaypoint(w.id);
            },
          }}
        >
          <Tooltip direction="top" offset={[0, -10]}>
            Waypoint {i + 1}: drag to move, right-click to remove
          </Tooltip>
        </Marker>
      ))}
      {ghost && <Marker position={toLL(ghost)} icon={waypointIcon(0, true)} interactive={false} />}

      <Marker
        position={toLL(start)}
        icon={endpointIcon('start')}
        draggable
        zIndexOffset={1000}
        eventHandlers={{ dragend: (e) => onMoveStart(fromLL((e.target as L.Marker).getLatLng())) }}
      >
        <Tooltip direction="top" offset={[0, -12]}>
          Start: {start.label}
        </Tooltip>
      </Marker>
      <Marker
        position={toLL(end)}
        icon={endpointIcon('end')}
        draggable
        zIndexOffset={1000}
        eventHandlers={{ dragend: (e) => onMoveEnd(fromLL((e.target as L.Marker).getLatLng())) }}
      >
        <Tooltip direction="top" offset={[0, -12]}>
          End: {end.label}
        </Tooltip>
      </Marker>
    </>
  );
}

function ControlMarker({ c }: { c: TrafficControl }) {
  const icon =
    c.kind === 'stop'
      ? stopIcon(c.uncertain, c.stopType === 'all')
      : signalIcon(c.kind === 'crossing', c.uncertain);
  return (
    <Marker position={[c.lat, c.lon]} icon={icon} zIndexOffset={500}>
      <Tooltip direction="top" offset={[0, -8]}>
        <strong>{c.label}</strong>
        <br />
        {formatMiles(c.along)} from start
        {c.uncertain && (
          <>
            <br />
            <em>Uncertain: no direction tag at a junction</em>
          </>
        )}
        <br />
        <span className="tt-muted">
          OSM node{c.members.length > 1 ? 's' : ''}: {c.members.map((m) => m.node.id).join(', ')}
        </span>
      </Tooltip>
    </Marker>
  );
}

function RejectedMarker({ r }: { r: RejectedNode }) {
  return (
    <Marker position={[r.node.lat, r.node.lon]} icon={rejectedIcon(r.kind)} zIndexOffset={100}>
      <Tooltip direction="top" offset={[0, -6]}>
        <strong>Not counted</strong> ({r.kind === 'stop' ? 'stop sign' : r.kind === 'signal' ? 'traffic signal' : 'signalized crossing'})
        <br />
        {r.reason}
        <br />
        <span className="tt-muted">
          OSM node {r.node.id}, {r.offset.toFixed(1)} m from route
        </span>
      </Tooltip>
    </Marker>
  );
}
