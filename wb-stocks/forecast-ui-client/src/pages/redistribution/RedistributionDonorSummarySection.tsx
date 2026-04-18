import type { JSX } from "preact";
import { formatInt, formatNum } from "../../utils/forecastFormat.js";
import { formatWarehouseRegionFirst } from "../../utils/wbWarehouseRegion.js";
import type { DonorWarehouseSummary } from "../../utils/donorWarehouseSummary.js";

export type RedistributionDonorSummarySectionProps = {
  donorSummaryLoading: boolean;
  donorSummaryError: string | null;
  donorSummary: DonorWarehouseSummary | null;
};

export function RedistributionDonorSummarySection(
  props: RedistributionDonorSummarySectionProps,
): JSX.Element {
  const { donorSummaryLoading, donorSummaryError, donorSummary } = props;

  return (
    <section class="panel redistribution-donor-summary" aria-live="polite">
      <h2>Сводка по складу-донору</h2>
      <p class="muted redistribution-donor-summary-lede">
        Для проверки доверия к расчёту: суммы по строкам ответа API для выбранного склада. «Дней
        покрытия» по складу — это <strong>Σ локальный остаток / Σ спрос в день</strong> (не min/max по
        SKU).
      </p>
      {donorSummaryLoading ? (
        <p class="muted">Загрузка сводки…</p>
      ) : donorSummaryError ? (
        <p class="forecast-next-error" role="alert">
          {donorSummaryError}
        </p>
      ) : donorSummary ? (
        <dl class="redistribution-donor-summary-grid">
          <div>
            <dt>Склад</dt>
            <dd>
              <strong>
                {formatWarehouseRegionFirst(
                  donorSummary.warehouseNameRaw,
                  donorSummary.warehouseKey,
                )}
              </strong>
              <span class="muted wb-redistribution-key"> {donorSummary.warehouseKey}</span>
            </dd>
          </div>
          <div>
            <dt>Σ локальный остаток</dt>
            <dd>{formatInt(donorSummary.totalLocalStock)} шт.</dd>
          </div>
          <div>
            <dt>Σ спрос/день</dt>
            <dd>{formatNum(donorSummary.totalForecastDailyDemand)}</dd>
          </div>
          <div>
            <dt>Дней покрытия (оценка)</dt>
            <dd>
              {donorSummary.aggregatedDaysOfCoverage === null
                ? "—"
                : formatNum(donorSummary.aggregatedDaysOfCoverage)}
            </dd>
          </div>
          <div>
            <dt>SKU с излишком (≥ мин. передачи)</dt>
            <dd>{formatInt(donorSummary.skuWithTransferableSurplusCount)}</dd>
          </div>
          <div>
            <dt>Строк в срезе</dt>
            <dd>{formatInt(donorSummary.lineCount)}</dd>
          </div>
        </dl>
      ) : (
        <p class="muted">Нет данных для сводки.</p>
      )}
    </section>
  );
}
