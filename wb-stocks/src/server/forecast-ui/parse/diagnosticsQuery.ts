import {
  ORDERS_DIAG_MAX_RANGE_DAYS,
  RAW_ORDERS_DIAG_LIMIT_DEFAULT,
  RAW_ORDERS_DIAG_LIMIT_MAX,
} from "./forecastConstants.js";

export function parseOrdersDiagnosticsDateRange(url: URL):
  | { ok: true; dateFrom: string; dateTo: string }
  | { ok: false; error: string } {
  const dateFrom = url.searchParams.get("dateFrom")?.trim() ?? "";
  const dateTo = url.searchParams.get("dateTo")?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    return { ok: false, error: "dateFrom and dateTo (YYYY-MM-DD) required" };
  }
  if (dateFrom > dateTo) return { ok: false, error: "dateFrom must be <= dateTo" };
  const ms = Date.parse(`${dateTo}T12:00:00Z`) - Date.parse(`${dateFrom}T12:00:00Z`);
  const days = ms / 86400000;
  if (days < 0 || days > ORDERS_DIAG_MAX_RANGE_DAYS) {
    return {
      ok: false,
      error: `date range must be at most ${ORDERS_DIAG_MAX_RANGE_DAYS} days`,
    };
  }
  return { ok: true, dateFrom, dateTo };
}

export function parseOptionalVendorCode(url: URL): string | undefined {
  const v = url.searchParams.get("vendorCode")?.trim() ?? "";
  return v === "" ? undefined : v;
}

export function parseRawOrdersDiagnosticsLimit(url: URL): number {
  const limitRaw = url.searchParams.get("limit");
  let limit = RAW_ORDERS_DIAG_LIMIT_DEFAULT;
  if (limitRaw != null && limitRaw.trim() !== "") {
    const n = Number(limitRaw);
    if (Number.isInteger(n) && n >= 1) {
      limit = Math.min(n, RAW_ORDERS_DIAG_LIMIT_MAX);
    }
  }
  return limit;
}
