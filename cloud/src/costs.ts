import { EXTRACT_MAX_URLS, PARALLEL_EXTRACT_USD_PER_URL, PARALLEL_SEARCH_USD_PER_CALL } from "./parallel.js";

/** Source: developers.cloudflare.com/workers/platform/pricing (Workers Standard, requests beyond 10M/month). */
export const CF_REQUEST_USD_PER_MILLION = 0.3;
export const CF_INCLUDED_REQUESTS_PER_MONTH = 10_000_000;
export const COST_MAX_RANGE_DAYS = 180;

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Default: last 30 days ending today (UTC). Clamped to COST_MAX_RANGE_DAYS and to today. */
export function parseCostRange(
  fromRaw: string | null,
  toRaw: string | null,
  now = new Date(),
): { from: string; to: string } | { error: string } {
  const today = now.toISOString().slice(0, 10);
  const to = toRaw || today;
  const from = fromRaw || addDays(to, -29);
  if (!isDay(from) || !isDay(to)) return { error: "Daty podaj w formacie YYYY-MM-DD." };
  if (from > to) return { error: "Data początkowa jest późniejsza niż końcowa." };
  const end = to > today ? today : to;
  const earliest = addDays(end, -(COST_MAX_RANGE_DAYS - 1));
  const start = from > end ? end : from < earliest ? earliest : from;
  return { from: start, to: end };
}

export function parallelCostUsd(searchCalls: number, extractUrls: number): number {
  return searchCalls * PARALLEL_SEARCH_USD_PER_CALL + extractUrls * PARALLEL_EXTRACT_USD_PER_URL;
}

/** Estimate: requests above the monthly included allotment only; CPU-time overage not included. */
export function cfRequestOverageUsd(requests: number): number {
  return (Math.max(0, requests - CF_INCLUDED_REQUESTS_PER_MONTH) / 1_000_000) * CF_REQUEST_USD_PER_MILLION;
}

/** Counts billed Parallel usage from audit tool calls. Failed calls are skipped (not reliably billed). */
export function parallelUsageFromToolCalls(
  calls: Array<{ name: string; arguments: Record<string, unknown>; is_error?: boolean }>,
): { search_calls: number; extract_urls: number } {
  let search_calls = 0;
  let extract_urls = 0;
  for (const c of calls) {
    if (c.is_error) continue;
    if (c.name === "web_search") search_calls++;
    else if (c.name === "web_fetch") {
      const urls = Array.isArray(c.arguments.urls) ? c.arguments.urls.length : 0;
      extract_urls += Math.min(urls, EXTRACT_MAX_URLS);
    }
  }
  return { search_calls, extract_urls };
}
