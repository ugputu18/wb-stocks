/**
 * Read-side-only view: WB сеть + региональный склад.
 * Не учитывает перемещения между складами (MVP).
 */

export type ReplenishmentMode = "wb" | "supplier";

export interface InventoryLevelsReadModel {
  /** На выбранном WB складе (строка): start_stock + incoming_units */
  localAvailable: number;
  /** Сумма (start_stock + incoming_units) по всем складам WB для nm_id + tech_size */
  wbAvailable: number;
  /** Наш склад (`own_stock_snapshots`), шт. по vendor_code */
  ownStock: number;
  /** wbAvailable + ownStock */
  systemAvailable: number;
  /** systemAvailable <= 0 */
  systemRisk: boolean;
  /** wbAvailable <= 0 */
  wbRisk: boolean;
  /** localAvailable <= 0 */
  localRisk: boolean;
  /**
   * На этом складе WB нет покрытия, но по сети WB или на нашем складе есть запас — перераспределение/доставка на WB.
   */
  regionalDeficit: boolean;
}

/** WB replenishment на уровне строки warehouse × sku (read-side). */
export interface WbRowReplenishmentReadModel {
  targetCoverageDays: number;
  /** Спрос/день на этом складе × дни */
  targetDemandWB: number;
  /** Сумма (start+incoming) по всем WB для этого SKU — то же, что `inventoryLevels.wbAvailable` */
  wbAvailableTotal: number;
  recommendedToWB: number;
}

/**
 * Одна строка supplier replenishment: агрегат по SKU (все склады WB), не по складу.
 * `recommendedFromSupplier` не дублируется по строкам склада — только здесь и в Σ KPI.
 */
export interface SupplierSkuReplenishmentReadModel {
  nmId: number;
  techSize: string;
  vendorCode: string | null;
  /** Σ forecast_daily_demand по всем складам WB — дневной спрос «системы» (как у sumForecastDailyDemand) */
  systemDailyDemand: number;
  /** Σ forecast_daily_demand по всем складам WB для SKU */
  sumForecastDailyDemand: number;
  /** Параметры плана заказа (echo запроса / фильтра) */
  leadTimeDays: number;
  /** Покрытие после прихода (≠ targetCoverageDays для простого recommendedFromSupplier) */
  orderCoverageDays: number;
  /** Страховой буфер в формуле покрытия: спрос × (orderCoverageDays + safetyDays). */
  safetyDays: number;
  targetDemandSystem: number;
  wbAvailableTotal: number;
  /** Σ start_stock по всем складам WB для SKU (снимок). */
  wbStartStockTotal: number;
  /** Σ incoming_units по горизонту по всем складам WB для SKU. */
  wbIncomingUnitsTotal: number;
  ownStock: number;
  systemAvailable: number;
  recommendedFromSupplier: number;
  stockAtArrival: number;
  recommendedOrderQty: number;
  willStockoutBeforeArrival: boolean;
  daysUntilStockout: number | null;
}

const EPS = 1e-9;

function ceilNonneg(raw: number): number {
  return raw <= EPS ? 0 : Math.ceil(raw - 1e-12);
}

/**
 * План заказа у поставщика с lead time (read-side): спрос системы × дни vs запас на момент прихода.
 */
export function buildSupplierOrderPlan(input: {
  systemDailyDemand: number;
  wbAvailableTotal: number;
  ownStock: number;
  leadTimeDays: number;
  coverageDays: number;
  /** default 0 */
  safetyDays?: number;
}): {
  stockAtArrival: number;
  recommendedOrderQty: number;
  willStockoutBeforeArrival: boolean;
  daysUntilStockout: number | null;
} {
  const d = Number(input.systemDailyDemand);
  const wb = Number(input.wbAvailableTotal);
  const own = Number(input.ownStock);
  const lt = Number(input.leadTimeDays);
  const cov = Number(input.coverageDays);
  const safe = Number(input.safetyDays ?? 0);

  const systemAvailableNow = wb + own;
  const consumptionDuringLeadTime = d * lt;
  const stockAtArrival = systemAvailableNow - consumptionDuringLeadTime;
  const requiredAfterArrival = d * (cov + safe);
  const recommendedOrderQty = ceilNonneg(requiredAfterArrival - stockAtArrival);
  const willStockoutBeforeArrival = stockAtArrival < 0;
  const daysUntilStockout = d > EPS ? systemAvailableNow / d : null;

  return {
    stockAtArrival,
    recommendedOrderQty,
    willStockoutBeforeArrival,
    daysUntilStockout,
  };
}

/**
 * Read-side дней покрытия по **сети WB** для SKU: `wbAvailableTotal / forecastDailyDemandTotal`.
 * При нулевом суммарном спросе: при наличии стока — очень большое число (для бакета OK), иначе 0.
 */
