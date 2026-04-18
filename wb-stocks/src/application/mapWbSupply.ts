import type { ZodIssue } from "zod";
import {
  wbSupplyDetailsSchema,
  wbSupplyGoodsRowSchema,
  wbSupplyListRowSchema,
  type WbSupplyDetails,
  type WbSupplyGoodsRow,
  type WbSupplyItemRecord,
  type WbSupplyListRow,
  type WbSupplyRecord,
} from "../domain/wbSupply.js";

export type Parsed<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; raw: unknown };

export function parseListRow(raw: unknown): Parsed<WbSupplyListRow> {
  const r = wbSupplyListRowSchema.safeParse(raw);
  return r.success
    ? { ok: true, value: r.data }
    : { ok: false, reason: zodReason(r.error.issues), raw };
}

export function parseDetails(raw: unknown): Parsed<WbSupplyDetails> {
  const r = wbSupplyDetailsSchema.safeParse(raw);
  return r.success
    ? { ok: true, value: r.data }
    : { ok: false, reason: zodReason(r.error.issues), raw };
}

export function parseGoodsRow(raw: unknown): Parsed<WbSupplyGoodsRow> {
  const r = wbSupplyGoodsRowSchema.safeParse(raw);
  return r.success
    ? { ok: true, value: r.data }
    : { ok: false, reason: zodReason(r.error.issues), raw };
}

/**
 * Build the internal supply header from the List row plus optional Details.
 * Fields present only in Details default to `null` when details are not yet
 * fetched.
 */
export function buildSupplyRecord(
  list: WbSupplyListRow,
  details: WbSupplyDetails | null,
): WbSupplyRecord {
  const supplyId = list.supplyID;
  if (supplyId === null || supplyId === 0) {
    throw new Error(
      "Cannot build supply record without a non-zero supplyID; " +
        "List rows with null/0 supplyID should be filtered out earlier.",
    );
  }
  return {
    supplyId,
    preorderId: nullableInt(list.preorderID),
    phone: nullableString(list.phone),
    createDate: nullableString(list.createDate ?? details?.createDate),
    supplyDate: nullableString(list.supplyDate ?? details?.supplyDate),
    factDate: nullableString(list.factDate ?? details?.factDate),
    updatedDate: nullableString(list.updatedDate ?? details?.updatedDate),
    statusId: list.statusID,
    boxTypeId: nullableInt(list.boxTypeID ?? details?.boxTypeID),
    virtualTypeId: nullableInt(list.virtualTypeID ?? details?.virtualTypeID),
    isBoxOnPallet: nullableBool(
      list.isBoxOnPallet ?? details?.isBoxOnPallet,
    ),
    warehouseId: nullableInt(details?.warehouseID),
    warehouseName: nullableString(details?.warehouseName),
    actualWarehouseId: nullableInt(details?.actualWarehouseID),
    actualWarehouseName: nullableString(details?.actualWarehouseName),
    quantity: nullableInt(details?.quantity),
    acceptedQuantity: nullableInt(details?.acceptedQuantity),
    unloadingQuantity: nullableInt(details?.unloadingQuantity),
    readyForSaleQuantity: nullableInt(details?.readyForSaleQuantity),
    depersonalizedQuantity: nullableInt(details?.depersonalizedQuantity),
  };
}

export function buildItemRecord(
  supplyId: number,
  raw: WbSupplyGoodsRow,
): WbSupplyItemRecord {
  return {
    supplyId,
    barcode: nullableString(raw.barcode),
    vendorCode: nullableString(raw.vendorCode),
    nmId: raw.nmID,
    techSize: nullableString(raw.techSize),
    color: nullableString(raw.color),
    quantity: nullableInt(raw.quantity),
    acceptedQuantity: nullableInt(raw.acceptedQuantity),
    readyForSaleQuantity: nullableInt(raw.readyForSaleQuantity),
    unloadingQuantity: nullableInt(raw.unloadingQuantity),
  };
}

function nullableString(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function nullableInt(v: number | null | undefined): number | null {
  if (v === undefined || v === null) return null;
  return v;
}

function nullableBool(v: boolean | null | undefined): boolean | null {
  if (v === undefined || v === null) return null;
  return v;
}

function zodReason(issues: readonly ZodIssue[]): string {
  return issues
    .map((i) => `${i.path.map(String).join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
