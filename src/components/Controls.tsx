import { useEffect, useState, type FormEvent } from 'react';
import { geocode } from '../lib/nominatim';
import { BICYCLE_TYPES, type BicycleType, type Place, type RouteOptions } from '../lib/types';

interface PlaceInputProps {
  kind: 'start' | 'end';
  place: Place;
  onChange: (p: Place) => void;
}

function PlaceInput({ kind, place, onChange }: PlaceInputProps) {
  const [text, setText] = useState(place.label);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reflect external changes (swap, marker drag).
  useEffect(() => setText(place.label), [place.label]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const q = text.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await geocode(q));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const id = `place-${kind}`;
  return (
    <form className="place" onSubmit={submit}>
      <label htmlFor={id} className={`place-badge place-badge-${kind}`} title={kind === 'start' ? 'Start' : 'End'}>
        {kind === 'start' ? 'S' : 'E'}
      </label>
      <input
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={kind === 'start' ? 'Start address' : 'Destination address'}
        autoComplete="off"
      />
      <button type="submit" disabled={busy} className="btn btn-small">
        {busy ? '…' : 'Geocode'}
      </button>
      {error && <div className="place-error">{error}</div>}
    </form>
  );
}

interface Props {
  start: Place;
  end: Place;
  options: RouteOptions;
  onStart: (p: Place) => void;
  onEnd: (p: Place) => void;
  onSwap: () => void;
  onOptions: (o: RouteOptions) => void;
}

export function Controls({ start, end, options, onStart, onEnd, onSwap, onOptions }: Props) {
  return (
    <section className="card">
      <div className="places">
        <div className="places-inputs">
          <PlaceInput kind="start" place={start} onChange={onStart} />
          <PlaceInput kind="end" place={end} onChange={onEnd} />
        </div>
        <button type="button" className="btn btn-icon" onClick={onSwap} title="Swap start and end" aria-label="Swap start and end">
          ⇅
        </button>
      </div>
      <div className="options">
        <label className="opt">
          <span>Bike</span>
          <select
            value={options.bicycleType}
            onChange={(e) => onOptions({ ...options, bicycleType: e.target.value as BicycleType })}
          >
            {BICYCLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <RangeOption
          label="Use roads"
          hint="0 = prefer paths, 1 = roads are fine"
          value={options.useRoads}
          onChange={(v) => onOptions({ ...options, useRoads: v })}
        />
        <RangeOption
          label="Use hills"
          hint="0 = avoid hills, 1 = don't care"
          value={options.useHills}
          onChange={(v) => onOptions({ ...options, useHills: v })}
        />
      </div>
    </section>
  );
}

/** A slider that only commits on release, so dragging it doesn't spam the router. */
function RangeOption({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const commit = () => {
    if (local !== value) onChange(local);
  };
  return (
    <label className="opt" title={hint}>
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.1}
        value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <output>{local.toFixed(1)}</output>
    </label>
  );
}
