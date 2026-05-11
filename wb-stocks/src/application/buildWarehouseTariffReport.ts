import { normalizeWarehouseName } from "../domain/warehouseName.js";
import { getWarehouseMacroRegion } from "../domain/wbWarehouseMacroRegion.js";

/* ───────── Input shapes (one record per WB warehouse) ───────── */

export interface BoxTariffInputRow {
  warehouseName: string;
  geoName: string | null;
  boxDeliveryBase: number | null;
  boxDeliveryLiter: number | null;
  boxStorageBase: number | null;
  boxStorageLiter: number | null;
  dtTillMax: string | null;
}

export interface PalletTariffInputRow {
  warehouseName: string;
  palletDeliveryValueBase: number | null;
  palletDeliveryValueLiter: number | null;
  palletStorageValueExpr: number | null;
}

/**
 * One row from the latest acceptance batch. Caller is expected to have
 * already filtered to a single `box_type_id` (default `2` = Короба) and
 * to the most recent `fetched_at`.
 */
export interface AcceptanceInputRow {
  warehouseName: string | null;
  warehouseId: number;
  boxTypeId: number | null;
  effectiveDate: string;
  coefficient: number;
  allowUnload: boolean | null;
  isSortingCenter: boolean | null;
}

export interface WarehouseStockTotalsInputRow {
  warehouseName: string;
  currentStockUnits: number;
}

/* ───────── Output ───────── */

/**
 * Decision-support label for "should we ship to this warehouse?":
 *
 * - `available_free`  — приёмка возможна и есть хотя бы одна дата с коэф. 0
 *                       (бесплатная приёмка) в ближайшие 14 дней;
 * - `available_paid`  — приёмка доступна (коэф. 1+), бесплатных дат нет;
 * - `blocked`         — `-1` или `allowUnload=false` на всём окне:
 *                       отгружать нельзя в принципе;
 * - `unknown`         — данных acceptance для склада нет (склад в box tariff
 *                       есть, но в acceptance/coefficients не вернулся —
 *                       обычно это FBS-точки «Маркетплейс: …»).
 */
export type WarehouseTariffAvailability =
  | "available_free"
  | "available_paid"
  | "blocked"
  | "unknown";

export interface WarehouseTariffReportRow {
  warehouseName: string;
  warehouseKey: string;
  warehouseId: number | null;
  geoName: string | null;
  macroRegion: string | null;

  /** ₽ per first litre of FBW logistics. */
  boxDeliveryBase: number | null;
  /** ₽ per each additional litre of FBW logistics. */
  boxDeliveryLiter: number | null;
  /** ₽ per first litre per day of storage. */
  boxStorageBase: number | null;
  /** ₽ per each additional litre per day of storage. */
  boxStorageLiter: number | null;
  /**
   * Synthetic «shipping cost for a 10-litre parcel»:
   *   `boxDeliveryBase + 9 * boxDeliveryLiter`.
   * Single sortable number that captures the FBW logistics economics
   * better than either field alone. `null` if either input is missing.
   */
  shipCostPer10L: number | null;
  /**
   * Synthetic «storage cost for 10 L per 30 days»:
   *   `30 * (boxStorageBase + 9 * boxStorageLiter)`.
   * `null` if either storage field is missing.
   */
  storeCostPer10LPerMonth: number | null;
  /**
   * Combined economic score: smaller = cheaper. Used as the default sort
   * key. Currently `shipCostPer10L + storeCostPer10LPerMonth`; rows
   * without enough data to compute either part get `score = null` and
   * sort to the bottom.
   */
  score: number | null;

  /** ₽ per pallet per day (if pallet tariff joined), else `null`. */
  palletStorageDaily: number | null;
  /** ₽ per first litre of pallet logistics (if joined), else `null`. */
  palletDeliveryBase: number | null;

  /** First `effective_date` where (coef ∈ {0,1}) AND `allowUnload === true`. */
  nearestAvailableDate: string | null;
  /** First `effective_date` where `coef = 0` AND `allowUnload === true`. */
  nearestFreeDate: string | null;
  /** Minimum coefficient observed in the 14-day window for this warehouse. */
  minCoefficient14d: number | null;
  /** Count of dates with available acceptance in the 14-day window. */
  availableDays14d: number;
  isSortingCenter: boolean | null;
  availability: WarehouseTariffAvailability;

  /** Sum of units across all SKUs at this warehouse in the latest stock snapshot. */
  currentStockUnits: number | null;

