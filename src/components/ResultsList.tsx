import { formatMiles } from '../lib/format';
import type { TrafficControl } from '../lib/signals';

interface Props {
  title: string;
  kind: 'stop' | 'signal';
  items: TrafficControl[];
  onFocus: (c: TrafficControl) => void;
}

export function ResultsList({ title, kind, items, onFocus }: Props) {
  return (
    <details className="card results" open>
      <summary>
        <h2>
          {title} <span className="count-pill">{items.length}</span>
        </h2>
      </summary>
      {items.length === 0 ? (
        <p className="hint">None found along this route.</p>
      ) : (
        <ol className="res-list">
          {items.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={`res-item${c.uncertain ? ' res-uncertain' : ''}`}
                onClick={() => onFocus(c)}
              >
                <span className={`res-icon res-icon-${kind}${c.kind === 'crossing' ? ' res-icon-crossing' : ''}`} aria-hidden="true" />
                <span className="res-main">
                  <span className="res-name">{c.street && c.crossStreet ? `${c.street} & ${c.crossStreet}` : (c.street ?? c.crossStreet ?? 'Unnamed road')}</span>
                  <span className="res-meta">
                    {kind === 'stop' && (c.stopType === 'all' ? 'All-way stop' : c.stopType === 'minor' ? 'Stop (minor road)' : 'Stop')}
                    {c.kind === 'signal' && 'Traffic light'}
                    {c.kind === 'crossing' && 'Signalized crossing'}
                    {c.uncertain && ' · uncertain'}
                  </span>
                </span>
                <span className="res-dist">{formatMiles(c.along)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
