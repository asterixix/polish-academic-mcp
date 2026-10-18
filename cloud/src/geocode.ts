import type { CloudEnv } from "./env.js";
import { jsonResponse } from "./crypto-util.js";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const UA = "polish-academic-mcp/1.3 (https://pamcp.pl; contact via GitHub issues)";
const CACHE_TTL = 60 * 60 * 24 * 90;

export type GeoPoint = { lat: number; lon: number } | null;

export async function handleGeocodeRoutes(
  request: Request,
  env: CloudEnv,
  path: string,
): Promise<Response | null> {
  if (path !== "/api/geocode" || request.method !== "GET") return null;
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 3 || q.length > 300) {
    return jsonResponse({ error: "Parametr q: 3-300 znaków." }, { status: 400 });
  }
  const key = `geocode:v1:${q.toLowerCase()}`;
  const cached = await env.CACHE_KV.get(key, "json");
  if (cached !== null) return jsonResponse({ point: cached as GeoPoint, cached: true });

  const res = await fetch(`${NOMINATIM}?format=json&limit=1&q=${encodeURIComponent(q)}`, {
    headers: { "User-Agent": UA, "Accept-Language": "pl" },
  });
  if (!res.ok) return jsonResponse({ error: `Geokodowanie: HTTP ${res.status}` }, { status: 502 });
  const hits = (await res.json()) as { lat: string; lon: string }[];
  const point: GeoPoint = hits[0] ? { lat: Number(hits[0].lat), lon: Number(hits[0].lon) } : null;
  await env.CACHE_KV.put(key, JSON.stringify(point), { expirationTtl: CACHE_TTL });
  return jsonResponse({ point, cached: false });
}
