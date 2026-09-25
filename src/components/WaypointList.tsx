import { formatCoord } from '../lib/format';
import type { LatLon } from '../lib/geo';
import type { Waypoint } from '../lib/types';

interface Props {
  waypoints: Waypoint[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onFocus: (p: LatLon) => void;
}

export function WaypointList({ waypoints, onRemove, onClear, onFocus }: Props) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Waypoints</h2>
        {waypoints.length > 0 && (
          <button type="button" className="btn btn-link" onClick={onClear}>
            Clear waypoints
          </button>
        )}
      </div>
      {waypoints.length === 0 ? (
        <p className="hint">Click the map, or drag the blue route line, to add a waypoint.</p>
      ) : (
        <ol className="wp-list">
          {waypoints.map((w, i) => (
            <li key={w.id}>
              <span className="wp-num">{i + 1}</span>
              <button type="button" className="wp-coord" onClick={() => onFocus(w)}>
                {formatCoord(w.lat, w.lon)}
              </button>
              <button
                type="button"
                className="btn btn-x"
                onClick={() => onRemove(w.id)}
                aria-label={`Remove waypoint ${i + 1}`}
                title="Remove waypoint"
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
