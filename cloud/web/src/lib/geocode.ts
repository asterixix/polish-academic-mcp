export type Point = { lat: number; lon: number } | null;

const KEY = "geocode-cache-v1";
const cache: Record<string, Point> = loadCache();
let queue: Promise<unknown> = Promise.resolve();

function loadCache(): Record<string, Point> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

// Nominatim allows max 1 request per second; calls are serialized through `queue`.
export function geocode(query: string): Promise<Point> {
  if (query in cache) return Promise.resolve(cache[query]);
  const run = queue.then(async () => {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
      { headers: { "Accept-Language": "pl" } },
    );
    if (!res.ok) throw new Error(`geocode HTTP ${res.status}`);
    const hits = (await res.json()) as { lat: string; lon: string }[];
    const point = hits[0] ? { lat: Number(hits[0].lat), lon: Number(hits[0].lon) } : null;
    cache[query] = point;
    localStorage.setItem(KEY, JSON.stringify(cache));
    return point;
  });
  queue = run.catch(() => null).then(() => new Promise((r) => setTimeout(r, 1100)));
  return run;
}
