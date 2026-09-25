export const METERS_PER_MILE = 1609.344;

export function formatMiles(meters: number): string {
  return `${(meters / METERS_PER_MILE).toFixed(2)} mi`;
}

export function formatDuration(seconds: number): string {
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

export function formatCoord(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
