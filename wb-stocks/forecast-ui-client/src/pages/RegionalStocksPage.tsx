import type { JSX } from "preact";
import { useCallback, useMemo, useState } from "preact/hooks";
import {
  downloadForecastCsv,
  fetchRegionalStocks,
  ForecastApiError,
} from "../api/client.js";
import type { RegionalStocksResponse } from "../api/types.js";
import { FORECAST_UI_SPA_ROUTES } from "../routes.js";
import { defaultFormState, formStateFromSearchParams } from "../state/urlState.js";
import {
  WB_MACRO_REGION_CLUSTERS,
} from "../../../src/domain/wbWarehouseMacroRegion.js";
import { listLiveWarehousesForMacroRegion } from "../utils/wbWarehouseRegion.js";
import {
  badgeClass,
  formatInt,
  formatNum,
  riskLabelWbTotal,
} from "../utils/forecastFormat.js";
import { HelpToggle } from "../components/HelpToggle.js";
import { LabelWithInlineHelp } from "../components/hints/index.js";

type RiskFilter = "all" | "lt7" | "lt14" | "lt30" | "lt45" | "lt60";
type TargetCoverage = "14" | "30" | "42" | "60";

interface RegionalStocksForm {
  horizonDays: string;
  macroRegion: string;
  targetCoverageDays: TargetCoverage;
  riskStockout: RiskFilter;
  q: string;
}

const MACRO_REGION_OPTIONS = Array.from(
  new Set(WB_MACRO_REGION_CLUSTERS.flatMap((c) => c.macroRegions)),
);

function initForm(): RegionalStocksForm {
  const base =
    typeof window === "undefined"
      ? defaultFormState()
      : formStateFromSearchParams(new URLSearchParams(window.location.search));
  const params =
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);
  const macro = params.get("macroRegion")?.trim();
  const target = params.get("targetCoverageDays")?.trim();
  const incomingDays = params.get("horizonDays")?.trim();
  return {
    horizonDays:
      incomingDays === "5" || incomingDays === "10" || incomingDays === "20"
        ? incomingDays
        : "10",
    macroRegion:
      macro && MACRO_REGION_OPTIONS.includes(macro) ? macro : "Центральный",
    targetCoverageDays:
      target === "14" ||
      target === "30" ||
      target === "42" ||
      target === "60"
        ? target
        : "42",
    riskStockout:
      base.riskStockout === "lt7" ||
      base.riskStockout === "lt14" ||
      base.riskStockout === "lt30" ||
      base.riskStockout === "lt45" ||
      base.riskStockout === "lt60"
        ? base.riskStockout
        : "all",
    q: base.q,
  };
}

function buildSearchParams(form: RegionalStocksForm): URLSearchParams {
  // snapshotDate здесь не выставляем намеренно: страница "Запасы WB по
  // региону" принципиально работает только со свежим срезом, сервер сам
  // резолвит MAX(snapshot_date).
  const p = new URLSearchParams();
  p.set("horizonDays", form.horizonDays);
  p.set("macroRegion", form.macroRegion);
  p.set("targetCoverageDays", form.targetCoverageDays);
  p.set("riskStockout", form.riskStockout);
  p.set("limit", "500");
  if (form.q.trim()) p.set("q", form.q.trim());
  return p;
}

function summaryCell(label: string, value: string | number, cls = ""): JSX.Element {
  return (
    <div class="cell">
      <span class="muted">{label}</span>
      <strong class={cls || undefined}>{value}</strong>
    </div>
  );
}

