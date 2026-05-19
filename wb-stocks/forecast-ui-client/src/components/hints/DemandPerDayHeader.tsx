import type { JSX } from "preact";
import { HelpToggle } from "../HelpToggle.js";

export const FULFILLMENT_DEMAND_PER_DAY_HELP =
  "Считается по заказам WB за 90 дней до даты среза, сам день среза исключён. Берём средние за 7/30/90 дней, сглаживаем как 0.5×7д + 0.3×30д + 0.2×90д; если короткое окно пустое, подставляется ближайшее ненулевое длинное окно. Затем применяется тренд avg7/avg30, ограниченный 0.75–1.25. В колонках с Σ показана сумма по всем складам WB для SKU.";

export const REGIONAL_STOCKS_DEMAND_PER_DAY_HELP =
  "На странице «Запасы» это спрос по регионам покупателей WB, агрегированный по выбранному контуру: выбранный макрорегион или вся сеть WB. Режим WB+наш склад добавляет наш склад только к доступному запасу, не к спросу. Формула та же: заказы за 90 дней до даты среза, средние 7/30/90 дней, сглаживание 0.5×7д + 0.3×30д + 0.2×90д и тренд avg7/avg30, ограниченный 0.75–1.25.";

export function DemandPerDayHeader({
  aggregate = false,
  help = FULFILLMENT_DEMAND_PER_DAY_HELP,
}: {
  aggregate?: boolean;
  help?: string;
}): JSX.Element {
  const label = aggregate ? "Спрос/день Σ" : "Спрос/день";
  return (
    <span class="th-label-with-help">
      {label}
      <HelpToggle label={label}>{help}</HelpToggle>
    </span>
  );
}
