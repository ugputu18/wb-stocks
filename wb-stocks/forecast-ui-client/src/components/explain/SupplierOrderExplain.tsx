import type { JSX } from "preact";
import { formatDetailVal, formatInt, formatNum } from "../../utils/forecastFormat.js";

/** Клиентский explain закупки — та же логика, что `htmlSupplierOrderExplain` в legacy. */
export function SupplierOrderExplain({ row: s }: { row: Record<string, unknown> }) {
  const d = Number(s.systemDailyDemand);
  const lt = Number(s.leadTimeDays);
  const cov = Number(s.orderCoverageDays);
  const safe = Number(s.safetyDays ?? 0);
  const wb = Number(s.wbAvailableTotal);
  const own = Number(s.ownStock);
  const sysNow = Number(s.systemAvailable);
  const wbStock = Number(s.wbStartStockTotal);
  const wbInc = Number(s.wbIncomingUnitsTotal);
  const hasWbSplit =
    s.wbStartStockTotal !== undefined &&
    s.wbIncomingUnitsTotal !== undefined &&
    Number.isFinite(wbStock) &&
    Number.isFinite(wbInc);
  const cons = d * lt;
  const stockArr = Number(s.stockAtArrival);
  const reqAfter = d * (cov + safe);
  const gap = reqAfter - stockArr;
  const stockout = Boolean(s.willStockoutBeforeArrival);
  const covLabel = cov;
  const daysX = s.daysUntilStockout;
  const xOk = daysX != null && Number.isFinite(Number(daysX));
  const xNum = xOk ? Number(daysX) : null;

  let interpretLead: JSX.Element;
  if (stockout) {
    let extra: JSX.Element | string = "";
    if (xOk && Number.isFinite(lt)) {
      const deficitD = lt - (xNum as number);
      extra = (
        <>
          <br />
          Дефицит: <strong>{formatNum(deficitD)}</strong> дн. (разница срока поставки{" "}
          <strong>{formatNum(lt)}</strong> дн. и запаса <strong>{formatNum(xNum)}</strong> дн.).
        </>
      );
    } else if (!xOk) {
      extra = (
        <>
          <br />
          Оценка дней до OOS недоступна (нулевой спрос или нет данных).
        </>
      );
    }
    interpretLead = (
      <div class="explain-callout explain-warning" role="status">
        <strong>⚠️ Дефицит до прихода поставки</strong>
        <br />
        Запас закончится через <strong>{xOk ? formatNum(xNum) : "—"}</strong> дн., поставка через{" "}
        <strong>{formatNum(lt)}</strong> дн.{extra}
      </div>
    );
  } else {
    interpretLead = (
      <div class="explain-callout explain-success" role="status">
        ✅ Запаса хватит до прихода поставки
      </div>
    );
  }

  return (
    <section class="detail-explain detail-explain-supplier" aria-label="Расчёт заказа у поставщика">
      <div class="detail-explain-title">
        Закупка у поставщика ·{" "}
        <span class="explain-table-ref">колонки «Заказать» и «Заказ (LT)»</span>
      </div>
      {hasWbSplit ? (
        <p class="explain-muted">
          WB по сети: сток <strong>{formatInt(wbStock)}</strong> + в пути{" "}
          <strong class="metric-incoming">{formatInt(wbInc)}</strong> = доступно{" "}
          <strong>{formatInt(wb)}</strong> (wbAvailableTotal)
        </p>
      ) : null}
      {interpretLead}
      <div
        class="explain-result explain-result-itog explain-result-supplier"
        title="Колонка «Заказать» в таблице закупки ниже"
      >
        <span class="explain-itog-label">ИТОГ:</span> Заказать →{" "}
        <strong class="explain-result-num">{formatInt(s.recommendedFromSupplier)}</strong> шт.
      </div>
      <div
        class="explain-result explain-result-itog explain-result-supplier explain-result-supplier-secondary"
        title="Колонка «Заказ (LT)» — план с lead time и покрытием после прихода"
      >
        <span class="explain-itog-label">ИТОГ:</span> Заказ (LT) →{" "}
        <strong class="explain-result-num">{formatInt(s.recommendedOrderQty)}</strong> шт.
      </div>
      <p class="explain-formula">
        consumptionDuringLeadTime = systemDailyDemand × leadTimeDays; stockAtArrival =
        systemAvailableNow − consumptionDuringLeadTime; requiredAfterArrival = systemDailyDemand ×
        (coverageDays + safetyDays); recommendedOrderQty = max(0, ceil(requiredAfterArrival −
        stockAtArrival))
      </p>
      <dl class="explain-inputs">
        <dt>Входы</dt>
        <dd>
          systemDailyDemand {formatNum(d)} · leadTime {formatDetailVal(lt)} д · coverageDays{" "}
          {formatDetailVal(covLabel)} · safetyDays {formatDetailVal(safe)} · WB∑ {formatInt(wb)}
          {hasWbSplit ? (
            <>
              {" "}
              (сток {formatInt(wbStock)} + в пути {formatInt(wbInc)}){" "}
            </>
          ) : null}
          · ownStock {formatInt(own)} · systemAvailableNow {formatInt(sysNow)}
        </dd>
      </dl>
      <ol class="explain-steps">
        <li>
          <span class="explain-k">Списание за lead time</span> — {formatNum(d)} ×{" "}
          {formatDetailVal(lt)} = <strong>{formatNum(cons)}</strong> шт. «сгорит» до прихода
        </li>
        <li>
          <span class="explain-k">На момент прихода</span> — systemAvailableNow − списание ={" "}
          {formatInt(sysNow)} − {formatNum(cons)} = <strong>{formatNum(stockArr)}</strong>{" "}
          (stockAtArrival)
        </li>
        <li class={stockout ? "explain-warn" : undefined}>
          <span class="explain-k">До прихода хватит?</span> —{" "}
          {stockout ? (
            <strong>
              Нет — запас к приходу отрицательный (риск обрыва на линии WB).
            </strong>
          ) : (
            "Да, остаток при приходе ≥ 0."
          )}
        </li>
        <li>
          <span class="explain-k">Нужно после прихода</span> — {formatNum(d)} × (
          {formatDetailVal(covLabel)} + {formatDetailVal(safe)}) ={" "}
          <strong>{formatNum(reqAfter)}</strong> шт.
        </li>
        <li>
          <span class="explain-k">Разрыв до цели после прихода</span> — {formatNum(reqAfter)} −{" "}
          {formatNum(stockArr)} = {formatNum(gap)}
        </li>
      </ol>
      <p class="explain-muted explain-supplier-foot">
        «Заказать» — простая рекомендация по targetCoverage; «Заказ (LT)» — учёт lead time и цели после
        прихода (как в формулах выше).
      </p>
    </section>
  );
}