export function RegionalStocksPage(): JSX.Element {
  const [form, setForm] = useState<RegionalStocksForm>(initForm);
  const [data, setData] = useState<RegionalStocksResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sp = useMemo(() => buildSearchParams(form), [form]);

  const patch = (p: Partial<RegionalStocksForm>) => {
    setForm((f) => ({ ...f, ...p }));
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRegionalStocks(sp);
      setData(res);
    } catch (e) {
      setData(null);
      setError(
        e instanceof ForecastApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setLoading(false);
    }
  }, [sp]);

  const exportCsv = useCallback(async () => {
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams(sp);
      // Сервер уже фильтрует по recommendedOrderQty > 0, лимит UI здесь
      // не нужен — экспортируем все позиции к заказу.
      params.delete("limit");
      const qs = params.toString();
      // Если ответа ещё нет (теоретически — кнопка disabled, но на всякий
      // случай) — пишем "latest", соответствующее поведение сервера.
      const datePart = data?.snapshotDate ?? "latest";
      await downloadForecastCsv(
        `/api/forecast/export-regional-stocks${qs ? `?${qs}` : ""}`,
        undefined,
        `regional-stocks-${form.macroRegion}-${datePart}-h${form.horizonDays}.csv`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }, [data?.snapshotDate, form.horizonDays, form.macroRegion, sp]);

  const summary = data?.summary;
  const orderableRowCount = useMemo(
    () => data?.rows.filter((r) => r.recommendedOrderQty > 0).length ?? 0,
    [data],
  );

  // Справочно: склады, которые входят в выбранный макрорегион и реально
  // участвуют в "Доступно в регионе" (зеркало фильтра отчёта). Считаем
  // на клиенте по статическому реестру — без round-trip на сервер.
  const regionWarehouses = useMemo(
    () => listLiveWarehousesForMacroRegion(form.macroRegion),
    [form.macroRegion],
  );

  return (
    <div class="forecast-next-root regional-stocks-page">
      <header class="top">
        <h1>Запасы WB по региону</h1>
        <p class="muted">
          <a href={FORECAST_UI_SPA_ROUTES.home}>← К прогнозу</a>
          {" · "}
          <a href={FORECAST_UI_SPA_ROUTES.redistribution}>Перераспределение</a>
          {" · "}
          <a href={FORECAST_UI_SPA_ROUTES.regionalDemandDiagnostics}>Регион vs fulfillment</a>
        </p>
      </header>

      <section class="panel regional-stocks-controls">
        <div class="regional-stocks-controls-grid">
          <div class="regional-stocks-row">
            <label class="regional-stocks-region-field">
              Регион для оценки
              <select
                value={form.macroRegion}
                onChange={(e) =>
                  patch({ macroRegion: (e.target as HTMLSelectElement).value })
                }
              >
                {MACRO_REGION_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <small
                class="regional-stocks-warehouse-hint muted"
                title="Эти склады входят в выбранный макрорегион и учитываются в столбце «Доступно в регионе» (виртуальные склады исключены, как и в самом отчёте)"
              >
                {regionWarehouses.length > 0 ? (
                  <>
                    <span class="regional-stocks-warehouse-hint-label">
                      Склады региона ({regionWarehouses.length}):
                    </span>{" "}
                    {regionWarehouses
                      .map((w) =>
                        w.isSortingCenter
                          ? `${w.displayName} (СЦ)`
                          : w.displayName,
                      )
                      .join(", ")}
                  </>
                ) : (
                  "Склады не найдены"
                )}
              </small>
            </label>
          </div>
          <div class="regional-stocks-row">
            <label>
              <LabelWithInlineHelp>
                В пути за
                <HelpToggle label="В пути за">
                  Горизонт учёта входящих WB-поставок: сколько дней вперёд от
                  даты среза суммируем единицы со статусами «создана / в пути
                  / приёмка». Влияет на колонку «Доступно в регионе».
                </HelpToggle>
              </LabelWithInlineHelp>
              <select
                value={form.horizonDays}
                onChange={(e) =>
                  patch({ horizonDays: (e.target as HTMLSelectElement).value })
                }
              >
                <option value="5">5 дн.</option>
                <option value="10">10 дн.</option>
                <option value="20">20 дн.</option>
              </select>
            </label>
            <label>
              <LabelWithInlineHelp>
                Цель
                <HelpToggle label="Цель">
                  Целевое покрытие региона в днях. Колонка «Нужно» = max(0,
                  цель × «Спрос/день» − «Доступно в регионе»); от неё же
                  зависит «Заказ» = min(Нужно, Склад).
                </HelpToggle>
              </LabelWithInlineHelp>
              <select
                value={form.targetCoverageDays}
                onChange={(e) =>
                  patch({
                    targetCoverageDays: (e.target as HTMLSelectElement)
                      .value as TargetCoverage,
                  })
                }
              >
                <option value="14">14 дн.</option>
                <option value="30">30 дн.</option>
                <option value="42">42 дн.</option>
                <option value="60">60 дн.</option>
              </select>
            </label>
            <label>
              <LabelWithInlineHelp>
                Риск
                <HelpToggle label="Риск">
                  Фильтр строк по бакету «дней запаса» в регионе: оставляет
                  только SKU «хуже» выбранного порога. На расчёт не влияет —
                  только видимость строк в таблице.
                </HelpToggle>
              </LabelWithInlineHelp>
              <select
                value={form.riskStockout}
                onChange={(e) =>
                  patch({
                    riskStockout: (e.target as HTMLSelectElement).value as RiskFilter,
                  })
                }
              >
                <option value="all">Все</option>
                <option value="lt7">&lt; 7 дн.</option>
                <option value="lt14">&lt; 14 дн.</option>
                <option value="lt30">&lt; 30 дн.</option>
                <option value="lt45">&lt; 45 дн.</option>
                <option value="lt60">&lt; 60 дн.</option>
              </select>
            </label>
            <label class="regional-stocks-search">
              Поиск
              <input
                type="search"
                placeholder="nm_id, артикул…"
                value={form.q}
                onInput={(e) => patch({ q: (e.target as HTMLInputElement).value })}
              />
            </label>
            <button
              type="button"
              class="btn-load primary"
              disabled={loading}
              onClick={() => void load()}
            >
              {loading ? "Загрузка…" : "Загрузить"}
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <p class="forecast-next-error" role="alert">
          {error}
        </p>
      ) : null}

      {summary ? (
        <section class="panel regional-stocks-summary">
          <h2>Сводка региона</h2>
          <div class="summary-grid summary-grid-operational">
            {summaryCell("Строк SKU", summary.totalRows)}
            {summaryCell("< 7 дн.", summary.risk.critical, "risk-critical")}
            {summaryCell("< 14 дн.", summary.risk.warning, "risk-warning")}
            {summaryCell("< 30 дн.", summary.risk.attention, "risk-attention")}
            {summaryCell("OK ≥30", summary.risk.ok, "risk-ok")}
            {summaryCell(
              "Нужно в регион",
              formatInt(summary.recommendedToRegionTotal),
            )}
            {summaryCell(
              `Склад «${data?.ownWarehouseCode ?? "main"}»`,
              formatInt(summary.ownWarehouseStockTotal),
            )}
            {summaryCell(
              "Заказ (min Нужно/Склад)",
              formatInt(summary.recommendedOrderQtyTotal),
            )}
          </div>
        </section>
      ) : null}

      {data ? (
        <section class="panel regional-stocks-table-panel">
          <div class="regional-stocks-table-header">
            <h2>
              {data.macroRegion} · срез {data.snapshotDate} · цель{" "}
              {data.targetCoverageDays} дн.
            </h2>
            <div class="regional-stocks-table-actions">
              <span class="muted regional-stocks-export-hint">
                {orderableRowCount > 0
                  ? `К заказу: ${orderableRowCount} ${
                      orderableRowCount === 1 ? "позиция" : "позиций"
                    }`
                  : "Нет позиций к заказу"}
              </span>
              <button
                type="button"
                class="btn-load"
                disabled={exporting || orderableRowCount === 0}
                onClick={() => void exportCsv()}
                title="Экспортировать в CSV только позиции с ненулевым «Заказ»"
              >
                {exporting ? "Экспорт…" : "Экспорт в CSV"}
              </button>
            </div>
          </div>
          {data.rows.length ? (
            <div class="table-wrap">
              <table class="regional-stocks-table">
                <thead>
                  <tr>
                    <th>Риск</th>
                    <th>vendor</th>
                    <th>nm_id</th>
                    <th>Размер</th>
                    <th>Доступно в регионе</th>
                    <th>Спрос/день</th>
                    <th>Дней запаса</th>
                    <th>OOS</th>
                    <th title="Сколько единиц нужно довезти в регион, чтобы закрыть целевое покрытие">
                      Нужно
                    </th>
                    <th title={`Остаток на нашем складе «${data.ownWarehouseCode}» по vendor_code`}>
                      Склад
                    </th>
                    <th title="Заказ = min(Нужно, Склад) — сколько реально можно отгрузить под потребность региона">
                      Заказ
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={`${r.nmId}-${r.techSize}`}>
                      <td class="risk-cell">
                        <span class={`badge ${badgeClass(r.risk)}`}>
                          {riskLabelWbTotal(r.risk)}
                        </span>
                      </td>
                      <td>{r.vendorCode ?? ""}</td>
                      <td>{r.nmId}</td>
                      <td>{r.techSize}</td>
                      <td title="Остаток WB на складах региона + поставки в пути в выбранном горизонте">
                        {formatInt(r.regionalAvailable)}
                      </td>
                      <td>{formatNum(r.regionalForecastDailyDemand)}</td>
                      <td>{formatNum(r.daysOfStockRegional)}</td>
                      <td>{r.stockoutDateEstimate ?? ""}</td>
                      <td>{formatInt(r.recommendedToRegion)}</td>
                      <td>{formatInt(r.ownWarehouseStock)}</td>
                      <td class={r.recommendedOrderQty > 0 ? "regional-stocks-order-cell" : undefined}>
                        {formatInt(r.recommendedOrderQty)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div class="main-table-empty">
              <p class="table-empty-title">Нет строк по текущим фильтрам</p>
              <p class="muted table-empty-hint">
                Попробуйте выбрать другой регион, снять фильтр риска или проверить дату среза.
              </p>
            </div>
          )}
        </section>
      ) : null}

      <style>{`
        .regional-stocks-page .regional-stocks-controls-grid {
          display: flex;
          flex-direction: column;
          gap: 0.65rem 1rem;
        }
        .regional-stocks-page .regional-stocks-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.65rem 1rem;
          align-items: flex-end;
        }
        .regional-stocks-page .regional-stocks-controls-grid label {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          font-size: 0.85rem;
        }
        .regional-stocks-page .regional-stocks-search {
          min-width: 14rem;
        }
        .regional-stocks-page .regional-stocks-region-field {
          min-width: 16rem;
          flex: 1 1 100%;
          font-weight: 700;
        }
        .regional-stocks-page .regional-stocks-region-field select {
          min-height: 2.35rem;
          font-weight: 650;
        }
        .regional-stocks-page .regional-stocks-warehouse-hint {
          display: block;
          margin-top: 0.35rem;
          font-size: 0.78rem;
          font-weight: 400;
          line-height: 1.35;
          word-break: break-word;
        }
        .regional-stocks-page .regional-stocks-warehouse-hint-label {
          font-weight: 600;
        }
        .regional-stocks-page .regional-stocks-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.84rem;
        }
        .regional-stocks-page .regional-stocks-table th,
        .regional-stocks-page .regional-stocks-table td {
          padding: 0.42rem 0.5rem;
          text-align: left;
          border-bottom: 1px solid rgba(0,0,0,0.08);
          white-space: nowrap;
        }
        .regional-stocks-page .regional-stocks-table th:nth-child(2),
        .regional-stocks-page .regional-stocks-table td:nth-child(2) {
          white-space: normal;
          min-width: 8rem;
        }
        .regional-stocks-page .regional-stocks-table-header {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 0.6rem 1rem;
          margin-bottom: 0.4rem;
        }
        .regional-stocks-page .regional-stocks-table-header h2 {
          margin: 0;
        }
        .regional-stocks-page .regional-stocks-table-actions {
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }
        .regional-stocks-page .regional-stocks-export-hint {
          font-size: 0.82rem;
        }
        .regional-stocks-page .regional-stocks-order-cell {
          font-weight: 650;
        }
      `}</style>
    </div>
  );
}
