import { z } from "zod";

/**
 * WB tariff endpoints return numeric fields as **strings** with Russian
 * formatting: comma as decimal separator and (sometimes) non-breaking
 * spaces as thousand separators.
 * Examples: "48", "0,14", "11,2", "1 039", "" (= no value).
 *
 * `parseTariffDecimal` normalizes those to JS `number | null`. Returns
 * `null` for empty, whitespace-only, or unparsable input — WB occasionally
 * leaves fields blank (e.g. `storageAdditionalLiter` for pallets).
 */
export function parseTariffDecimal(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.replace(/[\s\u00A0]/g, "").replace(",", ".");
  if (trimmed === "" || trimmed === "-") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/* ───────── Box tariffs ───────── */

export const wbBoxTariffRowSchema = z
  .object({
    warehouseName: z.string(),
    geoName: z.string().nullish(),
    boxDeliveryBase: z.string().nullish(),
    boxDeliveryLiter: z.string().nullish(),
    boxDeliveryCoefExpr: z.string().nullish(),
    boxDeliveryMarketplaceBase: z.string().nullish(),
    boxDeliveryMarketplaceLiter: z.string().nullish(),
    boxDeliveryMarketplaceCoefExpr: z.string().nullish(),
    boxStorageBase: z.string().nullish(),
    boxStorageLiter: z.string().nullish(),
    boxStorageCoefExpr: z.string().nullish(),
  })
  .passthrough();
export type WbBoxTariffRow = z.infer<typeof wbBoxTariffRowSchema>;

export const wbBoxTariffEnvelopeSchema = z.object({
  response: z.object({
    data: z.object({
      dtNextBox: z.string().nullish(),
      dtTillMax: z.string().nullish(),
      warehouseList: z.array(z.unknown()),
    }),
  }),
});

export interface WbBoxTariffRecord {
  tariffDate: string; // YYYY-MM-DD — the `date=` param we asked for
  fetchedAt: string; // ISO-8601 UTC
  warehouseName: string;
  geoName: string | null;
  boxDeliveryBase: number | null;
  boxDeliveryLiter: number | null;
  boxDeliveryCoefExpr: number | null;
  boxDeliveryMarketplaceBase: number | null;
  boxDeliveryMarketplaceLiter: number | null;
  boxDeliveryMarketplaceCoefExpr: number | null;
  boxStorageBase: number | null;
  boxStorageLiter: number | null;
  boxStorageCoefExpr: number | null;
  dtNextBox: string | null;
  dtTillMax: string | null;
}

/* ───────── Pallet tariffs ───────── */

export const wbPalletTariffRowSchema = z
  .object({
    warehouseName: z.string(),
    geoName: z.string().nullish(),
    palletDeliveryValueBase: z.string().nullish(),
    palletDeliveryValueLiter: z.string().nullish(),
    palletDeliveryExpr: z.string().nullish(),
    palletStorageValueExpr: z.string().nullish(),
    palletStorageExpr: z.string().nullish(),
  })
  .passthrough();
export type WbPalletTariffRow = z.infer<typeof wbPalletTariffRowSchema>;

export const wbPalletTariffEnvelopeSchema = z.object({
  response: z.object({
    data: z.object({
      dtNextPallet: z.string().nullish(),
      dtTillMax: z.string().nullish(),
      warehouseList: z.array(z.unknown()),
    }),
  }),
});

export interface WbPalletTariffRecord {
  tariffDate: string;
  fetchedAt: string;
  warehouseName: string;
  geoName: string | null;
  palletDeliveryValueBase: number | null;
  palletDeliveryValueLiter: number | null;
  palletDeliveryExpr: number | null;
  palletStorageValueExpr: number | null;
  palletStorageExpr: number | null;
  dtNextPallet: string | null;
  dtTillMax: string | null;
}

/* ───────── Acceptance coefficients ───────── */

export const wbAcceptanceCoefficientRowSchema = z
  .object({
    date: z.string(),
    coefficient: z.number(),
    warehouseID: z.number().int(),
    warehouseName: z.string().nullish(),
    allowUnload: z.boolean().nullish(),
    boxTypeID: z.number().int().nullish(),
    boxTypeName: z.string().nullish(),
    storageCoef: z.union([z.string(), z.number()]).nullish(),
    deliveryCoef: z.union([z.string(), z.number()]).nullish(),
    deliveryBaseLiter: z.union([z.string(), z.number()]).nullish(),
    deliveryAdditionalLiter: z.union([z.string(), z.number()]).nullish(),
    storageBaseLiter: z.union([z.string(), z.number()]).nullish(),
    storageAdditionalLiter: z.union([z.string(), z.number()]).nullish(),
    isSortingCenter: z.boolean().nullish(),
  })
  .passthrough();
export type WbAcceptanceCoefficientRow = z.infer<
  typeof wbAcceptanceCoefficientRowSchema
>;

export interface WbAcceptanceCoefficientRecord {
  fetchedAt: string;
  effectiveDate: string; // YYYY-MM-DD derived from WB's `date` field
  warehouseId: number;
  warehouseName: string | null;
  boxTypeId: number | null;
  boxTypeName: string | null;
  coefficient: number;
  allowUnload: boolean | null;
  storageCoef: number | null;
  deliveryCoef: number | null;
  deliveryBaseLiter: number | null;
  deliveryAdditionalLiter: number | null;
  storageBaseLiter: number | null;
  storageAdditionalLiter: number | null;
  isSortingCenter: boolean | null;
}

/**
 * Acceptance API returns date as RFC3339 (e.g. "2024-09-04T00:00:00Z"); we
 * truncate to YYYY-MM-DD for storage so a single `effective_date` column
 * can be compared to dates from box/pallet endpoints. Time component is
 * always 00:00:00 in WB's response (it's a calendar date).
 */
export function toEffectiveDate(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 10) return trimmed.slice(0, 10);
  return trimmed;
}
