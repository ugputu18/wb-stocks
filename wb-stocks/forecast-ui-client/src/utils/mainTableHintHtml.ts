import { normalizeRowsViewMode } from "./viewMode.js";

export function mainTableHintHtml(
  viewMode: ReturnType<typeof normalizeRowsViewMode>,
): string {
  if (viewMode === "wbWarehouses") {
    return (
      "Режим <strong>по складам WB</strong>: строка = склад × SKU. System = все WB + наш склад; WB ∑ = сумма по сети; WB лок. = доступно на складе (сток + в пути); колонки <strong>Сток</strong> и <strong>В пути</strong> раскладывают локальный запас. S/W/L — риск по уровням. " +
      "Колонка «На WB» — довоз с учётом network-запаса; закупка у производителя — в таблице ниже."
    );
  }
  if (viewMode === "systemTotal") {
    return (
      "<strong>Запасы в целом</strong> — одна строка на SKU: пул <strong>system = WB по сети + наш склад (own)</strong>. Риск и фильтр «Дней запаса» считаются по <strong>дням system</strong> (не путать с режимом «WB в целом», где риск только по WB). " +
      "<strong>WB ∑</strong> = сток + в пути по сети; колонки <strong>Сток WB</strong> / <strong>В пути</strong> показывают вклад. Колонки «Заказать» / «Заказ (LT)» совпадают по смыслу с таблицей закупки ниже. Сортировка: <strong>daysOfStockSystem</strong> ↑."
    );
  }
  return (
    "Режим <strong>WB в целом</strong> — одна строка на SKU по сети; <strong>WB ∑</strong> = сток + в пути (сеть); см. колонки <strong>Сток WB</strong> и <strong>В пути</strong>. Клик по <strong>vendor / nm_id / размеру</strong> или кнопка <strong>«По складам»</strong> переключает вид на склады с фильтром по SKU (<code>q</code> + <code>techSize</code>). " +
    "Сортировка: <strong>daysOfStockWB</strong> ↑, затем <strong>forecastDailyDemandTotal</strong> ↓."
  );
}
