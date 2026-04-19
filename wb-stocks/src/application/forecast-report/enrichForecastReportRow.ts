import { riskBucketFromDaysOfStock } from "../../domain/forecastRiskBucket.js";
import type { WbForecastSnapshotRecord } from "../../domain/wbForecastSnapshot.js";
import {
  buildInventoryLevels,
  buildWbRowReplenishment,
  type InventoryLevelsReadModel,
  type WbRowReplenishmentReadModel,
} from "../../domain/multiLevelInventory.js";
import type { ForecastReportFilter, WbForecastSnapshotReportRow } from "./forecastReportTypes.js";
import { skuKey } from "./forecastReportQueryHelpers.js";

export function enrichReportRow(
  r: WbForecastSnapshotRecord,
  filter: ForecastReportFilter,
  wbTotals: Map<string, number>,
  ownByVendor: Map<string, number>,
): WbForecastSnapshotReportRow {
  const risk = riskBucketFromDaysOfStock(r.daysOfStock);
  const localAvail = r.startStock + r.incomingUnits;
  const wbTot = wbTotals.get(skuKey(r.nmId, r.techSize)) ?? 0;
  const vend = (r.vendorCode ?? "").trim();
  const ownQty = vend ? (ownByVendor.get(vend) ?? 0) : 0;
  const inventoryLevels: InventoryLevelsReadModel = buildInventoryLevels(
    localAvail,
    wbTot,
    ownQty,
  );

  const base: WbForecastSnapshotReportRow = {
    ...r,
    risk,
    inventoryLevels,
  };

  const tc = filter.replenishmentTargetCoverageDays;
  if (tc === undefined || !Number.isFinite(tc) || tc <= 0) {
    return base;
  }

  const replenishment: WbRowReplenishmentReadModel = buildWbRowReplenishment(
    r.forecastDailyDemand,
    tc,
    wbTot,
  );

  return { ...base, replenishment };
}
