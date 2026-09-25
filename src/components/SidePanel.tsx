import type { ReactNode } from 'react';
import { formatDuration } from '../lib/format';
import type { LatLon } from '../lib/geo';
import type { TrafficControl, TrafficControlResult } from '../lib/signals';
import type { Route } from '../lib/valhalla';
import { ManeuverList } from './ManeuverList';
import { ResultsList } from './ResultsList';

interface Props {
  route: Route | null;
  routeLoading: boolean;
  routeError: string | null;
  controls: TrafficControlResult | null;
  controlsLoading: boolean;
  controlsError: string | null;
  showRejected: boolean;
  onShowRejected: (v: boolean) => void;
  onFocusControl: (c: TrafficControl) => void;
  onFocusPoint: (p: LatLon) => void;
  /** Controls + waypoint list, rendered between the tiles and the results. */
  children: ReactNode;
}

export function SidePanel({
  route,
  routeLoading,
  routeError,
  controls,
  controlsLoading,
  controlsError,
  showRejected,
  onShowRejected,
  onFocusControl,
  onFocusPoint,
  children,
}: Props) {
  const pending = controlsLoading || (route !== null && controls === null && !controlsError);
  const uncertainStops = controls?.stops.filter((s) => s.uncertain).length ?? 0;
  return (
    <aside className="panel">
      <header className="panel-head">
        <h1>Bike route planner</h1>
        <p>Counts the stop signs and traffic lights on your ride.</p>
      </header>

      <section className="tiles" aria-live="polite">
        <div className="tile tile-stop">
          <span className="tile-label">Stop signs</span>
          <span className="tile-value">{pending && !controls ? '…' : (controls?.stops.length ?? '–')}</span>
          {uncertainStops > 0 && <span className="tile-note">{uncertainStops} uncertain</span>}
        </div>
        <div className="tile tile-signal">
          <span className="tile-label">Traffic lights</span>
          <span className="tile-value">{pending && !controls ? '…' : (controls?.signals.length ?? '–')}</span>
        </div>
        <div className="tile tile-small">
          <span className="tile-label">Distance</span>
          <span className="tile-value">{route ? `${route.lengthMiles.toFixed(2)} mi` : '–'}</span>
          {route && <span className="tile-note">{(route.lengthMiles * 1.609344).toFixed(2)} km</span>}
        </div>
        <div className="tile tile-small">
          <span className="tile-label">Time</span>
          <span className="tile-value">{route ? formatDuration(route.timeSeconds) : '–'}</span>
        </div>
      </section>

      <div className="status">
        {routeLoading && <span className="spinner-line"><span className="spinner" /> Routing…</span>}
        {!routeLoading && controlsLoading && (
          <span className="spinner-line"><span className="spinner" /> Loading stop signs &amp; signals…</span>
        )}
        {routeError && <div className="error">Routing error: {routeError}</div>}
        {controlsError && <div className="error">{controlsError}</div>}
      </div>

      {children}

      {controls && (
        <>
          <ResultsList title="Stop signs" kind="stop" items={controls.stops} onFocus={onFocusControl} />
          <ResultsList title="Traffic lights" kind="signal" items={controls.signals} onFocus={onFocusControl} />
          <label className="toggle">
            <input type="checkbox" checked={showRejected} onChange={(e) => onShowRejected(e.target.checked)} />
            Show unmatched nearby ({controls.rejected.length}): nodes within 12 m that were not counted
          </label>
        </>
      )}

      {route && <ManeuverList route={route} onFocus={onFocusPoint} />}

      <footer className="footer">
        <p>
          Map data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>.
          Routing by <a href="https://valhalla.github.io/valhalla/" target="_blank" rel="noreferrer">Valhalla</a> (public server by{' '}
          <a href="https://www.fossgis.de/" target="_blank" rel="noreferrer">FOSSGIS e.V.</a>). Stop signs and signals from the{' '}
          <a href="https://overpass-api.de/" target="_blank" rel="noreferrer">Overpass API</a>. Geocoding by{' '}
          <a href="https://nominatim.org/" target="_blank" rel="noreferrer">Nominatim</a>.
        </p>
        <p className="footnote">
          Counts come from OpenStreetMap tagging and may be incomplete or wrong where signs are unmapped or
          lack a direction tag. Always obey the signs you actually see.
        </p>
      </footer>
    </aside>
  );
}
