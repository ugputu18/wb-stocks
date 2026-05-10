/** Минимум Σ local по складу, чтобы склад попал в список «Склад-донор». */
export const MIN_DONOR_WAREHOUSE_LOCAL_UNITS = 10;

/**
 * Tooltip для кнопки «Обновить данные WB». После пересборки кнопка реально
 * подтягивает с WB:
 * - текущие остатки по складам (`importWbStocks`),
 * - заказы за окно спроса (30 дней),
 * - пересобирает demand/forecast на выбранную дату среза/горизонт,
 * - обновляет суммы Σ local в выпадающем списке складов.
 */
export const WB_WAREHOUSE_STATS_BUTTON_TITLE =
  "Подтянет с Wildberries свежие остатки по складам и заказы за окно спроса, пересчитает прогноз на выбранную дату/горизонт и обновит суммы по складам.";

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
