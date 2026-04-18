import { ALLOWED_TARGET_COVERAGE } from "./forecastConstants.js";

/** Supplier export: `targetCoverageDays` must be present and valid (30 | 45 | 60). */
export function parseRequiredTargetCoverageDays(url: URL): number | null {
  const raw = url.searchParams.get("targetCoverageDays");
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || !ALLOWED_TARGET_COVERAGE.has(n)) return null;
  return n;
}
