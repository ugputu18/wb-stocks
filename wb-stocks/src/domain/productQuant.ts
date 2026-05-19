export const DEFAULT_UNITS_PER_BOX = 1;

export interface ProductQuantRecord {
  vendorCode: string;
  unitsPerBox: number;
  sourceFile: string | null;
  importedAt: string;
}

export function normalizeUnitsPerBox(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    return DEFAULT_UNITS_PER_BOX;
  }
  return n;
}

export function unitsPerBoxForVendor(
  vendorCode: string | null | undefined,
  unitsPerBoxByVendor: ReadonlyMap<string, number> | undefined,
): number {
  const v = vendorCode?.trim();
  if (!v || !unitsPerBoxByVendor || unitsPerBoxByVendor.size === 0) {
    return DEFAULT_UNITS_PER_BOX;
  }
  return normalizeUnitsPerBox(unitsPerBoxByVendor.get(v));
}

export function roundUpToBoxUnits(rawQty: number, unitsPerBox: number): number {
  const q = Number(rawQty);
  const box = normalizeUnitsPerBox(unitsPerBox);
  if (!Number.isFinite(q) || q <= 0) return 0;
  return Math.ceil(q / box - 1e-12) * box;
}

export function roundDownToBoxUnits(rawQty: number, unitsPerBox: number): number {
  const q = Number(rawQty);
  const box = normalizeUnitsPerBox(unitsPerBox);
  if (!Number.isFinite(q) || q <= 0) return 0;
  return Math.floor(q / box + 1e-12) * box;
}

export function roundRegionalShipmentToBoxes(
  rawNeed: number,
  availableStock: number,
  unitsPerBox: number,
): number {
  const needed = roundUpToBoxUnits(rawNeed, unitsPerBox);
  const availableFullBoxes = roundDownToBoxUnits(availableStock, unitsPerBox);
  return Math.min(needed, availableFullBoxes);
}
