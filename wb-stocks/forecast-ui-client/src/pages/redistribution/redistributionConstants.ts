/** Минимум Σ local по складу, чтобы склад попал в список «Склад-донор». */
export const MIN_DONOR_WAREHOUSE_LOCAL_UNITS = 10;

/** Tooltip для ручного обновления сумм по складам (тот же источник данных, что и «Подобрать перемещения»). */
export const WB_WAREHOUSE_STATS_BUTTON_TITLE =
  "Загрузит актуальные остатки по складам из Wildberries. Влияет на рекомендации по перераспределению.";

export function formatWarehouseStatsAgeRu(fetchedAtMs: number): string {
  const elapsedSec = Math.floor((Date.now() - fetchedAtMs) / 1000);
  if (elapsedSec < 45) return "только что";
  const m = Math.floor(elapsedSec / 60);
  if (m < 60) return `${m} мин. назад`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} ч. назад`;
  const d = Math.floor(h / 24);
  return `${d} дн. назад`;
}
