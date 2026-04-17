import { z } from "zod";

/**
 * Supply status IDs returned by WB FBW API.
 * See https://dev.wildberries.ru/en/news/154 (Supply Methods Update).
 */
export const SUPPLY_STATUS_LABELS: Record<number, string> = {
  1: "Not planned",
  2: "Planned",
  3: "Unloading allowed",
  4: "Accepting",
  5: "Accepted",
  6: "Unloaded at the gate",
};

/**
 * Row as returned by `POST /api/v1/supplies` (Supplies List).
 * We only validate what we actually use and allow extra/missing fields so a
 * minor WB response tweak doesn't break the whole import.
 */
export const wbSupplyListRowSchema = z.object({
  phone: z.string().nullish(),
  supplyID: z.number().int().nullable(),
  preorderID: z.number().int().nullish(),
  createDate: z.string().nullish(),
  supplyDate: z.string().nullish(),
  factDate: z.string().nullish(),
  updatedDate: z.string().nullish(),
  statusID: z.number().int(),
  boxTypeID: z.number().int().nullish(),
  virtualTypeID: z.number().int().nullish(),
  isBoxOnPallet: z.boolean().nullish(),
});
export type WbSupplyListRow = z.infer<typeof wbSupplyListRowSchema>;

/**
 * Row as returned by `GET /api/v1/supplies/{ID}` (Supply Details).
 * Gives warehouse + quantity breakdown that the List method lacks.
 */
export const wbSupplyDetailsSchema = z.object({
  phone: z.string().nullish(),
  statusID: z.number().int().nullish(),
  virtualTypeID: z.number().int().nullish(),
  boxTypeID: z.number().int().nullish(),
  createDate: z.string().nullish(),
  supplyDate: z.string().nullish(),
  factDate: z.string().nullish(),
  updatedDate: z.string().nullish(),
  warehouseID: z.number().int().nullable().optional(),
  warehouseName: z.string().nullish(),
  actualWarehouseID: z.number().int().nullable().optional(),
  actualWarehouseName: z.string().nullish(),
  transitWarehouseID: z.number().int().nullable().optional(),
  transitWarehouseName: z.string().nullish(),
  quantity: z.number().int().nullish(),
  readyForSaleQuantity: z.number().int().nullish(),
  acceptedQuantity: z.number().int().nullish(),
  unloadingQuantity: z.number().int().nullish(),
  depersonalizedQuantity: z.number().int().nullish(),
  isBoxOnPallet: z.boolean().nullish(),
});
export type WbSupplyDetails = z.infer<typeof wbSupplyDetailsSchema>;

/**
 * Row as returned by `GET /api/v1/supplies/{ID}/goods` (Supply Products).
 */
export const wbSupplyGoodsRowSchema = z.object({
  barcode: z.string().nullish(),
  vendorCode: z.string().nullish(),
  nmID: z.number().int(),
  techSize: z.string().nullish(),
  color: z.string().nullish(),
  quantity: z.number().int().nullish(),
  readyForSaleQuantity: z.number().int().nullish(),
  unloadingQuantity: z.number().int().nullish(),
  acceptedQuantity: z.number().int().nullish(),
});
export type WbSupplyGoodsRow = z.infer<typeof wbSupplyGoodsRowSchema>;

/**
 * Internal supply header record (one row in `wb_supplies`).
 * Upserted by `supply_id` (WB's external numeric supply identifier).
 */
export interface WbSupplyRecord {
  supplyId: number;
  preorderId: number | null;
  phone: string | null;
  createDate: string | null;
  supplyDate: string | null;
  factDate: string | null;
  updatedDate: string | null;
  statusId: number;
  boxTypeId: number | null;
  virtualTypeId: number | null;
  isBoxOnPallet: boolean | null;
  // Populated from Supply Details (if fetched):
  warehouseId: number | null;
  warehouseName: string | null;
  actualWarehouseId: number | null;
  actualWarehouseName: string | null;
  quantity: number | null;
  acceptedQuantity: number | null;
  unloadingQuantity: number | null;
  readyForSaleQuantity: number | null;
  depersonalizedQuantity: number | null;
}

/**
 * Internal supply item record (one row in `wb_supply_items`).
 */
export interface WbSupplyItemRecord {
  supplyId: number;
  barcode: string | null;
  vendorCode: string | null;
  nmId: number;
  techSize: string | null;
  color: string | null;
  quantity: number | null;
  acceptedQuantity: number | null;
  readyForSaleQuantity: number | null;
  unloadingQuantity: number | null;
}
