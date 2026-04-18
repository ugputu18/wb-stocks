import type { ForecastViewMode, SystemQuickFilter } from "../api/types.js";

/** Form/query state aligned with legacy `app.js` + `parseQuery` on server. */
export interface ForecastUrlFormState {
  snapshotDate: string;
  horizonDays: string;
  warehouseKey: string;
  q: string;
  techSize: string;
  riskStockout: string;
  targetCoverageDays: string;
  replenishmentMode: "wb" | "supplier";
  ownWarehouseCode: string;
  leadTimeDays: string;
  coverageDays: string;
  safetyDays: string;
  viewMode: ForecastViewMode;
  systemQuickFilter: SystemQuickFilter;
  rowLimit: string;
}

const ALLOWED_HORIZON = new Set(["30", "60", "90"]);
const ALLOWED_LIMIT = new Set(["250", "500", "1000", "2000"]);
const ALLOWED_RISK = new Set([
  "all",
  "lt7",
  "lt14",
  "lt30",
  "lt45",
  "lt60",
]);
const ALLOWED_TARGET_COV = new Set(["30", "45", "60"]);

export const SUPPLIER_LEAD_TIME_MIN = 1;
export const SUPPLIER_LEAD_TIME_MAX = 1000;

function todayYmd(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function clampIntStr(
  raw: string | null | undefined,
  min: number,
  max: number,
  fallback: string,
): string {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return String(n);
}

export function parseViewModeParam(raw: string | null | undefined): ForecastViewMode {
  const t = (raw ?? "").trim().toLowerCase();
  if (t === "wbwarehouses" || t === "warehouses" || t === "by-warehouse") {
    return "wbWarehouses";
  }
  if (t === "wbtotal" || t === "wb" || t === "wb-network") {
    return "wbTotal";
  }
  if (
    t === "" ||
    t === "systemtotal" ||
    t === "system" ||
    t === "system-stock" ||
    t === "stocks"
  ) {
    return "systemTotal";
  }
  return "wbTotal";
}

export function parseSystemQuickFilterParam(
  raw: string | null | undefined,
  viewMode: ForecastViewMode,
): SystemQuickFilter {
  if (viewMode !== "systemTotal") return "all";
  const t = (raw ?? "").trim().toLowerCase();
  if (t === "systemrisk" || t === "system_risk") return "systemRisk";
  if (
    t === "supplierorder" ||
    t === "supplier" ||
    t === "from_supplier"
  ) {
    return "supplierOrder";
  }
  if (t === "wbreplenish" || t === "towb" || t === "on_wb") {
    return "wbReplenish";
  }
  return "all";
}

export function defaultFormState(): ForecastUrlFormState {
  return {
    snapshotDate: todayYmd(),
    horizonDays: "30",
    warehouseKey: "",
    q: "",
    techSize: "",
    riskStockout: "all",
    targetCoverageDays: "30",
    replenishmentMode: "wb",
    ownWarehouseCode: "",
    leadTimeDays: "45",
    coverageDays: "90",
    safetyDays: "0",
    viewMode: "systemTotal",
    systemQuickFilter: "all",
    rowLimit: "500",
  };
}

export function formStateFromSearchParams(
  params: URLSearchParams,
): ForecastUrlFormState {
  const base = defaultFormState();

  const sd = params.get("snapshotDate")?.trim();
  if (sd && /^\d{4}-\d{2}-\d{2}$/.test(sd)) {
    base.snapshotDate = sd;
  }

  const h = params.get("horizonDays")?.trim();
  base.horizonDays = ALLOWED_HORIZON.has(h ?? "") ? h! : "30";

  base.viewMode = parseViewModeParam(params.get("viewMode"));
  base.systemQuickFilter = parseSystemQuickFilterParam(
    params.get("systemQuickFilter"),
    base.viewMode,
  );

  const wk = params.get("warehouseKey");
  base.warehouseKey = wk !== null ? wk.trim() : "";

  const r = params.get("riskStockout")?.trim();
  base.riskStockout = ALLOWED_RISK.has(r ?? "") ? r! : "all";

  base.replenishmentMode =
    params.get("replenishmentMode")?.trim() === "supplier" ? "supplier" : "wb";

  const tc = params.get("targetCoverageDays")?.trim();
  base.targetCoverageDays = ALLOWED_TARGET_COV.has(tc ?? "") ? tc! : "30";

  const ownP = params.get("ownWarehouseCode");
  base.ownWarehouseCode = ownP !== null ? ownP.trim() : "";

  const lim = params.get("limit")?.trim();
  base.rowLimit = ALLOWED_LIMIT.has(lim ?? "") ? lim! : "500";

  base.leadTimeDays = clampIntStr(
    params.get("leadTimeDays"),
    SUPPLIER_LEAD_TIME_MIN,
    SUPPLIER_LEAD_TIME_MAX,
    "45",
  );
  base.coverageDays = clampIntStr(params.get("coverageDays"), 1, 730, "90");
  base.safetyDays = clampIntStr(params.get("safetyDays"), 0, 365, "0");

  const qRaw = params.get("q");
  base.q = qRaw != null ? String(qRaw) : "";

  const ts = params.get("techSize");
  base.techSize = ts != null ? String(ts) : "";

  return base;
}

/** Same keys as legacy `queryParams()` (for summary + rows + warehouse-keys). */
export function toSummaryRowsSearchParams(f: ForecastUrlFormState): URLSearchParams {
  const leadTimeDays = clampIntStr(
    f.leadTimeDays,
    SUPPLIER_LEAD_TIME_MIN,
    SUPPLIER_LEAD_TIME_MAX,
    "45",
  );
  const p = new URLSearchParams({
    snapshotDate: f.snapshotDate,
    horizonDays: f.horizonDays,
    riskStockout: f.riskStockout,
    targetCoverageDays: f.targetCoverageDays,
    replenishmentMode: f.replenishmentMode,
    leadTimeDays,
    coverageDays: f.coverageDays,
    safetyDays: f.safetyDays,
    viewMode: f.viewMode,
  });
  if (f.viewMode === "systemTotal" && f.systemQuickFilter !== "all") {
    p.set("systemQuickFilter", f.systemQuickFilter);
  }
  if (f.warehouseKey) p.set("warehouseKey", f.warehouseKey);
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.techSize.trim()) p.set("techSize", f.techSize.trim());
  if (f.ownWarehouseCode.trim()) {
    p.set("ownWarehouseCode", f.ownWarehouseCode.trim());
  }
  return p;
}

