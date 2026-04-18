import type { WbOrderUnit } from "../domain/wbOrder.js";
import {
  getMacroRegionByRegionKey,
  UNMAPPED_REGION_MACRO_REGION,
} from "../domain/wbRegionMacroRegion.js";
import {
  getWarehouseMacroRegion,
  UNMAPPED_WAREHOUSE_REGION_LABEL,
} from "../domain/wbWarehouseMacroRegion.js";

export interface OrderFlowByRegionRow {
  regionKey: string;
  regionNameRaw: string | null;
  warehouseKey: string;
  warehouseNameRaw: string | null;
  /** Число строк (единиц) без отмены. */
  ordersCount: number;
  /** Net units (= ordersCount при 1 шт/строка). */
  units: number;
  grossUnits: number;
  cancelledUnits: number;
  shareWithinRegion: number;
}

export interface OrderFlowMacroMatrixRow {
  buyerMacroRegion: string;
  fulfillmentMacroRegion: string;
  units: number;
}

function filterUnits(
  units: readonly WbOrderUnit[],
  opts: { nmId?: number; vendorCode?: string },
): WbOrderUnit[] {
  let out = [...units];
  if (opts.nmId !== undefined) {
    out = out.filter((u) => u.nmId === opts.nmId);
  }
  if (opts.vendorCode !== undefined && opts.vendorCode !== "") {
    const v = opts.vendorCode.trim().toLowerCase();
    out = out.filter((u) => (u.vendorCode ?? "").toLowerCase() === v);
  }
  return out;
}

/**
 * Агрегат: из какого buyer-региона каким складом исполняются заказы (net/gross по строкам API).
 */
export function aggregateOrderFlowByRegion(
  units: readonly WbOrderUnit[],
  opts: { nmId?: number; vendorCode?: string } = {},
): OrderFlowByRegionRow[] {
  const filtered = filterUnits(units, opts);

  type Agg = {
    regionKey: string;
    regionNameRaw: string | null;
    warehouseKey: string;
    warehouseNameRaw: string | null;
    units: number;
    grossUnits: number;
    cancelledUnits: number;
  };

  const m = new Map<string, Agg>();
  const regionNetTotal = new Map<string, number>();

  for (const u of filtered) {
    const key = `${u.regionKey}\u0000${u.warehouseKey}`;
    const net = u.isCancel ? 0 : 1;
    const gross = 1;
    const cancel = u.isCancel ? 1 : 0;

    regionNetTotal.set(u.regionKey, (regionNetTotal.get(u.regionKey) ?? 0) + net);

    const ex = m.get(key);
    if (!ex) {
      m.set(key, {
        regionKey: u.regionKey,
        regionNameRaw: u.regionNameRaw,
        warehouseKey: u.warehouseKey,
        warehouseNameRaw: u.warehouseNameRaw,
        units: net,
        grossUnits: gross,
        cancelledUnits: cancel,
      });
    } else {
      ex.units += net;
      ex.grossUnits += gross;
      ex.cancelledUnits += cancel;
      if (ex.regionNameRaw === null && u.regionNameRaw !== null) {
        ex.regionNameRaw = u.regionNameRaw;
      }
      if (ex.warehouseNameRaw === null && u.warehouseNameRaw !== null) {
        ex.warehouseNameRaw = u.warehouseNameRaw;
      }
    }
  }

  const rows: OrderFlowByRegionRow[] = [];
  for (const a of m.values()) {
    const total = regionNetTotal.get(a.regionKey) ?? 0;
    const share = total > 0 ? a.units / total : 0;
    rows.push({
      regionKey: a.regionKey,
      regionNameRaw: a.regionNameRaw,
      warehouseKey: a.warehouseKey,
      warehouseNameRaw: a.warehouseNameRaw,
      ordersCount: a.units,
      units: a.units,
      grossUnits: a.grossUnits,
      cancelledUnits: a.cancelledUnits,
      shareWithinRegion: share,
    });
  }

  rows.sort((a, b) => {
    const dr = b.units - a.units;
    if (dr !== 0) return dr;
    return a.regionKey.localeCompare(b.regionKey);
  });
  return rows;
}

/**
 * Матрица: макрорегион покупателя × макрорегион склада исполнения (net units).
 */
export function aggregateOrderFlowMacroMatrix(
  units: readonly WbOrderUnit[],
  regionMacroLookup: ReadonlyMap<string, string>,
  opts: { nmId?: number; vendorCode?: string } = {},
): OrderFlowMacroMatrixRow[] {
  const filtered = filterUnits(units, opts);
  const m = new Map<string, number>();

  for (const u of filtered) {
    if (u.isCancel) continue;
    const buyerMacro = getMacroRegionByRegionKey(u.regionKey, regionMacroLookup);
    const fulfillmentMacro =
      getWarehouseMacroRegion(u.warehouseKey) ?? UNMAPPED_WAREHOUSE_REGION_LABEL;
    const key = `${buyerMacro}\u0000${fulfillmentMacro}`;
    m.set(key, (m.get(key) ?? 0) + 1);
  }

  const rows: OrderFlowMacroMatrixRow[] = [];
  for (const [key, unitsN] of m) {
    const [buyerMacroRegion, fulfillmentMacroRegion] = key.split("\u0000");
    rows.push({
      buyerMacroRegion: buyerMacroRegion ?? UNMAPPED_REGION_MACRO_REGION,
      fulfillmentMacroRegion: fulfillmentMacroRegion ?? UNMAPPED_WAREHOUSE_REGION_LABEL,
      units: unitsN,
    });
  }

  rows.sort((a, b) => b.units - a.units);
  return rows;
}