  /** Tariff calendar context (echoed from the box endpoint). */
  dtTillMax: string | null;
}

export interface WarehouseTariffReportSummary {
  totalWarehouses: number;
  byAvailability: {
    available_free: number;
    available_paid: number;
    blocked: number;
    unknown: number;
  };
  byMacroRegion: { macroRegion: string; warehouses: number }[];
}

export interface WarehouseTariffReport {
  tariffDate: string;
  acceptanceFetchedAt: string | null;
  boxTypeId: number;
  summary: WarehouseTariffReportSummary;
  rows: WarehouseTariffReportRow[];
}

/* ───────── Input to the pure builder ───────── */

export type WarehouseTariffSortKey =
  | "score"
  | "delivery"
  | "storage"
  | "stock"
  | "acceptance"
  | "name";

export interface BuildWarehouseTariffReportInput {
  /**
   * `tariff_date` echoed back to the consumer. Caller is responsible for
   * picking the latest one from `wb_warehouse_box_tariffs`.
   */
  tariffDate: string;
  /**
   * `fetched_at` echoed back; `null` if acceptance data was not loaded
   * (e.g. running before the first `pnpm update:wb-tariffs`).
   */
  acceptanceFetchedAt: string | null;
  /** Which acceptance box type the report was built for (2=Короба by default). */
  boxTypeId: number;

  boxRows: readonly BoxTariffInputRow[];
  palletRows?: readonly PalletTariffInputRow[];
  acceptanceRows?: readonly AcceptanceInputRow[];
  stockTotals?: readonly WarehouseStockTotalsInputRow[];

  /** Restrict to this WB geo name (substring match, RU-insensitive). */
  geoFilter?: string | null;
  /** Restrict to this macroRegion (exact match against our registry). */
  macroFilter?: string | null;
  /**
   * If `true`, drop rows whose `availability` is `blocked` or `unknown`.
   * Useful for the «куда могу отгрузить прямо сейчас» query.
   */
  availableOnly?: boolean;

  sortBy?: WarehouseTariffSortKey;
  /** If set, truncate the result after sorting. */
  limit?: number;
}

/* ───────── Helpers ───────── */

const SYNTHETIC_PARCEL_LITRES = 10;
const STORAGE_HORIZON_DAYS = 30;