export function toRowsSearchParams(f: ForecastUrlFormState): URLSearchParams {
  const p = toSummaryRowsSearchParams(f);
  p.set("limit", f.rowLimit);
  return p;
}

/** Legacy `supplierQueryParams` — без `riskStockout` и без `limit`. */
export function toSupplierSearchParams(f: ForecastUrlFormState): URLSearchParams {
  const leadTimeDays = clampIntStr(
    f.leadTimeDays,
    SUPPLIER_LEAD_TIME_MIN,
    SUPPLIER_LEAD_TIME_MAX,
    "45",
  );
  const p = new URLSearchParams({
    snapshotDate: f.snapshotDate,
    horizonDays: f.horizonDays,
    targetCoverageDays: f.targetCoverageDays,
    replenishmentMode: f.replenishmentMode,
    leadTimeDays,
    coverageDays: f.coverageDays,
    safetyDays: f.safetyDays,
    viewMode: f.viewMode,
  });
  if (f.warehouseKey) p.set("warehouseKey", f.warehouseKey);
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.techSize.trim()) p.set("techSize", f.techSize.trim());
  if (f.ownWarehouseCode.trim()) {
    p.set("ownWarehouseCode", f.ownWarehouseCode.trim());
  }
  return p;
}

/** Minimal params for warehouse-keys (snapshot + horizon only). */
export function toWarehouseKeysSearchParams(f: ForecastUrlFormState): URLSearchParams {
  return new URLSearchParams({
    snapshotDate: f.snapshotDate,
    horizonDays: f.horizonDays,
  });
}
