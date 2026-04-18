import { formatDetailVal, formatInt, formatNum } from "../../utils/forecastFormat.js";

export interface WbExplainCtx {
  forecastDailyDemand: unknown;
  ownStock: unknown;
  systemAvailable: unknown;
  /** Снимок стока WB: на складе (режим складов) или Σ по сети (агрегаты). */
  wbStockOnHand?: unknown;
  /** Поставки в горизонте (incoming), уже запланированные. */
  wbIncomingUnits?: unknown;
}

/** Клиентский explain «На WB» — та же логика, что `htmlWbReplenishExplain` в legacy. */
export function WbReplenishExplain(rep: unknown, ctx: WbExplainCtx) {
  if (!rep || typeof rep !== "object") return null;
  const r = rep as Record<string, unknown>;
  const fd = Number(ctx.forecastDailyDemand);
  const tc = Number(r.targetCoverageDays);
  if (!Number.isFinite(fd) || !Number.isFinite(tc) || tc <= 0) return null;
  const target = Number(r.targetDemandWB);
  const wbSum = Number(r.wbAvailableTotal);
  const rawGap = target - wbSum;
  const rec = Number(r.recommendedToWB);
  const ownNum = Number(ctx.ownStock);

  const stockN = Number(ctx.wbStockOnHand);
  const incN = Number(ctx.wbIncomingUnits);
  const hasSplit =
    ctx.wbStockOnHand !== undefined &&
    ctx.wbIncomingUnits !== undefined &&
    Number.isFinite(stockN) &&
    Number.isFinite(incN);

  const interpret =
    rec > 0 ? (
      <div class="explain-callout explain-warning" role="status">
        <strong>⚠️ Не хватает товара на WB.</strong> Нужно довезти <strong>{formatInt(rec)}</strong>{" "}
        шт. Это покрывает <strong>{formatDetailVal(tc)}</strong> дн. при текущем спросе/день.
      </div>
    ) : (
      <div class="explain-callout explain-success" role="status">
        ✅ Запаса на WB достаточно для целевого покрытия.
      </div>
    );

  const ownNote =
    Number.isFinite(ownNum) && ownNum > 0 ? (
      <p class="explain-own-note explain-muted">
        <strong>Важно:</strong> в расчёте «На WB» учитывается только запас на WB. Наш склад (ownStock)
        не влияет на эту рекомендацию.
      </p>
    ) : null;

  const incomingHint = (
    <p class="metric-incoming-hint explain-muted">
      «В пути» — поставки в горизонте симуляции, уже учтённые в доступном количестве; это не текущий
      остаток на полке.
    </p>
  );

  return (
    <section class="detail-explain detail-explain-wb" aria-label="Расчёт рекомендации На WB">
      <div class="detail-explain-title">
        Расчёт «На WB» · <span class="explain-table-ref">колонка «На WB»</span>
      </div>
      {interpret}
      <div
        class="explain-result explain-result-itog"
        title="Та же цифра, что в колонке «На WB» основной таблицы"
      >
        <span class="explain-itog-label">ИТОГ:</span> На WB →{" "}
        <strong class="explain-result-num">{formatInt(rec)}</strong> шт.
      </div>
      <p class="explain-formula">
        recommendedToWB = max(0, ceil(forecastDailyDemand × targetCoverageDays − wbAvailableTotal))
      </p>
      <ol class="explain-steps">
        <li>
          <span class="explain-k">Спрос/день</span> — <strong>{formatNum(fd)}</strong>
        </li>
        <li>
          <span class="explain-k">Целевое покрытие</span> — <strong>{formatDetailVal(tc)}</strong> дн.
        </li>
        <li>
          <span class="explain-k">Нужно на WB (цель)</span> — {formatNum(fd)} × {formatDetailVal(tc)} ={" "}
          <strong>{formatNum(target)}</strong> шт.
        </li>
        {hasSplit ? (
          <>
            <li>
              <span class="explain-k">Сток на WB</span> — <strong>{formatInt(stockN)}</strong> шт. (снимок
              на складе или Σ по сети)
            </li>
            <li>
              <span class="explain-k">В пути (incoming)</span> —{" "}
              <strong class="metric-incoming">{formatInt(incN)}</strong> шт.
            </li>
            <li>
              <span class="explain-k">Уже доступно на WB (цель формулы)</span> — сток + в пути ={" "}
              <strong>{formatInt(wbSum)}</strong> шт. (= wbAvailableTotal)
            </li>
            {incomingHint}
          </>
        ) : (
          <li>
            <span class="explain-k">Уже на WB по сети</span> — <strong>{formatInt(wbSum)}</strong> шт.
            (wbAvailableTotal = сток + в пути; детализация недоступна в этом ответе)
          </li>
        )}
        <li>
          <span class="explain-k">Разрыв до цели</span> — {formatNum(target)} − {formatInt(wbSum)} ={" "}
          {formatNum(rawGap)} → округление вверх при необходимости
        </li>
      </ol>
      {ownNote}
    </section>
  );
}
