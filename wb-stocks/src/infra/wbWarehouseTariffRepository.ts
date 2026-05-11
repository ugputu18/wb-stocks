import type { DbHandle } from "./db.js";
import type {
  WbAcceptanceCoefficientRecord,
  WbBoxTariffRecord,
  WbPalletTariffRecord,
} from "../domain/wbWarehouseTariff.js";

/**
 * Storage for WB warehouse tariffs (box / pallet / acceptance).
 *
 * Idempotency model:
 * - **Box & pallet** are keyed by `(tariff_date, warehouse_name)` and use
 *   `INSERT OR REPLACE`: re-running the importer for the same date
 *   overwrites that day's snapshot (tariffs published mid-day get reflected
 *   without manual cleanup). One row per warehouse per calendar date.
 * - **Acceptance coefficients** are a 14-day rolling forecast — WB recomputes
 *   them throughout the day. Each importer run is identified by its own
 *   `fetched_at` and produces a *separate* batch keyed by
 *   `(fetched_at, effective_date, warehouse_id, box_type_id)`, so history is
 *   preserved across runs. Callers that just want "current state" should
 *   filter by the latest `fetched_at`.
 */
export class WbWarehouseTariffRepository {
  constructor(private readonly db: DbHandle) {}

  saveBoxBatch(rows: readonly WbBoxTariffRecord[]): { inserted: number } {
    if (rows.length === 0) return { inserted: 0 };
    const stmt = this.db.prepare(
      `INSERT INTO wb_warehouse_box_tariffs (
         tariff_date, fetched_at, warehouse_name, geo_name,
         box_delivery_base, box_delivery_liter, box_delivery_coef_expr,
         box_delivery_marketplace_base, box_delivery_marketplace_liter,
         box_delivery_marketplace_coef_expr,
         box_storage_base, box_storage_liter, box_storage_coef_expr,
         dt_next_box, dt_till_max
       ) VALUES (
         @tariffDate, @fetchedAt, @warehouseName, @geoName,
         @boxDeliveryBase, @boxDeliveryLiter, @boxDeliveryCoefExpr,
         @boxDeliveryMarketplaceBase, @boxDeliveryMarketplaceLiter,
         @boxDeliveryMarketplaceCoefExpr,
         @boxStorageBase, @boxStorageLiter, @boxStorageCoefExpr,
         @dtNextBox, @dtTillMax
       )
       ON CONFLICT(tariff_date, warehouse_name) DO UPDATE SET
         fetched_at                        = excluded.fetched_at,
         geo_name                          = excluded.geo_name,
         box_delivery_base                 = excluded.box_delivery_base,
         box_delivery_liter                = excluded.box_delivery_liter,
         box_delivery_coef_expr            = excluded.box_delivery_coef_expr,
         box_delivery_marketplace_base     = excluded.box_delivery_marketplace_base,
         box_delivery_marketplace_liter    = excluded.box_delivery_marketplace_liter,
         box_delivery_marketplace_coef_expr = excluded.box_delivery_marketplace_coef_expr,
         box_storage_base                  = excluded.box_storage_base,
         box_storage_liter                 = excluded.box_storage_liter,
         box_storage_coef_expr             = excluded.box_storage_coef_expr,
         dt_next_box                       = excluded.dt_next_box,
         dt_till_max                       = excluded.dt_till_max`,
    );
    let inserted = 0;
    const tx = this.db.transaction((batch: readonly WbBoxTariffRecord[]) => {
      for (const row of batch) {
        const info = stmt.run(row);
        inserted += info.changes;
      }
    });
    tx(rows);
    return { inserted };
  }

  savePalletBatch(
    rows: readonly WbPalletTariffRecord[],
  ): { inserted: number } {
    if (rows.length === 0) return { inserted: 0 };
    const stmt = this.db.prepare(
      `INSERT INTO wb_warehouse_pallet_tariffs (
         tariff_date, fetched_at, warehouse_name, geo_name,
         pallet_delivery_value_base, pallet_delivery_value_liter,
         pallet_delivery_expr,
         pallet_storage_value_expr, pallet_storage_expr,
         dt_next_pallet, dt_till_max
       ) VALUES (
         @tariffDate, @fetchedAt, @warehouseName, @geoName,
         @palletDeliveryValueBase, @palletDeliveryValueLiter,
         @palletDeliveryExpr,
         @palletStorageValueExpr, @palletStorageExpr,
         @dtNextPallet, @dtTillMax
       )
       ON CONFLICT(tariff_date, warehouse_name) DO UPDATE SET
         fetched_at                  = excluded.fetched_at,
         geo_name                    = excluded.geo_name,
         pallet_delivery_value_base  = excluded.pallet_delivery_value_base,
         pallet_delivery_value_liter = excluded.pallet_delivery_value_liter,
         pallet_delivery_expr        = excluded.pallet_delivery_expr,
         pallet_storage_value_expr   = excluded.pallet_storage_value_expr,
         pallet_storage_expr         = excluded.pallet_storage_expr,
         dt_next_pallet              = excluded.dt_next_pallet,
         dt_till_max                 = excluded.dt_till_max`,
    );
    let inserted = 0;
    const tx = this.db.transaction((batch: readonly WbPalletTariffRecord[]) => {
      for (const row of batch) {
        const info = stmt.run(row);
        inserted += info.changes;
      }
    });
    tx(rows);
    return { inserted };
  }

