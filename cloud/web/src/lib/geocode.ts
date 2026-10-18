export type Point = { lat: number; lon: number } | null;

let queue: Promise<unknown> = Promise.resolve();

// Worker proxies Nominatim (sets User-Agent, caches in KV); serialized to stay under 1 req/s.
export function geocode(query: string): Promise<Point> {
  const run = queue.then(async () => {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`geocode HTTP ${res.status}`);
    const data = (await res.json()) as { point: Point };
    return data.point;
  });
  queue = run.catch(() => null).then(() => new Promise((r) => setTimeout(r, 1100)));
  return run;
}
