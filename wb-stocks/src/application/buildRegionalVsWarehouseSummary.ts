import {
  getMacroRegionByRegionKey,
  UNMAPPED_REGION_MACRO_REGION,
} from "../domain/wbRegionMacroRegion.js";
import {
  getWarehouseMacroRegion,
  UNMAPPED_WAREHOUSE_REGION_LABEL,
} from "../domain/wbWarehouseMacroRegion.js";

export interface RegionalDemandByRegionRow {
  regionKey: string;
  regionNameRaw: string | null;
  regionalForecastDailyDemand: number;
  shareOfRegionalTotal: number;
}

export interface FulfillmentByMacroRow {
  macroRegion: string;
  fulfillmentForecastDailyDemand: number;
  shareOfFulfillmentTotal: number;
}

export interface ComparisonByMacroRow {
  macroRegion: string;
  regionalDemand: number;
  fulfillmentDemand: number;
  regionalShare: number;
  fulfillmentShare: number;
  gap: number;
  gapShare: number;
}

export interface UnmappedRegionalRow {
  regionKey: string;
  regionNameRaw: string | null;
  regionalForecastDailyDemand: number;
  shareOfRegionalTotal: number;
  status: "Не сопоставлен";
}

export interface RegionalVsWarehouseSummary {
  snapshotDate: string;
  horizonDays: number;
  regionalTotals: RegionalDemandByRegionRow[];
  warehouseMacroRegionTotals: FulfillmentByMacroRow[];
  comparisonByMacroRegion: ComparisonByMacroRow[];
  totals: {
    regionalTotalDemand: number;
    fulfillmentTotalDemand: number;
    /** Σ regional по ключам с известным макрорегионом (не «Не сопоставлен»). */
    regionalMappedDemand: number;
    /** Доля mapped от Σ regional — насколько диагностика покрыта маппингом. */
    regionalMappedShareOfRegional: number;
    regionalUnmappedDemand: number;
    regionalUnmappedShareOfRegional: number;
  };
  unmappedRegionalTotals: UnmappedRegionalRow[];
}

export function buildRegionalVsWarehouseSummary(input: {
  snapshotDate: string;
  horizonDays: number;
  regionalByRegion: readonly {
    regionKey: string;
    regionNameRaw: string | null;
    regionalForecastDailyDemand: number;
  }[];
  warehouseMetrics: readonly {
    warehouseKey: string;
    sumForecastDailyDemand: number;
  }[];
  regionMacroLookup: ReadonlyMap<string, string>;
}): RegionalVsWarehouseSummary {
  const { snapshotDate, horizonDays, regionalByRegion, warehouseMetrics, regionMacroLookup } =
    input;

  const regionalTotalDemand = regionalByRegion.reduce(
    (s, r) => s + r.regionalForecastDailyDemand,
    0,
  );

  const regionalTotals: RegionalDemandByRegionRow[] = [...regionalByRegion]
    .map((r) => ({
      regionKey: r.regionKey,
      regionNameRaw: r.regionNameRaw,
      regionalForecastDailyDemand: r.regionalForecastDailyDemand,
      shareOfRegionalTotal:
        regionalTotalDemand > 0
          ? r.regionalForecastDailyDemand / regionalTotalDemand
          : 0,
    }))
    .sort((a, b) => b.regionalForecastDailyDemand - a.regionalForecastDailyDemand);

  const fulfillmentByMacro = new Map<string, number>();
  for (const w of warehouseMetrics) {
    const macro =
      getWarehouseMacroRegion(w.warehouseKey) ?? UNMAPPED_WAREHOUSE_REGION_LABEL;
    fulfillmentByMacro.set(macro, (fulfillmentByMacro.get(macro) ?? 0) + w.sumForecastDailyDemand);
  }

  const fulfillmentTotalDemand = [...fulfillmentByMacro.values()].reduce((a, b) => a + b, 0);

  const warehouseMacroRegionTotals: FulfillmentByMacroRow[] = [...fulfillmentByMacro.entries()]
    .map(([macroRegion, fulfillmentForecastDailyDemand]) => ({
      macroRegion,
      fulfillmentForecastDailyDemand,
      shareOfFulfillmentTotal:
        fulfillmentTotalDemand > 0
          ? fulfillmentForecastDailyDemand / fulfillmentTotalDemand
          : 0,
    }))
    .sort((a, b) => b.fulfillmentForecastDailyDemand - a.fulfillmentForecastDailyDemand);

  const regionalByMacro = new Map<string, number>();
  let regionalUnmappedDemand = 0;
  const unmappedRegionalTotals: UnmappedRegionalRow[] = [];

  for (const r of regionalByRegion) {
    const macro = getMacroRegionByRegionKey(r.regionKey, regionMacroLookup);
    regionalByMacro.set(macro, (regionalByMacro.get(macro) ?? 0) + r.regionalForecastDailyDemand);
    if (macro === UNMAPPED_REGION_MACRO_REGION) {
      regionalUnmappedDemand += r.regionalForecastDailyDemand;
      unmappedRegionalTotals.push({
        regionKey: r.regionKey,
        regionNameRaw: r.regionNameRaw,
        regionalForecastDailyDemand: r.regionalForecastDailyDemand,
        shareOfRegionalTotal:
          regionalTotalDemand > 0
            ? r.regionalForecastDailyDemand / regionalTotalDemand
            : 0,
        status: "Не сопоставлен",
      });
    }
  }

  unmappedRegionalTotals.sort(
    (a, b) => b.regionalForecastDailyDemand - a.regionalForecastDailyDemand,
  );

  const macroKeys = new Set<string>([
    ...regionalByMacro.keys(),
    ...fulfillmentByMacro.keys(),
  ]);

  const comparisonByMacroRegion: ComparisonByMacroRow[] = [...macroKeys]
    .map((macroRegion) => {
      const regionalDemand = regionalByMacro.get(macroRegion) ?? 0;
      const fulfillmentDemand = fulfillmentByMacro.get(macroRegion) ?? 0;
      const regionalShare =
        regionalTotalDemand > 0 ? regionalDemand / regionalTotalDemand : 0;
      const fulfillmentShare =
        fulfillmentTotalDemand > 0 ? fulfillmentDemand / fulfillmentTotalDemand : 0;
      return {
        macroRegion,
        regionalDemand,
        fulfillmentDemand,
        regionalShare,
        fulfillmentShare,
        gap: regionalDemand - fulfillmentDemand,
        gapShare: regionalShare - fulfillmentShare,
      };
    })
    .sort((a, b) => {
      const da = Math.abs(a.gapShare);
      const db = Math.abs(b.gapShare);
      if (db !== da) return db - da;
      return a.macroRegion.localeCompare(b.macroRegion, "ru");
    });

  const regionalMappedDemand = regionalTotalDemand - regionalUnmappedDemand;

  return {
    snapshotDate,
    horizonDays,
    regionalTotals,
    warehouseMacroRegionTotals,
    comparisonByMacroRegion,
    totals: {
      regionalTotalDemand,
      fulfillmentTotalDemand,
      regionalMappedDemand,
      regionalMappedShareOfRegional:
        regionalTotalDemand > 0 ? regionalMappedDemand / regionalTotalDemand : 0,
      regionalUnmappedDemand,
      regionalUnmappedShareOfRegional:
        regionalTotalDemand > 0 ? regionalUnmappedDemand / regionalTotalDemand : 0,
    },
    unmappedRegionalTotals,
  };
}
