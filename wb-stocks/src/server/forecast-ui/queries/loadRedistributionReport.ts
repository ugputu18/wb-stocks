import type {
  ForecastReportFilter,
  WbForecastSnapshotReportRow,
} from "../../../application/forecast-report/forecastReportTypes.js";
import type { WbForecastReportQueryService } from "../../../application/forecast-report/WbForecastReportQueryService.js";
import {
  buildRegionalDemandByMacroBySku,
  computeDonorMacroRegionRecommendations,
  computeDonorWarehouseRecommendations,
  pickTopSurplusSkus,
  skuKey,
  type DonorSkuSurplus,
  type RedistributionRow,
} from "../../../application/redistribution/redistributionModel.js";
import { normalizeWarehouseName } from "../../../domain/warehouseName.js";
import { buildRegionMacroLookup } from "../../../domain/wbRegionMacroRegion.js";
import type { DbHandle } from "../../../infra/db.js";
import { WbRegionDemandSnapshotRepository } from "../../../infra/wbRegionDemandSnapshotRepository.js";
import { WbRegionMacroRegionRepository } from "../../../infra/wbRegionMacroRegionRepository.js";
import type {
  RedistributionExportQuery,
  RedistributionRankingMode,
} from "../parse/exportQuery.js";

export interface RedistributionReport {
  snapshotDate: string;
  horizonDays: number;
  rankingMode: RedistributionRankingMode;
  donorWarehouseKey: string;
  donorReserveDays: number;
  minTransferableUnits: number;
  maxSkuNetworks: number;
  donorRowsLoaded: number;
  skuNetworksFetched: number;
  rows: RedistributionRow[];
}

export interface LoadRedistributionReportInput
  extends RedistributionExportQuery {
  snapshotDate: string;
  horizonDays: number;
  baseFilter: ForecastReportFilter;
}

export interface LoadRedistributionReportDeps {
  db: DbHandle;
  forecastReportQuery: WbForecastReportQueryService;
}

export type LoadRedistributionReportOutcome =
  | { ok: true; report: RedistributionReport }
  | { ok: false; status: 400; error: string };

function loadRegionalDemandByMacroBySku(
  db: DbHandle,
  snapshotDate: string,
  skus: readonly DonorSkuSurplus[],
): Map<string, Map<string, number>> {
  const regionDemandRepo = new WbRegionDemandSnapshotRepository(db);
  const macroRepo = new WbRegionMacroRegionRepository(db);
  const regionMacroMap = Object.fromEntries(
    buildRegionMacroLookup(macroRepo.getAll()),
  );
  return buildRegionalDemandByMacroBySku(
    regionDemandRepo.getForDateAndSkus(
      snapshotDate,
      skus.map((s) => ({ nmId: s.nmId, techSize: s.techSize })),
    ),
    regionMacroMap,
  );
}

export function loadRedistributionReport(
  deps: LoadRedistributionReportDeps,
  input: LoadRedistributionReportInput,
): LoadRedistributionReportOutcome {
  const donorWarehouseKey = normalizeWarehouseName(input.donorWarehouseKey);
  if (!donorWarehouseKey) {
    return {
      ok: false,
      status: 400,
      error: "donorWarehouseKey required",
    };
  }

  const donorRows = deps.forecastReportQuery.listReportRows(
    input.snapshotDate,
    input.horizonDays,
    {
      ...input.baseFilter,
      warehouseKey: donorWarehouseKey,
      q: null,
      techSize: null,
      viewMode: "wbWarehouses",
    },
    input.donorRowsLimit,
  );

  const top = pickTopSurplusSkus(
    donorRows,
    donorWarehouseKey,
    input.reserveDays,
    input.minTransferableUnits,
    input.maxSkuNetworks,
  );
  const networkBySku = new Map<string, WbForecastSnapshotReportRow[]>();
  for (const sku of top) {
    const rows = deps.forecastReportQuery.listReportRows(
      input.snapshotDate,
      input.horizonDays,
      {
        ...input.baseFilter,
        warehouseKey: null,
        q: String(sku.nmId),
        techSize: sku.techSize,
        viewMode: "wbWarehouses",
      },
      2000,
    );
    networkBySku.set(skuKey(sku.nmId, sku.techSize), rows);
  }

  const rows =
    input.rankingMode === "regional"
      ? computeDonorMacroRegionRecommendations(
          donorRows,
          networkBySku,
          donorWarehouseKey,
          input.reserveDays,
          input.minTransferableUnits,
          loadRegionalDemandByMacroBySku(deps.db, input.snapshotDate, top),
          input.targetCoverageDays,
        )
      : computeDonorWarehouseRecommendations(
          donorRows,
          networkBySku,
          donorWarehouseKey,
          input.reserveDays,
          input.minTransferableUnits,
        );

  return {
    ok: true,
    report: {
      snapshotDate: input.snapshotDate,
      horizonDays: input.horizonDays,
      rankingMode: input.rankingMode,
      donorWarehouseKey,
      donorReserveDays: input.reserveDays,
      minTransferableUnits: input.minTransferableUnits,
      maxSkuNetworks: input.maxSkuNetworks,
      donorRowsLoaded: donorRows.length,
      skuNetworksFetched: top.length,
      rows,
    },
  };
}
