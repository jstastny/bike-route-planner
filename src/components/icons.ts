import L from 'leaflet';

/**
 * All markers use L.divIcon, which sidesteps Leaflet's default-icon image
 * URL problem under Vite and lets us style everything with CSS.
 */
const cache = new Map<string, L.DivIcon>();

function cached(key: string, make: () => L.DivIcon): L.DivIcon {
  let icon = cache.get(key);
  if (!icon) cache.set(key, (icon = make()));
  return icon;
}

export function endpointIcon(kind: 'start' | 'end'): L.DivIcon {
  return cached(kind, () =>
    L.divIcon({
      className: `pin pin-${kind}`,
      html: `<span>${kind === 'start' ? 'S' : 'E'}</span>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    }),
  );
}

export function waypointIcon(n: number, ghost = false): L.DivIcon {
  return cached(`wp${n}${ghost ? 'g' : ''}`, () =>
    L.divIcon({
      className: `pin pin-waypoint${ghost ? ' pin-ghost' : ''}`,
      html: `<span>${n}</span>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    }),
  );
}

const OCTAGON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="7,1 17,1 23,7 23,17 17,23 7,23 1,17 1,7"/></svg>';

export function stopIcon(uncertain: boolean, allWay: boolean): L.DivIcon {
  return cached(`stop${uncertain ? 'u' : ''}${allWay ? 'a' : ''}`, () =>
    L.divIcon({
      className: `ctl ctl-stop${uncertain ? ' ctl-uncertain' : ''}${allWay ? ' ctl-allway' : ''}`,
      html: OCTAGON,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    }),
  );
}

export function signalIcon(crossing: boolean, uncertain: boolean): L.DivIcon {
  return cached(`sig${crossing ? 'x' : ''}${uncertain ? 'u' : ''}`, () =>
    L.divIcon({
      className: `ctl ctl-signal${crossing ? ' ctl-crossing' : ''}${uncertain ? ' ctl-uncertain' : ''}`,
      html: '<span></span>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    }),
  );
}

export function rejectedIcon(kind: 'stop' | 'signal' | 'crossing'): L.DivIcon {
  return cached(`rej-${kind}`, () =>
    L.divIcon({
      className: `ctl ctl-rejected ctl-rejected-${kind}`,
      html: kind === 'stop' ? OCTAGON : '<span></span>',
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    }),
  );
}
