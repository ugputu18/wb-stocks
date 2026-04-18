export function normTs(ts: unknown): string {
  return String(ts ?? "");
}

/** Как legacy `supplierRowKey` для `data-sup-key` и поиска строки. */
export function supplierRowKey(nmId: unknown, techSize: unknown): string {
  return String(nmId ?? "") + "|" + encodeURIComponent(normTs(techSize));
}

/** Первый индекс в основной таблице с тем же nm_id × tech_size (для связки с supplier). */
export function findMainRowIndexBySku(
  rows: unknown[],
  nmId: unknown,
  techSize: unknown,
): number {
  const want = normTs(techSize);
  const nid = typeof nmId === "number" ? nmId : Number(nmId);
  if (!Number.isFinite(nid)) return -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const on = typeof o.nmId === "number" ? o.nmId : Number(o.nmId);
    if (on === nid && normTs(o.techSize) === want) return i;
  }
  return -1;
}

/** Как legacy `findSupplierRow` по `lastSupplierRows`. */
export function findSupplierRow(
  supplierRows: unknown[] | undefined,
  nmId: number | null | undefined,
  techSize: unknown,
): Record<string, unknown> | null {
  if (nmId == null || !Array.isArray(supplierRows)) return null;
  const want = normTs(techSize);
  for (const r of supplierRows) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (o.nmId === nmId && normTs(o.techSize) === want) return o;
  }
  return null;
}
