import type { JSX } from "preact";
import type { ForecastUrlFormState } from "../../state/urlState.js";
import type { RankingMode } from "../../utils/wbRedistributionDonorModel.js";
import { formatInt } from "../../utils/forecastFormat.js";
import {
  formatWarehouseRegionFirst,
} from "../../utils/wbWarehouseRegion.js";
import { WB_WAREHOUSE_STATS_BUTTON_TITLE } from "./redistributionConstants.js";
import type { WarehouseOptionStats } from "./redistributionTypes.js";

export type RedistributionControlsSectionProps = {
  form: ForecastUrlFormState;
  patch: (p: Partial<ForecastUrlFormState>) => void;
  apiToken: string;
  setApiToken: (v: string) => void;
  donorKey: string;
  setDonorKey: (v: string) => void;
  loading: boolean;
  donorSelectKeys: string[];
  warehouseStats: Map<string, WarehouseOptionStats>;
  statsLoading: boolean;
  loadWarehouseStats: () => void | Promise<void>;
  warehouseStatsAgeLabel: string | null;
  warehouseKeys: string[];
  reserveDaysStr: string;
  setReserveDaysStr: (v: string) => void;
  minTransferableStr: string;
  setMinTransferableStr: (v: string) => void;
  maxSkuNetworksStr: string;
  setMaxSkuNetworksStr: (v: string) => void;
  rankingMode: RankingMode;
  setRankingMode: (v: RankingMode) => void;
  runSearch: () => void | Promise<void>;
};

export function RedistributionControlsSection(props: RedistributionControlsSectionProps): JSX.Element {
  const {
    form,
    patch,
    apiToken,
    setApiToken,
    donorKey,
    setDonorKey,
    loading,
    donorSelectKeys,
    warehouseStats,
    statsLoading,
    loadWarehouseStats,
    warehouseStatsAgeLabel,
    warehouseKeys,
    reserveDaysStr,
    setReserveDaysStr,
    minTransferableStr,
    setMinTransferableStr,
    maxSkuNetworksStr,
    setMaxSkuNetworksStr,
    rankingMode,
    setRankingMode,
    runSearch,
  } = props;

  return (
    <section class="panel redistribution-controls">
      <h2>Параметры</h2>
      <div class="redistribution-controls-grid">
        <label>
          Bearer (FORECAST_UI_TOKEN)
          <input
            type="password"
            value={apiToken}
            onInput={(e) => setApiToken((e.target as HTMLInputElement).value)}
            placeholder="если требуется сервером"
            autoComplete="off"
          />
        </label>
        <label>
          Дата среза
          <input
            type="date"
            value={form.snapshotDate}
            onInput={(e) => patch({ snapshotDate: (e.target as HTMLInputElement).value })}
          />
        </label>
        <label>
          Горизонт (дн.)
          <select
            value={form.horizonDays}
            onChange={(e) => patch({ horizonDays: (e.target as HTMLSelectElement).value })}
          >
            <option value="30">30</option>
            <option value="60">60</option>
            <option value="90">90</option>
          </select>
        </label>
        <label>
          Целевое покрытие (дней)
          <select
            value={form.targetCoverageDays}
            onChange={(e) =>
              patch({ targetCoverageDays: (e.target as HTMLSelectElement).value })
            }
          >
            <option value="30">30</option>
            <option value="45">45</option>
            <option value="60">60</option>
          </select>
        </label>
        <label>
          Лимит строк (донор)
          <select
            value={form.rowLimit}
            onChange={(e) => patch({ rowLimit: (e.target as HTMLSelectElement).value })}
          >
            <option value="250">250</option>
            <option value="500">500</option>
            <option value="1000">1000</option>
            <option value="2000">2000</option>
          </select>
        </label>
      </div>

      <div class="redistribution-controls-grid redistribution-donor-row">
        <label class="redistribution-donor-select">
          Склад-донор
          <select
            value={donorKey}
            onChange={(e) => setDonorKey((e.target as HTMLSelectElement).value)}
            disabled={loading}
          >
            <option value="">— выберите склад —</option>
            {donorSelectKeys.map((k) => {
              const st = warehouseStats.get(k);
              const label = st
                ? `${formatWarehouseRegionFirst(st.displayName, k)} · Σ ${formatInt(st.totalLocal)} · ${st.skuCount} SKU`
                : formatWarehouseRegionFirst(k, k);
              return (
                <option key={k} value={k}>
                  {label}
                </option>
              );
            })}
          </select>
        </label>
        <label>
          Резерв донора (дней)
          <input
            type="number"
            min={0}
            step={1}
            value={reserveDaysStr}
            onInput={(e) => setReserveDaysStr((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          Мин. передаваемых шт.
          <input
            type="number"
            min={0}
            step={1}
            value={minTransferableStr}
            onInput={(e) => setMinTransferableStr((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          Макс. SKU (сети для загрузки)
          <input
            type="number"
            min={1}
            step={1}
            value={maxSkuNetworksStr}
            disabled={loading}
            onInput={(e) => setMaxSkuNetworksStr((e.target as HTMLInputElement).value)}
          />
          <span class="muted redistribution-field-hint">
            Только топ SKU по излишку на доноре; уменьшает число запросов к API.
          </span>
        </label>
        <label class="redistribution-ranking-select">
          Ranking (сортировка)
          <select
            value={rankingMode}
            onChange={(e) =>
              setRankingMode(
                (e.target as HTMLSelectElement).value === "regional"
                  ? "regional"
                  : "fulfillment",
              )
            }
            disabled={loading}
          >
            <option value="regional">
              Regional — регион заказа покупателя (рекомендуется для перераспределения)
            </option>
            <option value="fulfillment">
              Fulfillment — спрос по текущему складу исполнения
            </option>
          </select>
          <span
            class="muted redistribution-field-hint"
            title="Regional: нехватка = ceil(целевой запас − Σ local в регионе); перевод = min(можно забрать, нехватка); без строк «донор и цель в одном макрорегионе». Fulfillment: цель = склад."
          >
            Подсказка
          </span>
        </label>
      </div>

      <div class="redistribution-actions">
        <button
          type="button"
          class="btn-load primary"
          disabled={loading}
          onClick={() => void runSearch()}
        >
          {loading ? "Считаем…" : "Подобрать перемещения"}
        </button>
        <span class="redistribution-wb-refresh">
          {warehouseStatsAgeLabel && !statsLoading ? (
            <span
              class="muted redistribution-wb-refresh-meta"
              title="Момент последнего ответа сервера по суммам Σ local в списке складов (ваши часы). Данные среза — по дате в поле «Дата среза»."
            >
              Данные обновлены {warehouseStatsAgeLabel}
              <span aria-hidden="true"> · </span>
            </span>
          ) : null}
          <button
            type="button"
            class="btn-load"
            disabled={statsLoading || warehouseKeys.length === 0}
            title={WB_WAREHOUSE_STATS_BUTTON_TITLE}
            onClick={() => void loadWarehouseStats()}
          >
            {statsLoading ? "Обновление данных…" : "Обновить данные WB"}
          </button>
        </span>
      </div>
      {statsLoading ? (
        <p class="muted redistribution-stats-hint" aria-live="polite">
          Загружаем строки прогноза по складам с сервера (суммы Σ local в выпадающем списке). На расчёт
          «Подобрать перемещения» не блокируем.
        </p>
      ) : null}
    </section>
  );
}
