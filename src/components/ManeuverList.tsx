import type { LatLon } from '../lib/geo';
import type { Route } from '../lib/valhalla';

export function ManeuverList({ route, onFocus }: { route: Route; onFocus: (p: LatLon) => void }) {
  const { maneuvers, shape } = route;
  return (
    <details className="card results">
      <summary>
        <h2>
          Turn-by-turn <span className="count-pill count-pill-muted">{maneuvers.length}</span>
        </h2>
      </summary>
      <ol className="man-list">
        {maneuvers.map((m, i) => (
          <li key={i}>
            <button
              type="button"
              className="man-item"
              onClick={() => {
                const p = shape[Math.min(m.shapeIndex, shape.length - 1)];
                if (p) onFocus(p);
              }}
            >
              <span>{m.instruction}</span>
              {m.length > 0 && <span className="res-dist">{m.length.toFixed(2)} mi</span>}
            </button>
          </li>
        ))}
      </ol>
    </details>
  );
}