  saveAcceptanceBatch(
    rows: readonly WbAcceptanceCoefficientRecord[],
  ): { inserted: number } {
    if (rows.length === 0) return { inserted: 0 };
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO wb_warehouse_acceptance_coefficients (
         fetched_at, effective_date, warehouse_id, warehouse_name,
         box_type_id, box_type_name, coefficient, allow_unload,
         storage_coef, delivery_coef, delivery_base_liter,
         delivery_additional_liter, storage_base_liter,
         storage_additional_liter, is_sorting_center
       ) VALUES (
         @fetchedAt, @effectiveDate, @warehouseId, @warehouseName,
         @boxTypeId, @boxTypeName, @coefficient, @allowUnloadInt,
         @storageCoef, @deliveryCoef, @deliveryBaseLiter,
         @deliveryAdditionalLiter, @storageBaseLiter,
         @storageAdditionalLiter, @isSortingCenterInt
       )`,
    );
    let inserted = 0;
    const tx = this.db.transaction(
      (batch: readonly WbAcceptanceCoefficientRecord[]) => {
        for (const row of batch) {
          const info = stmt.run({
            ...row,
            allowUnloadInt: boolToInt(row.allowUnload),
            isSortingCenterInt: boolToInt(row.isSortingCenter),
          });
          inserted += info.changes;
        }
      },
    );
    tx(rows);
    return { inserted };
  }

  /** Latest box tariffs for `tariffDate`, ordered by warehouseName. */
  getBoxForDate(tariffDate: string): WbBoxTariffRecord[] {
    return this.db
      .prepare(
        `SELECT tariff_date                       AS tariffDate,
                fetched_at                        AS fetchedAt,
                warehouse_name                    AS warehouseName,
                geo_name                          AS geoName,
                box_delivery_base                 AS boxDeliveryBase,
                box_delivery_liter                AS boxDeliveryLiter,
                box_delivery_coef_expr            AS boxDeliveryCoefExpr,
                box_delivery_marketplace_base     AS boxDeliveryMarketplaceBase,
                box_delivery_marketplace_liter    AS boxDeliveryMarketplaceLiter,
                box_delivery_marketplace_coef_expr AS boxDeliveryMarketplaceCoefExpr,
                box_storage_base                  AS boxStorageBase,
                box_storage_liter                 AS boxStorageLiter,
                box_storage_coef_expr             AS boxStorageCoefExpr,
                dt_next_box                       AS dtNextBox,
                dt_till_max                       AS dtTillMax
           FROM wb_warehouse_box_tariffs
          WHERE tariff_date = ?
          ORDER BY warehouse_name`,
      )
      .all(tariffDate) as WbBoxTariffRecord[];
  }

  getPalletForDate(tariffDate: string): WbPalletTariffRecord[] {
    return this.db
      .prepare(
        `SELECT tariff_date                 AS tariffDate,
                fetched_at                  AS fetchedAt,
                warehouse_name              AS warehouseName,
                geo_name                    AS geoName,
                pallet_delivery_value_base  AS palletDeliveryValueBase,
                pallet_delivery_value_liter AS palletDeliveryValueLiter,
                pallet_delivery_expr        AS palletDeliveryExpr,
                pallet_storage_value_expr   AS palletStorageValueExpr,
                pallet_storage_expr         AS palletStorageExpr,
                dt_next_pallet              AS dtNextPallet,
                dt_till_max                 AS dtTillMax
           FROM wb_warehouse_pallet_tariffs
          WHERE tariff_date = ?
          ORDER BY warehouse_name`,
      )
      .all(tariffDate) as WbPalletTariffRecord[];
  }

  /**
   * Самая свежая дата `tariff_date` в `wb_warehouse_box_tariffs` или `null`,
   * если тарифы ещё не импортировались. Удобно использовать как «default
   * срез» для read-моделей, которые не зависят от конкретной даты тарифа
   * (например, справочный показ цены за коробку в UI).
   */
  getLatestBoxTariffDate(): string | null {
    const row = this.db
      .prepare(
        `SELECT MAX(tariff_date) AS d FROM wb_warehouse_box_tariffs`,
      )
      .get() as { d: string | null };
    return row.d;
  }

  /**
   * Box-тарифы за самую свежую дату. Возвращает пустой массив, если в БД
   * нет тарифов вообще. Эквивалентно
   * `getBoxForDate(getLatestBoxTariffDate() ?? "")`, но без второго round-trip.
   */
  getLatestBox(): WbBoxTariffRecord[] {
    const date = this.getLatestBoxTariffDate();
    if (date === null) return [];
    return this.getBoxForDate(date);
  }

  /** Most recent `tariff_date` in `wb_warehouse_pallet_tariffs`, or `null`. */
  getLatestPalletTariffDate(): string | null {
    const r = this.db
      .prepare(
        `SELECT MAX(tariff_date) AS m FROM wb_warehouse_pallet_tariffs`,
      )
      .get() as { m: string | null };
    return r.m ?? null;
  }

  /** Most recent `fetched_at` in `wb_warehouse_acceptance_coefficients`, or `null`. */
  getLatestAcceptanceFetchedAt(): string | null {
    const r = this.db
      .prepare(
        `SELECT MAX(fetched_at) AS m FROM wb_warehouse_acceptance_coefficients`,
      )
      .get() as { m: string | null };
    return r.m ?? null;
  }

  /** Latest acceptance batch (= max `fetched_at`), expanded to records. */
  getLatestAcceptance(): WbAcceptanceCoefficientRecord[] {
    const latest = this.db
      .prepare(
        `SELECT MAX(fetched_at) AS m FROM wb_warehouse_acceptance_coefficients`,
      )
      .get() as { m: string | null };
    if (latest.m === null) return [];
    return this.db
      .prepare(
        `SELECT fetched_at               AS fetchedAt,
                effective_date           AS effectiveDate,
                warehouse_id             AS warehouseId,
                warehouse_name           AS warehouseName,
                box_type_id              AS boxTypeId,
                box_type_name            AS boxTypeName,
                coefficient              AS coefficient,
                allow_unload             AS allowUnloadInt,
                storage_coef             AS storageCoef,
                delivery_coef            AS deliveryCoef,
                delivery_base_liter      AS deliveryBaseLiter,
                delivery_additional_liter AS deliveryAdditionalLiter,
                storage_base_liter       AS storageBaseLiter,
                storage_additional_liter AS storageAdditionalLiter,
                is_sorting_center        AS isSortingCenterInt
           FROM wb_warehouse_acceptance_coefficients
          WHERE fetched_at = ?
          ORDER BY effective_date, warehouse_id, box_type_id`,
      )
      .all(latest.m)
      .map(rehydrateAcceptance);
  }
}

function boolToInt(v: boolean | null): number | null {
  if (v === null || v === undefined) return null;
  return v ? 1 : 0;
}

function intToBool(v: number | null | undefined): boolean | null {
  if (v === null || v === undefined) return null;
  return v !== 0;
}

interface AcceptanceRowFromDb {
  fetchedAt: string;
  effectiveDate: string;
  warehouseId: number;
  warehouseName: string | null;
  boxTypeId: number | null;
  boxTypeName: string | null;
  coefficient: number;
  allowUnloadInt: number | null;
  storageCoef: number | null;
  deliveryCoef: number | null;
  deliveryBaseLiter: number | null;
  deliveryAdditionalLiter: number | null;
  storageBaseLiter: number | null;
  storageAdditionalLiter: number | null;
  isSortingCenterInt: number | null;
}

function rehydrateAcceptance(raw: unknown): WbAcceptanceCoefficientRecord {
  const r = raw as AcceptanceRowFromDb;
  return {
    fetchedAt: r.fetchedAt,
    effectiveDate: r.effectiveDate,
    warehouseId: r.warehouseId,
    warehouseName: r.warehouseName,
    boxTypeId: r.boxTypeId,
    boxTypeName: r.boxTypeName,
    coefficient: r.coefficient,
    allowUnload: intToBool(r.allowUnloadInt),
    storageCoef: r.storageCoef,
    deliveryCoef: r.deliveryCoef,
    deliveryBaseLiter: r.deliveryBaseLiter,
    deliveryAdditionalLiter: r.deliveryAdditionalLiter,
    storageBaseLiter: r.storageBaseLiter,
    storageAdditionalLiter: r.storageAdditionalLiter,
    isSortingCenter: intToBool(r.isSortingCenterInt),
  };
}
