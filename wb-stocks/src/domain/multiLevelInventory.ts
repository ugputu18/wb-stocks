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
  /** Σ forecast_daily_demand по всем складам WB для SKU */
  sumForecastDailyDemand: number;
  targetDemandSystem: number;
  wbAvailableTotal: number;
  ownStock: number;
  systemAvailable: number;
  recommendedFromSupplier: number;
}

const EPS = 1e-9;

function ceilNonneg(raw: number): number {
  return raw <= EPS ? 0 : Math.ceil(raw - 1e-12);
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