function safeAdd(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

function shipCost(base: number | null, liter: number | null): number | null {
  if (base === null && liter === null) return null;
  return (base ?? 0) + (SYNTHETIC_PARCEL_LITRES - 1) * (liter ?? 0);
}

function storageCost(base: number | null, liter: number | null): number | null {
  if (base === null && liter === null) return null;
  const perDay = (base ?? 0) + (SYNTHETIC_PARCEL_LITRES - 1) * (liter ?? 0);
  return STORAGE_HORIZON_DAYS * perDay;
}

interface AcceptanceSummary {
  warehouseId: number | null;
  nearestAvailableDate: string | null;
  nearestFreeDate: string | null;
  minCoefficient14d: number | null;
  availableDays14d: number;
  isSortingCenter: boolean | null;
}

const EMPTY_ACCEPTANCE: AcceptanceSummary = {
  warehouseId: null,
  nearestAvailableDate: null,
  nearestFreeDate: null,
  minCoefficient14d: null,
  availableDays14d: 0,
  isSortingCenter: null,
};

function buildAcceptanceIndex(
  acceptanceRows: readonly AcceptanceInputRow[],
): Map<string, AcceptanceSummary> {
  // Sort once so we can pick the *earliest* matching date cheaply.
  const sorted = [...acceptanceRows].sort((a, b) =>
    a.effectiveDate.localeCompare(b.effectiveDate),
  );
  const byKey = new Map<string, AcceptanceSummary>();
  for (const row of sorted) {
    const key = normalizeWarehouseName(row.warehouseName ?? "");
    if (key === "") continue;
    let acc = byKey.get(key);
    if (!acc) {
      acc = {
        warehouseId: row.warehouseId ?? null,
        nearestAvailableDate: null,
        nearestFreeDate: null,
        minCoefficient14d: null,
        availableDays14d: 0,
        isSortingCenter: row.isSortingCenter ?? null,
      };
      byKey.set(key, acc);
    }
    if (acc.warehouseId === null && row.warehouseId !== undefined) {
      acc.warehouseId = row.warehouseId;
    }
    if (acc.isSortingCenter === null && row.isSortingCenter !== null) {
      acc.isSortingCenter = row.isSortingCenter;
    }
    if (
      acc.minCoefficient14d === null ||
      row.coefficient < acc.minCoefficient14d
    ) {
      acc.minCoefficient14d = row.coefficient;
    }
    const available =
      row.allowUnload === true &&
      row.coefficient >= 0 &&
      row.coefficient <= 1; // free or single-multiplier
    if (available) {
      acc.availableDays14d += 1;
      if (acc.nearestAvailableDate === null) {
        acc.nearestAvailableDate = row.effectiveDate;
      }
      if (row.coefficient === 0 && acc.nearestFreeDate === null) {
        acc.nearestFreeDate = row.effectiveDate;
      }
    }
  }
  return byKey;
}

function classifyAvailability(
  summary: AcceptanceSummary | undefined,
  hasAcceptanceData: boolean,
): WarehouseTariffAvailability {
  // No acceptance batch loaded at all → we honestly do not know.
  if (!hasAcceptanceData) return "unknown";
  // Box tariff has a warehouse that acceptance didn't return. This is
  // expected for FBS «Маркетплейс: …» pseudo-warehouses — they are listed
  // in tariffs/box but acceptance/coefficients only covers FBW. Mark
  // such rows as "unknown" rather than "blocked": absence of evidence
  // is not evidence of unavailability.
  if (summary === undefined) return "unknown";
  if (summary.nearestFreeDate !== null) return "available_free";
  if (summary.nearestAvailableDate !== null) return "available_paid";
  return "blocked";
}

function buildStockIndex(
  stockRows: readonly WarehouseStockTotalsInputRow[] | undefined,
): Map<string, number> {
  const m = new Map<string, number>();
  if (!stockRows) return m;
  for (const r of stockRows) {
    const key = normalizeWarehouseName(r.warehouseName);
    if (key === "") continue;
    m.set(key, (m.get(key) ?? 0) + Math.max(0, Math.trunc(r.currentStockUnits)));
  }
  return m;
}

function buildPalletIndex(
  palletRows: readonly PalletTariffInputRow[] | undefined,
): Map<string, PalletTariffInputRow> {
  const m = new Map<string, PalletTariffInputRow>();
  if (!palletRows) return m;
  for (const r of palletRows) {
    const key = normalizeWarehouseName(r.warehouseName);
    if (key === "") continue;
    m.set(key, r);
  }
  return m;
}

const AVAILABILITY_RANK: Record<WarehouseTariffAvailability, number> = {
  available_free: 0,
  available_paid: 1,
  unknown: 2,
  blocked: 3,
};

function compareRows(
  a: WarehouseTariffReportRow,
  b: WarehouseTariffReportRow,
  sortBy: WarehouseTariffSortKey,
): number {
  // The default `score` sort is "выбор оптимального склада": we want
  // cheapest *among usable* warehouses first, not the cheapest tariff
  // overall (which trivially picks unavailable СГТ/ВРЦ slots). Other
  // explicit sort keys (`delivery`, `storage`, `stock`, `acceptance`,
  // `name`) don't pre-rank by availability — users asking for those
  // keys want the raw column ordering.
  if (sortBy === "score") {
    const av = AVAILABILITY_RANK[a.availability] - AVAILABILITY_RANK[b.availability];
    if (av !== 0) return av;
  }

  const pickPrimary = (r: WarehouseTariffReportRow): number | null => {
    switch (sortBy) {
      case "delivery":
        return r.shipCostPer10L;
      case "storage":
        return r.storeCostPer10LPerMonth;
      case "stock":
        return r.currentStockUnits;
      case "acceptance":
        // Earlier acceptance date → smaller numeric value (lexicographic).
        return r.nearestAvailableDate === null
          ? null
          : Number(r.nearestAvailableDate.replace(/-/g, ""));
      case "name":
        return null;
      case "score":
      default:
        return r.score;
    }
  };
  const pa = pickPrimary(a);
  const pb = pickPrimary(b);
  const aMissing = pa === null || !Number.isFinite(pa);
  const bMissing = pb === null || !Number.isFinite(pb);
  if (aMissing && !bMissing) return 1;
  if (!aMissing && bMissing) return -1;
  if (!aMissing && !bMissing) {
    // For `stock` higher = better → invert; for the rest lower = better.
    const cmp =
      sortBy === "stock"
        ? (pb as number) - (pa as number)
        : (pa as number) - (pb as number);
    if (cmp !== 0) return cmp;
  }
  return a.warehouseName.localeCompare(b.warehouseName, "ru");
}

/* ───────── Builder ───────── */

export function buildWarehouseTariffReport(
  input: BuildWarehouseTariffReportInput,
): WarehouseTariffReport {
  const acceptanceIndex = buildAcceptanceIndex(input.acceptanceRows ?? []);
  const hasAcceptanceData =
    input.acceptanceFetchedAt !== null &&
    (input.acceptanceRows?.length ?? 0) > 0;
  const stockIndex = buildStockIndex(input.stockTotals);
  const palletIndex = buildPalletIndex(input.palletRows);

  const geoNeedle = input.geoFilter?.trim().toLocaleLowerCase("ru") ?? "";

  const rows: WarehouseTariffReportRow[] = [];
  for (const box of input.boxRows) {
    const warehouseKey = normalizeWarehouseName(box.warehouseName);
    if (warehouseKey === "") continue;

    const macroRegion =
      getWarehouseMacroRegion(box.warehouseName) ?? null;
    if (
      input.macroFilter !== undefined &&
      input.macroFilter !== null &&
      macroRegion !== input.macroFilter
    ) {
      continue;
    }
    if (
      geoNeedle !== "" &&
      !(box.geoName ?? "").toLocaleLowerCase("ru").includes(geoNeedle)
    ) {
      continue;
    }

    const acceptance = acceptanceIndex.get(warehouseKey);
    const availability = classifyAvailability(acceptance, hasAcceptanceData);
    const acceptanceSummary = acceptance ?? EMPTY_ACCEPTANCE;
    if (
      input.availableOnly === true &&
      availability !== "available_free" &&
      availability !== "available_paid"
    ) {
      continue;
    }

    const ship = shipCost(box.boxDeliveryBase, box.boxDeliveryLiter);
    const store = storageCost(box.boxStorageBase, box.boxStorageLiter);
    const score = safeAdd(ship, store);
    const pallet = palletIndex.get(warehouseKey) ?? null;
    const stockUnits = stockIndex.get(warehouseKey) ?? null;

    rows.push({
      warehouseName: box.warehouseName,
      warehouseKey,
      warehouseId: acceptanceSummary.warehouseId,
      geoName: box.geoName,
      macroRegion,
      boxDeliveryBase: box.boxDeliveryBase,
      boxDeliveryLiter: box.boxDeliveryLiter,
      boxStorageBase: box.boxStorageBase,
      boxStorageLiter: box.boxStorageLiter,
      shipCostPer10L: ship,
      storeCostPer10LPerMonth: store,
      score,
      palletStorageDaily: pallet?.palletStorageValueExpr ?? null,
      palletDeliveryBase: pallet?.palletDeliveryValueBase ?? null,
      nearestAvailableDate: acceptanceSummary.nearestAvailableDate,
      nearestFreeDate: acceptanceSummary.nearestFreeDate,
      minCoefficient14d: acceptanceSummary.minCoefficient14d,
      availableDays14d: acceptanceSummary.availableDays14d,
      isSortingCenter: acceptanceSummary.isSortingCenter,
      availability,
      currentStockUnits: stockUnits,
      dtTillMax: box.dtTillMax,
    });
  }

  const sortBy = input.sortBy ?? "score";
  rows.sort((a, b) => compareRows(a, b, sortBy));

  const limited =
    input.limit !== undefined && input.limit > 0
      ? rows.slice(0, input.limit)
      : rows;

  return {
    tariffDate: input.tariffDate,
    acceptanceFetchedAt: input.acceptanceFetchedAt,
    boxTypeId: input.boxTypeId,
    summary: buildSummary(rows),
    rows: limited,
  };
}

function buildSummary(
  rows: readonly WarehouseTariffReportRow[],
): WarehouseTariffReportSummary {
  const byAvailability = {
    available_free: 0,
    available_paid: 0,
    blocked: 0,
    unknown: 0,
  };
  const macroCount = new Map<string, number>();
  for (const r of rows) {
    byAvailability[r.availability] += 1;
    const m = r.macroRegion ?? "—";
    macroCount.set(m, (macroCount.get(m) ?? 0) + 1);
  }
  const byMacroRegion = Array.from(macroCount.entries())
    .map(([macroRegion, warehouses]) => ({ macroRegion, warehouses }))
    .sort((a, b) => b.warehouses - a.warehouses);
  return {
    totalWarehouses: rows.length,
    byAvailability,
    byMacroRegion,
  };
}
