import { ALLOWED_TARGET_COVERAGE } from "./forecastConstants.js";
import { parseRowsLimit } from "./forecastQuery.js";

/** Supplier export: `targetCoverageDays` must be present and valid (30 | 45 | 60). */
export function parseRequiredTargetCoverageDays(url: URL): number | null {
  const raw = url.searchParams.get("targetCoverageDays");
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || !ALLOWED_TARGET_COVERAGE.has(n)) return null;
  return n;
}

export type RedistributionRankingMode = "regional" | "fulfillment";

export interface RedistributionExportQuery {
  donorWarehouseKey: string;
  reserveDays: number;
  minTransferableUnits: number;
  maxSkuNetworks: number;
  rankingMode: RedistributionRankingMode;
  donorRowsLimit: number;
  targetCoverageDays: number;
}

export type RedistributionExportQueryResult =
  | { ok: true; query: RedistributionExportQuery }
  | { ok: false; error: string };

function parseBoundedNumber(
  url: URL,
  names: readonly string[],
  fallback: number,
  min: number,
  max: number,
  label: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const raw = names
    .map((name) => url.searchParams.get(name))
    .find((value): value is string => value !== null);
  if (raw === undefined || raw.trim() === "") {
    return { ok: true, value: fallback };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    return {
      ok: false,
      error: `${label} must be a number in ${min}..${max}`,
    };
  }
  return { ok: true, value: n };
}

function parseBoundedInteger(
  url: URL,
  names: readonly string[],
  fallback: number,
  min: number,
  max: number,
  label: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const parsed = parseBoundedNumber(url, names, fallback, min, max, label);
  if (!parsed.ok) return parsed;
  const value = Math.floor(parsed.value);
  if (value < min || value > max) {
    return {
      ok: false,
      error: `${label} must be an integer in ${min}..${max}`,
    };
  }
  return { ok: true, value };
}

export function parseRedistributionExportQuery(
  url: URL,
  targetCoverageDays: number | undefined,
): RedistributionExportQueryResult {
  const donorWarehouseKey =
    url.searchParams.get("donorWarehouseKey")?.trim() ||
    url.searchParams.get("donorKey")?.trim() ||
    "";
  if (donorWarehouseKey === "") {
    return { ok: false, error: "donorWarehouseKey required" };
  }

  const reserve = parseBoundedNumber(
    url,
    ["reserveDays", "donorReserveDays"],
    14,
    0,
    365,
    "reserveDays",
  );
  if (!reserve.ok) return reserve;

  const minTransferable = parseBoundedNumber(
    url,
    ["minTransferable", "minTransferableUnits"],
    1,
    0,
    1_000_000,
    "minTransferable",
  );
  if (!minTransferable.ok) return minTransferable;

  const maxSkuNetworks = parseBoundedInteger(
    url,
    ["maxSkuNetworks"],
    100,
    1,
    500,
    "maxSkuNetworks",
  );
  if (!maxSkuNetworks.ok) return maxSkuNetworks;

  const rankingRaw =
    url.searchParams.get("rankingMode")?.trim().toLowerCase() ?? "";
  const rankingMode: RedistributionRankingMode =
    rankingRaw === "fulfillment" ? "fulfillment" : "regional";

  return {
    ok: true,
    query: {
      donorWarehouseKey,
      reserveDays: reserve.value,
      minTransferableUnits: minTransferable.value,
      maxSkuNetworks: maxSkuNetworks.value,
      rankingMode,
      donorRowsLimit: parseRowsLimit(url),
      targetCoverageDays: targetCoverageDays ?? 30,
    },
  };
}
