/**
 * In-memory счётчик обращений к складу без записи в реестре (redistribution read-side).
 */

const unknownWarehouseUsageCounts = new Map<string, number>();

/** Увеличить счётчик по уже нормализованному ключу (каждое срабатывание). */
export function bumpUnknownWarehouseUsage(normalizedKey: string): void {
  if (!normalizedKey || normalizedKey === "<unknown>") return;
  unknownWarehouseUsageCounts.set(normalizedKey, (unknownWarehouseUsageCounts.get(normalizedKey) ?? 0) + 1);
}

/** Снимок: нормализованный ключ → число обращений. */
export function getUnknownWarehouseUsageStats(): ReadonlyMap<string, number> {
  return new Map(unknownWarehouseUsageCounts);
}

/** Сброс (тесты / отладка). */
export function resetUnknownWarehouseUsageStats(): void {
  unknownWarehouseUsageCounts.clear();
}
