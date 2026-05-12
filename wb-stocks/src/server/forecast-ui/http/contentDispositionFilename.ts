/**
 * `Content-Disposition` allows ONLY printable US-ASCII (and a small subset of
 * tspecials) directly in the `filename=` parameter — Node enforces this and
 * throws `ERR_INVALID_CHAR` for anything else. Cyrillic / emoji etc. must
 * either be stripped from the legacy `filename=` value or carried in the
 * RFC 5987 `filename*=UTF-8''<percent-encoded>` parameter, which all modern
 * browsers honor when present.
 *
 * Эта вспомогательная функция собирает корректный header под произвольное
 * имя файла; используется в `sendXlsxAttachment` (раньше — `sendCsvAttachment`).
 */
export function buildContentDisposition(
  filename: string,
  fallback: string,
): string {
  const asciiName = asciiFallbackFilename(filename, fallback);
  // `filename*` обязателен только если имя содержит не-ASCII; добавляем
  // его всегда, когда оригинал отличается от ASCII-fallback'а — так клиенты,
  // которые понимают RFC 5987, увидят настоящее имя, а старые fallback'нутся.
  if (asciiName === filename) {
    return `attachment; filename="${asciiName}"`;
  }
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}

function asciiFallbackFilename(filename: string, fallback: string): string {
  // Заменяем всё, что не ASCII (или зарезервированные для заголовка
  // `"`, `\`) на `_`, остальное оставляем как есть. Полностью пустую
  // строку (например, имя из одних только не-ASCII символов) откатываем
  // на `fallback`, чтобы не получить `filename=""`.
  const safe = filename
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_")
    .trim();
  return safe.length > 0 ? safe : fallback;
}
