import type { ReplenishmentMode } from "../../../domain/multiLevelInventory.js";
import type {
  ForecastReportFilter,
  ForecastViewMode,
  RiskStockoutFilter,
} from "../../../infra/wbForecastSnapshotRepository.js";
import {
  ALLOWED_TARGET_COVERAGE,
  DEFAULT_OWN_WAREHOUSE_CODE,
  DEFAULT_SUPPLIER_LEAD_DAYS,
  DEFAULT_SUPPLIER_ORDER_COVERAGE_DAYS,
  DEFAULT_SUPPLIER_SAFETY_DAYS,
  MAX_SUPPLIER_LEAD_DAYS,
  ROWS_LIMIT_DEFAULT,
  ROWS_LIMIT_MAX,
  ROWS_LIMIT_MIN,
} from "./forecastConstants.js";

export function parseSupplierLeadTimeDays(url: URL): number {
  const raw = url.searchParams.get("leadTimeDays");
  if (raw === null || raw.trim() === "") return DEFAULT_SUPPLIER_LEAD_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SUPPLIER_LEAD_DAYS) {
    return DEFAULT_SUPPLIER_LEAD_DAYS;
  }
  return n;
}

/** Покрытие после прихода (план заказа); не путать с `targetCoverageDays`. */
export function parseSupplierOrderCoverageDays(url: URL): number {
  const raw = url.searchParams.get("coverageDays");
  if (raw === null || raw.trim() === "") return DEFAULT_SUPPLIER_ORDER_COVERAGE_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 730) return DEFAULT_SUPPLIER_ORDER_COVERAGE_DAYS;
  return n;
}

export function parseSupplierSafetyDays(url: URL): number {
  const raw = url.searchParams.get("safetyDays");
  if (raw === null || raw.trim() === "") return DEFAULT_SUPPLIER_SAFETY_DAYS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 365) return DEFAULT_SUPPLIER_SAFETY_DAYS;
  return n;
}

export function parseRiskStockout(raw: string | null): RiskStockoutFilter {
  const t = raw?.trim().toLowerCase() ?? "";
  if (t === "" || t === "all") return "all";
  if (t === "lt7" || t === "<7" || t === "under7") return "lt7";
  if (t === "lt14" || t === "<14" || t === "under14") return "lt14";
  if (t === "lt30" || t === "<30" || t === "under30") return "lt30";
  if (t === "lt45" || t === "<45" || t === "under45") return "lt45";
  if (t === "lt60" || t === "<60" || t === "under60") return "lt60";
  return "all";
}

export function parseTargetCoverageDays(url: URL): number | undefined {
  const raw = url.searchParams.get("targetCoverageDays");
  if (raw === null || raw.trim() === "") return 30;
  const n = Number(raw);
  if (!Number.isInteger(n) || !ALLOWED_TARGET_COVERAGE.has(n)) return 30;
  return n;
}

export function parseReplenishmentMode(url: URL): ReplenishmentMode {
  const raw = url.searchParams.get("replenishmentMode")?.trim().toLowerCase() ?? "";
  if (raw === "supplier") return "supplier";
  return "wb";
}

/** По умолчанию `systemTotal` — SKU×system (WB+own); без параметра в URL — как в UI. */
export function parseViewMode(url: URL): ForecastViewMode {
  const raw = url.searchParams.get("viewMode")?.trim().toLowerCase() ?? "";
  if (raw === "wbwarehouses" || raw === "warehouses" || raw === "by-warehouse") {
    return "wbWarehouses";
  }
  if (raw === "wbtotal" || raw === "wb" || raw === "wb-network") {
    return "wbTotal";
  }
  if (
    raw === "" ||
    raw === "systemtotal" ||
    raw === "system" ||
    raw === "system-stock" ||
    raw === "stocks"
  ) {
    return "systemTotal";
  }
  return "wbTotal";
}

type SystemTotalQuickFilter = "all" | "systemRisk" | "supplierOrder" | "wbReplenish";

export function parseSystemTotalQuickFilter(url: URL): SystemTotalQuickFilter {
  const raw = url.searchParams.get("systemQuickFilter")?.trim().toLowerCase() ?? "";
  if (raw === "systemrisk" || raw === "system_risk") return "systemRisk";
  if (raw === "supplierorder" || raw === "supplier" || raw === "from_supplier") {
    return "supplierOrder";
  }
  if (raw === "wbreplenish" || raw === "wb" || raw === "towb" || raw === "on_wb") {
    return "wbReplenish";
  }
  return "all";
}

export function parseOwnWarehouseCode(url: URL): string {
  const raw = url.searchParams.get("ownWarehouseCode")?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_OWN_WAREHOUSE_CODE;
}

