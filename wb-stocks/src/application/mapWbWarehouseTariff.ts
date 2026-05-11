import {
  parseTariffDecimal,
  toEffectiveDate,
  wbAcceptanceCoefficientRowSchema,
  wbBoxTariffEnvelopeSchema,
  wbBoxTariffRowSchema,
  wbPalletTariffEnvelopeSchema,
  wbPalletTariffRowSchema,
  type WbAcceptanceCoefficientRecord,
  type WbBoxTariffRecord,
  type WbPalletTariffRecord,
} from "../domain/wbWarehouseTariff.js";

export type MapResult<T> =
  | { ok: true; record: T }
  | { ok: false; reason: string; raw: unknown };

export interface BoxTariffParseResult {
  records: WbBoxTariffRecord[];
  skipped: { reason: string; raw: unknown }[];
  dtNextBox: string | null;
  dtTillMax: string | null;
}

export interface PalletTariffParseResult {
  records: WbPalletTariffRecord[];
  skipped: { reason: string; raw: unknown }[];
  dtNextPallet: string | null;
  dtTillMax: string | null;
}

function normalizeString(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t === "" ? null : t;
}

export function mapBoxTariffEnvelope(
  body: unknown,
  ctx: { tariffDate: string; fetchedAt: string },
): BoxTariffParseResult {
  const env = wbBoxTariffEnvelopeSchema.safeParse(body);
  if (!env.success) {
    throw new Error(
      `WB box tariff response shape unexpected: ${env.error.message}`,
    );
  }
  const data = env.data.response.data;
  const records: WbBoxTariffRecord[] = [];
  const skipped: { reason: string; raw: unknown }[] = [];
  for (const raw of data.warehouseList) {
    const r = wbBoxTariffRowSchema.safeParse(raw);
    if (!r.success) {
      skipped.push({ reason: r.error.message, raw });
      continue;
    }
    const row = r.data;
    records.push({
      tariffDate: ctx.tariffDate,
      fetchedAt: ctx.fetchedAt,
      warehouseName: row.warehouseName.trim(),
      geoName: normalizeString(row.geoName),
      boxDeliveryBase: parseTariffDecimal(row.boxDeliveryBase),
      boxDeliveryLiter: parseTariffDecimal(row.boxDeliveryLiter),
      boxDeliveryCoefExpr: parseTariffDecimal(row.boxDeliveryCoefExpr),
      boxDeliveryMarketplaceBase: parseTariffDecimal(
        row.boxDeliveryMarketplaceBase,
      ),
      boxDeliveryMarketplaceLiter: parseTariffDecimal(
        row.boxDeliveryMarketplaceLiter,
      ),
      boxDeliveryMarketplaceCoefExpr: parseTariffDecimal(
        row.boxDeliveryMarketplaceCoefExpr,
      ),
      boxStorageBase: parseTariffDecimal(row.boxStorageBase),
      boxStorageLiter: parseTariffDecimal(row.boxStorageLiter),
      boxStorageCoefExpr: parseTariffDecimal(row.boxStorageCoefExpr),
      dtNextBox: normalizeString(data.dtNextBox),
      dtTillMax: normalizeString(data.dtTillMax),
    });
  }
  return {
    records,
    skipped,
    dtNextBox: normalizeString(data.dtNextBox),
    dtTillMax: normalizeString(data.dtTillMax),
  };
}

export function mapPalletTariffEnvelope(
  body: unknown,
  ctx: { tariffDate: string; fetchedAt: string },
): PalletTariffParseResult {
  const env = wbPalletTariffEnvelopeSchema.safeParse(body);
  if (!env.success) {
    throw new Error(
      `WB pallet tariff response shape unexpected: ${env.error.message}`,
    );
  }
  const data = env.data.response.data;
  const records: WbPalletTariffRecord[] = [];
  const skipped: { reason: string; raw: unknown }[] = [];
  for (const raw of data.warehouseList) {
    const r = wbPalletTariffRowSchema.safeParse(raw);
    if (!r.success) {
      skipped.push({ reason: r.error.message, raw });
      continue;
    }
    const row = r.data;
    records.push({
      tariffDate: ctx.tariffDate,
      fetchedAt: ctx.fetchedAt,
      warehouseName: row.warehouseName.trim(),
      geoName: normalizeString(row.geoName),
      palletDeliveryValueBase: parseTariffDecimal(row.palletDeliveryValueBase),
      palletDeliveryValueLiter: parseTariffDecimal(
        row.palletDeliveryValueLiter,
      ),
      palletDeliveryExpr: parseTariffDecimal(row.palletDeliveryExpr),
      palletStorageValueExpr: parseTariffDecimal(row.palletStorageValueExpr),
      palletStorageExpr: parseTariffDecimal(row.palletStorageExpr),
      dtNextPallet: normalizeString(data.dtNextPallet),
      dtTillMax: normalizeString(data.dtTillMax),
    });
  }
  return {
    records,
    skipped,
    dtNextPallet: normalizeString(data.dtNextPallet),
    dtTillMax: normalizeString(data.dtTillMax),
  };
}

export function mapAcceptanceCoefficient(
  raw: unknown,
  ctx: { fetchedAt: string },
): MapResult<WbAcceptanceCoefficientRecord> {
  const parsed = wbAcceptanceCoefficientRowSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.message, raw };
  }
  const row = parsed.data;
  return {
    ok: true,
    record: {
      fetchedAt: ctx.fetchedAt,
      effectiveDate: toEffectiveDate(row.date),
      warehouseId: row.warehouseID,
      warehouseName: normalizeString(row.warehouseName),
      boxTypeId: row.boxTypeID ?? null,
      boxTypeName: normalizeString(row.boxTypeName),
      coefficient: row.coefficient,
      allowUnload: row.allowUnload ?? null,
      storageCoef: parseTariffDecimal(row.storageCoef),
      deliveryCoef: parseTariffDecimal(row.deliveryCoef),
      deliveryBaseLiter: parseTariffDecimal(row.deliveryBaseLiter),
      deliveryAdditionalLiter: parseTariffDecimal(row.deliveryAdditionalLiter),
      storageBaseLiter: parseTariffDecimal(row.storageBaseLiter),
      storageAdditionalLiter: parseTariffDecimal(row.storageAdditionalLiter),
      isSortingCenter: row.isSortingCenter ?? null,
    },
  };
}
