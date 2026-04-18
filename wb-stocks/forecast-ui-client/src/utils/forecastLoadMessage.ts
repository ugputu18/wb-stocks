export type LoadResult =
  | { ok: true }
  | { ok: false; message: string }
  | { ok: false; stale: true };

export function isStale(r: LoadResult): boolean {
  return !r.ok && "stale" in r && r.stale === true;
}

/** Сообщение об успешной загрузке (как legacy `loadTable`, плюс supplier rows). */
export function formatLoadOkMessage(
  shown: number,
  total: number,
  limit: number,
  supplierRows: number,
): string {
  let msg = `OK · в таблице ${shown} строк`;
  if (total > shown) {
    msg += ` из ${total} по фильтру (лимит ответа ${limit}; сузьте поиск/склад или увеличьте лимит)`;
  } else {
    msg += total ? ` (все ${total} по фильтру)` : "";
  }
  msg += ` · supplier строк: ${supplierRows}`;
  return msg;
}
