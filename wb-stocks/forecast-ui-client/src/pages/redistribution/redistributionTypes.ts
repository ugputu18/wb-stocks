import type { RankingMode } from "../../utils/wbRedistributionDonorModel.js";

export type LastRedistributionRun = {
  donorKey: string;
  snapshotDate: string;
  donorReserveDays: number;
  targetCoverageDays: number;
  minTransferableUnits: number;
  maxSkuNetworks: number;
  donorRows: unknown[];
  networkBySku: Map<string, unknown[]>;
  regionalByMacroBySku: Map<string, Map<string, number>> | null;
};

export interface WarehouseOptionStats {
  key: string;
  displayName: string;
  totalLocal: number;
  skuCount: number;
}

export type SkuNetworkSelection = {
  nmId: number;
  techSize: string;
  vendorCode: string;
  /** Fulfillment: целевой склад; Regional: предпочтительный склад в регионе (если есть). */
  targetWarehouseKey: string;
  /** Regional: макрорегион назначения (buyer-region demand); иначе null. */
  targetMacroRegion: string | null;
  rowKey: string;
};

export function readRankingModeFromUrl(): RankingMode {
  if (typeof window === "undefined") return "regional";
  const p = new URLSearchParams(window.location.search).get("rankingMode");
  return p?.trim().toLowerCase() === "fulfillment" ? "fulfillment" : "regional";
}
