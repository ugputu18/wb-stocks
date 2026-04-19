import {
  getWarehouseMacroRegion,
  WB_MACRO_REGION_CLUSTERS,
} from "../domain/wbWarehouseMacroRegion.js";

export interface WarehouseMetricRow {
  warehouseKey: string;
  warehouseNameRaw: string | null;
  rowCount: number;
  sumForecastDailyDemand: number;
  sumStartStock: number;
  sumIncomingUnits: number;
}

export interface WarehouseRegionAuditWarehouse {
  warehouseKey: string;
  warehouseNameRaw: string | null;
  rowCount: number;
  sumForecastDailyDemand: number;
  sumStartStock: number;
  sumIncomingUnits: number;
  macroRegion: string | null;
  mapped: boolean;
}

export interface MacroRegionTotals {
  macroRegion: string;
  warehouseCount: number;
  rowCount: number;
  sumForecastDailyDemand: number;
  sumStartStock: number;
}

export interface ClusterTotals {
  clusterId: string;
  clusterLabel: string;
  warehouseCount: number;
  rowCount: number;
  sumForecastDailyDemand: number;
  sumStartStock: number;
}

export interface WarehouseRegionAuditResult {
  snapshotDate: string;
  horizonDays: number;
  totals: {
    warehouseCount: number;
    mappedWarehouseCount: number;
    unmappedWarehouseCount: number;
    rowCount: number;
    mappedRowCount: number;
    unmappedRowCount: number;
    sumForecastDailyDemand: number;
    mappedSumForecastDailyDemand: number;
    unmappedSumForecastDailyDemand: number;
    sumStartStock: number;
    mappedSumStartStock: number;
    unmappedSumStartStock: number;
    unmappedForecastShare: number;
    unmappedRowShare: number;
  };
  warehouses: WarehouseRegionAuditWarehouse[];
  unmappedSortedByForecast: WarehouseRegionAuditWarehouse[];
  macroRegionTotals: MacroRegionTotals[];
  clusterTotals: ClusterTotals[];
}

function inCluster(macro: string, macroRegions: readonly string[]): boolean {
  return macroRegions.includes(macro);
}

export function buildWarehouseRegionAudit(
  snapshotDate: string,
  horizonDays: number,
  rows: readonly WarehouseMetricRow[],
): WarehouseRegionAuditResult {
  const warehouses: WarehouseRegionAuditWarehouse[] = rows.map((r) => {
    const macroRegion = getWarehouseMacroRegion(r.warehouseKey);
    return {
      warehouseKey: r.warehouseKey,
      warehouseNameRaw: r.warehouseNameRaw,
      rowCount: r.rowCount,
      sumForecastDailyDemand: r.sumForecastDailyDemand,
      sumStartStock: r.sumStartStock,
      sumIncomingUnits: r.sumIncomingUnits,
      macroRegion,
      mapped: macroRegion !== null,
    };
  });

  let rowCount = 0;
  let mappedRowCount = 0;
  let unmappedRowCount = 0;
  let sumForecastDailyDemand = 0;
  let mappedSumForecastDailyDemand = 0;
  let unmappedSumForecastDailyDemand = 0;
  let sumStartStock = 0;
  let mappedSumStartStock = 0;
  let unmappedSumStartStock = 0;
  let mappedWarehouseCount = 0;
  let unmappedWarehouseCount = 0;

  const byMacro = new Map<
    string,
    { warehouseCount: number; rowCount: number; sumF: number; sumS: number }
  >();

  for (const w of warehouses) {
    rowCount += w.rowCount;
    sumForecastDailyDemand += w.sumForecastDailyDemand;
    sumStartStock += w.sumStartStock;
    if (w.mapped) {
      mappedWarehouseCount += 1;
      mappedRowCount += w.rowCount;
      mappedSumForecastDailyDemand += w.sumForecastDailyDemand;
      mappedSumStartStock += w.sumStartStock;
      const m = w.macroRegion!;
      let b = byMacro.get(m);
      if (!b) {
        b = { warehouseCount: 0, rowCount: 0, sumF: 0, sumS: 0 };
        byMacro.set(m, b);
      }
      b.warehouseCount += 1;
      b.rowCount += w.rowCount;
      b.sumF += w.sumForecastDailyDemand;
      b.sumS += w.sumStartStock;
    } else {
      unmappedWarehouseCount += 1;
      unmappedRowCount += w.rowCount;
      unmappedSumForecastDailyDemand += w.sumForecastDailyDemand;
      unmappedSumStartStock += w.sumStartStock;
    }
  }

  const macroRegionTotals: MacroRegionTotals[] = Array.from(byMacro.entries())
    .map(([macroRegion, v]) => ({
      macroRegion,
      warehouseCount: v.warehouseCount,
      rowCount: v.rowCount,
      sumForecastDailyDemand: v.sumF,
      sumStartStock: v.sumS,
    }))
    .sort((a, b) => b.sumForecastDailyDemand - a.sumForecastDailyDemand);

  /** Кластеры в т.ч. `cis` — только для аудита/сводок; redistribution использует отдельные группы совместимости. */
  const clusterTotals: ClusterTotals[] = WB_MACRO_REGION_CLUSTERS.map((c) => {
    let warehouseCount = 0;
    let rc = 0;
    let sumF = 0;
    let sumS = 0;
    for (const w of warehouses) {
      if (!w.mapped || !w.macroRegion) continue;
      if (inCluster(w.macroRegion, c.macroRegions)) {
        warehouseCount += 1;
        rc += w.rowCount;
        sumF += w.sumForecastDailyDemand;
        sumS += w.sumStartStock;
      }
    }
    return {
      clusterId: c.id,
      clusterLabel: c.label,
      warehouseCount,
      rowCount: rc,
      sumForecastDailyDemand: sumF,
      sumStartStock: sumS,
    };
  });

  const unmappedSortedByForecast = warehouses
    .filter((w) => !w.mapped)
    .sort((a, b) => b.sumForecastDailyDemand - a.sumForecastDailyDemand);

  const unmappedForecastShare =
    sumForecastDailyDemand > 0
      ? unmappedSumForecastDailyDemand / sumForecastDailyDemand
      : 0;
  const unmappedRowShare =
    rowCount > 0 ? unmappedRowCount / rowCount : 0;

  return {
    snapshotDate,
    horizonDays,
    totals: {
      warehouseCount: warehouses.length,
      mappedWarehouseCount,
      unmappedWarehouseCount,
      rowCount,
      mappedRowCount,
      unmappedRowCount,
      sumForecastDailyDemand,
      mappedSumForecastDailyDemand,
      unmappedSumForecastDailyDemand,
      sumStartStock,
      mappedSumStartStock,
      unmappedSumStartStock,
      unmappedForecastShare,
      unmappedRowShare,
    },
    warehouses: warehouses.sort((a, b) =>
      a.warehouseKey < b.warehouseKey ? -1 : a.warehouseKey > b.warehouseKey ? 1 : 0,
    ),
    unmappedSortedByForecast,
    macroRegionTotals,
    clusterTotals,
  };
}
