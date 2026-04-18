import type { JSX } from "preact";

export function RedistributionMvpLimitsSection(): JSX.Element {
  return (
    <details class="wb-redistribution-mvp redistribution-mvp-page">
      <summary>Ограничения MVP</summary>
      <ul class="muted">
        <li>Эвристический ranking, не solver оптимизации.</li>
        <li>Нет распределения одного остатка донора между несколькими получателями.</li>
        <li>Логистика, сроки и стоимость перемещения не учитываются.</li>
        <li>Решения не сохраняются.</li>
        <li>
          Ограничение «макс. SKU» отсекает длинный хвост по объёму передач — для полного покрытия
          увеличьте лимит или сузьте донор.
        </li>
      </ul>
    </details>
  );
}