export function daysOfStockWbFromNetworkTotals(
  wbAvailableTotal: number,
  forecastDailyDemandTotal: number,
): number {
  const wb = Number(wbAvailableTotal);
  const fd = Number(forecastDailyDemandTotal);
  if (!Number.isFinite(wb)) return 0;
  if (!Number.isFinite(fd) || fd <= EPS) return wb > EPS ? 1e6 : 0;
  return wb / fd;
}

/**
 * Дней покрытия по **всей системе** (WB∑ + own) для SKU: `systemAvailable / forecastDailyDemandTotal`.
 * Та же численная ветка, что у `daysOfStockWbFromNetworkTotals`, иной смысл входа.
 */
export function daysOfStockSystemFromNetworkTotals(
  systemAvailable: number,
  forecastDailyDemandTotal: number,
): number {
  return daysOfStockWbFromNetworkTotals(systemAvailable, forecastDailyDemandTotal);
}

/**
 * Оценка календарной даты исчерпания пула **system** (read-side): дата среза
 * + **floor(daysOfStockSystem)** полных календарных дней при постоянном Σ-спросе/день.
 * Не посуточная симуляция по складам WB и не `stockout_date` из среза.
 *
 * @returns `YYYY-MM-DD` в UTC-календарной арифметике от `snapshotDateYmd`, либо `null`
 * если спрос ≤ 0, дней запаса нет/⟨0, или формат даты среза невалиден.
 */
export function systemStockoutDateEstimateFromSnapshot(
  snapshotDateYmd: string,
  daysOfStockSystem: number,
  forecastDailyDemandTotal: number,
): string | null {
  const fd = Number(forecastDailyDemandTotal);
  if (!Number.isFinite(fd) || fd <= EPS) return null;
  const days = Number(daysOfStockSystem);
  if (!Number.isFinite(days)) return null;
  const whole = Math.floor(days);
  if (whole < 0) return null;
  const s = String(snapshotDateYmd ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const utcMs = Date.UTC(
    Number(s.slice(0, 4)),
    Number(s.slice(5, 7)) - 1,
    Number(s.slice(8, 10)),
  );
  const out = new Date(utcMs + whole * 86_400_000);
  const y = out.getUTCFullYear();
  const m = String(out.getUTCMonth() + 1).padStart(2, "0");
  const d = String(out.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function buildInventoryLevels(
  localStartPlusIncoming: number,
  wbTotalStartPlusIncoming: number,
  ownStock: number,
): InventoryLevelsReadModel {
  const localAvailable = Number(localStartPlusIncoming);
  const wbAvailable = Number(wbTotalStartPlusIncoming);
  const own = Number(ownStock);
  const la = Number.isFinite(localAvailable) ? localAvailable : 0;
  const wb = Number.isFinite(wbAvailable) ? wbAvailable : 0;
  const o = Number.isFinite(own) ? own : 0;
  const systemAvailable = wb + o;
  const systemRisk = systemAvailable <= EPS;
  const wbRisk = wb <= EPS;
  const localRisk = la <= EPS;
  const regionalDeficit = la <= EPS && (wb > EPS || o > EPS);
  return {
    localAvailable: la,
    wbAvailable: wb,
    ownStock: o,
    systemAvailable,
    systemRisk,
    wbRisk,
    localRisk,
    regionalDeficit,
  };
}

/** Строка склада: довезти на WB (локальный спрос vs сеть WB). */
export function buildWbRowReplenishment(
  forecastDailyDemand: number,
  targetCoverageDays: number,
  wbAvailableTotal: number,
): WbRowReplenishmentReadModel {
  const tc = Number(targetCoverageDays);
  const fd = Number(forecastDailyDemand);
  const targetDemandWB = fd * tc;
  const recommendedToWB = ceilNonneg(targetDemandWB - wbAvailableTotal);
  return {
    targetCoverageDays: tc,
    targetDemandWB,
    wbAvailableTotal,
    recommendedToWB,
  };
}

/** Один SKU: закупка у производителя от системного спроса и пула запаса. */
export function buildSupplierSkuReplenishment(
  sumForecastDailyDemand: number,
  wbAvailableTotal: number,
  ownStock: number,
  targetCoverageDays: number,
): Pick<
  SupplierSkuReplenishmentReadModel,
  | "targetDemandSystem"
  | "wbAvailableTotal"
  | "ownStock"
  | "systemAvailable"
  | "recommendedFromSupplier"
> {
  const tc = Number(targetCoverageDays);
  const sumFd = Number(sumForecastDailyDemand);
  const wb = Number(wbAvailableTotal);
  const own = Number(ownStock);
  const targetDemandSystem = sumFd * tc;
  const systemAvailable = wb + own;
  const recommendedFromSupplier = ceilNonneg(targetDemandSystem - systemAvailable);
  return {
    targetDemandSystem,
    wbAvailableTotal: wb,
    ownStock: own,
    systemAvailable,
    recommendedFromSupplier,
  };
}