export function parseQuery(url: URL): ForecastReportFilter & {
  snapshotDate: string;
  horizonDays: number;
} {
  const snapshotDate = url.searchParams.get("snapshotDate")?.trim() ?? "";
  const horizonRaw = url.searchParams.get("horizonDays");
  const horizonDays = horizonRaw ? Number(horizonRaw) : NaN;
  const warehouseKey = url.searchParams.get("warehouseKey");
  const q = url.searchParams.get("q");
  const techSizeRaw = url.searchParams.get("techSize");
  const techSize = techSizeRaw && techSizeRaw.trim() !== "" ? techSizeRaw.trim() : null;
  const riskStockout = parseRiskStockout(url.searchParams.get("riskStockout"));
  const replenishmentTargetCoverageDays = parseTargetCoverageDays(url);
  const replenishmentMode = parseReplenishmentMode(url);
  const ownWarehouseCode = parseOwnWarehouseCode(url);
  const supplierLeadTimeDays = parseSupplierLeadTimeDays(url);
  const supplierOrderCoverageDays = parseSupplierOrderCoverageDays(url);
  const supplierSafetyDays = parseSupplierSafetyDays(url);
  const viewMode = parseViewMode(url);
  const systemTotalQuickFilter = parseSystemTotalQuickFilter(url);
  return {
    snapshotDate,
    horizonDays,
    warehouseKey: warehouseKey?.trim() || null,
    q: q?.trim() || null,
    techSize,
    riskStockout,
    replenishmentTargetCoverageDays,
    replenishmentMode,
    ownWarehouseCode,
    supplierLeadTimeDays,
    supplierOrderCoverageDays,
    supplierSafetyDays,
    viewMode,
    systemTotalQuickFilter,
  };
}

export function parseRowsLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (raw === null || raw.trim() === "") return ROWS_LIMIT_DEFAULT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < ROWS_LIMIT_MIN) return ROWS_LIMIT_DEFAULT;
  return Math.min(n, ROWS_LIMIT_MAX);
}

export interface RegionalStocksQuery {
  ok: true;
  /**
   * `null` — оператор не задал дату; загрузчик отчёта обязан резолвить
   * `MAX(snapshot_date)` среди базовых горизонтов (см.
   * `loadRegionalStocksReport`). Используется страницей «Запасы WB по
   * региону», которая принципиально не показывает «дату среза» как поле
   * ввода — она работает только с самым свежим срезом.
   */
  snapshotDate: string | null;
  horizonDays: number;
  macroRegion: string;
  targetCoverageDays: number;
  riskStockout: RiskStockoutFilter;
  q: string | null;
  limit: number;
  ownWarehouseCode: string;
}

export interface RegionalStocksQueryError {
  ok: false;
  error: string;
}

const REGIONAL_STOCKS_ALLOWED_TARGET_COVERAGE = new Set([14, 30, 42, 60]);

export function parseRegionalStocksQuery(
  url: URL,
): RegionalStocksQuery | RegionalStocksQueryError {
  // snapshotDate теперь опционален: пустая строка / отсутствие параметра →
  // null, загрузчик отчёта возьмёт самый свежий срез из БД. Если значение
  // задано — валидируем формат, чтобы поймать опечатки.
  const snapshotDateRaw = url.searchParams.get("snapshotDate")?.trim() ?? "";
  let snapshotDate: string | null;
  if (snapshotDateRaw === "") {
    snapshotDate = null;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(snapshotDateRaw)) {
    snapshotDate = snapshotDateRaw;
  } else {
    return { ok: false, error: "snapshotDate (YYYY-MM-DD) required" };
  }

  const horizonDays = Number(url.searchParams.get("horizonDays"));
  if (!Number.isInteger(horizonDays) || ![5, 10, 20].includes(horizonDays)) {
    return { ok: false, error: "horizonDays (5|10|20) required" };
  }

  const macroRegion = url.searchParams.get("macroRegion")?.trim() ?? "";
  if (macroRegion === "") {
    return { ok: false, error: "macroRegion required" };
  }

  const targetRaw = url.searchParams.get("targetCoverageDays");
  const targetCoverageDays =
    targetRaw === null || targetRaw.trim() === "" ? 42 : Number(targetRaw);
  if (
    !Number.isInteger(targetCoverageDays) ||
    !REGIONAL_STOCKS_ALLOWED_TARGET_COVERAGE.has(targetCoverageDays)
  ) {
    return { ok: false, error: "targetCoverageDays (14|30|42|60) required" };
  }

  return {
    ok: true,
    snapshotDate,
    horizonDays,
    macroRegion,
    targetCoverageDays,
    riskStockout: parseRiskStockout(url.searchParams.get("riskStockout")),
    q: url.searchParams.get("q")?.trim() || null,
    limit: parseRowsLimit(url),
    ownWarehouseCode: parseOwnWarehouseCode(url),
  };
}
