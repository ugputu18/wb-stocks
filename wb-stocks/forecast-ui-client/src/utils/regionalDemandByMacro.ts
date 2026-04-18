import {
  getMacroRegionByRegionKey,
} from "../../../src/domain/wbRegionMacroRegion.js";
import { skuKey } from "./wbRedistributionDonorModel.js";

export interface RegionalDemandSnapshotRow {
  regionKey: string;
  nmId: number;
  techSize: string;
  regionalForecastDailyDemand: number;
}

/**
 * Агрегирует снимок спроса по регионам заказа в Σ по макрорегиону (buyer region → macro).
 * Ключ верхнего уровня: `nmId|techSize`.
 */
export function buildRegionalDemandByMacroBySku(
  rows: RegionalDemandSnapshotRow[],
  regionMacroMap: Record<string, string>,
): Map<string, Map<string, number>> {
  const lookup = new Map<string, string>(Object.entries(regionMacroMap));
  const out = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const k = skuKey(row.nmId, row.techSize);
    const macro = getMacroRegionByRegionKey(row.regionKey, lookup);
    let m = out.get(k);
    if (!m) {
      m = new Map();
      out.set(k, m);
    }
    const prev = m.get(macro) ?? 0;
    m.set(macro, prev + row.regionalForecastDailyDemand);
  }
  return out;
}
