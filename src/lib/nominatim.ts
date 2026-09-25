import type { Place } from './types';

export async function geocode(query: string, signal?: AbortSignal): Promise<Place> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Geocoding failed (HTTP ${res.status})`);
  const json = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  const hit = json[0];
  if (!hit) throw new Error(`No match for "${query}"`);
  return { lat: Number(hit.lat), lon: Number(hit.lon), label: query };
}
