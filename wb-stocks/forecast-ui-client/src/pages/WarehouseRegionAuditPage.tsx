import type { JSX } from "preact";
import { useCallback, useMemo, useState } from "preact/hooks";
import { FORECAST_UI_SPA_ROUTES } from "../routes.js";
import { fetchWarehouseRegionAudit, ForecastApiError } from "../api/client.js";
import type { WarehouseRegionAuditResponse } from "../api/types.js";
import { defaultFormState, formStateFromSearchParams } from "../state/urlState.js";
import { formatInt, formatNum } from "../utils/forecastFormat.js";

function initForm() {
  if (typeof window === "undefined") return defaultFormState();
  return formStateFromSearchParams(new URLSearchParams(window.location.search));
}

export function WarehouseRegionAuditPage(): JSX.Element {
  const [form, setForm] = useState(initForm);
  const [apiToken, setApiToken] = useState("");
  const [data, setData] = useState<WarehouseRegionAuditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sp = useMemo(() => {
    const p = new URLSearchParams();
    p.set("snapshotDate", form.snapshotDate);
    p.set("horizonDays", form.horizonDays);
    return p;
  }, [form.snapshotDate, form.horizonDays]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWarehouseRegionAudit(sp, apiToken);
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
  }, [sp, apiToken]);

  const t = data?.totals;

  return (
    <div class="forecast-next-root warehouse-audit-page">
      <header class="top">
        <h1>Аудит маппинга складов → макрорегион</h1>
        <p class="muted">
          <a href={FORECAST_UI_SPA_ROUTES.home}>← К прогнозу</a>
          {" · "}
          <a href={FORECAST_UI_SPA_ROUTES.redistribution}>Перераспределение</a>
          {" · "}
          <a href={FORECAST_UI_SPA_ROUTES.regionalDemandDiagnostics}>Регион vs fulfillment</a>
        </p>
        <p class="muted warehouse-audit-lede">
          Агрегаты по строкам <code>wb_forecast_snapshots</code> (SKU×склад) для выбранного среза. Склады без
          записи в справочнике дают вклад в «не сопоставлено» и искажают кластерные суммы, пока не добавлены ключи в{" "}
          <code>wbWarehouseMacroRegion.ts</code>.
        </p>
      </header>

      <section class="panel warehouse-audit-controls">
        <div class="warehouse-audit-controls-grid">
          <label>
            Bearer (FORECAST_UI_TOKEN)
            <input
              type="password"
              value={apiToken}
              onInput={(e) => setApiToken((e.target as HTMLInputElement).value)}
              autoComplete="off"
            />
          </label>
          <label>
            Дата среза
            <input
              type="date"
              value={form.snapshotDate}
              onInput={(e) =>
                setForm((f) => ({
                  ...f,
                  snapshotDate: (e.target as HTMLInputElement).value,
                }))
              }
            />
          </label>
          <label>
            Горизонт (дн.)
            <select
              value={form.horizonDays}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  horizonDays: (e.target as HTMLSelectElement).value,
                }))
              }
            >
              <option value="30">30</option>
              <option value="60">60</option>
              <option value="90">90</option>
            </select>
          </label>
        </div>
        <button type="button" class="btn-load primary" disabled={loading} onClick={() => void load()}>
          {loading ? "Загрузка…" : "Загрузить аудит"}
        </button>
      </section>

      {error ? (
        <p class="forecast-next-error" role="alert">
          {error}
        </p>
      ) : null}

      {t ? (
        <section class="panel warehouse-audit-summary">
          <h2>Сводка</h2>
          <dl class="warehouse-audit-dl">
            <div>
              <dt>Складов в срезе</dt>
              <dd>{formatInt(t.warehouseCount)}</dd>
            </div>
            <div>
              <dt>С маппингом / без</dt>
              <dd>
                {formatInt(t.mappedWarehouseCount)} / {formatInt(t.unmappedWarehouseCount)}
              </dd>
            </div>
            <div>
              <dt>Строк (SKU×склад)</dt>
              <dd>
                {formatInt(t.rowCount)} (без маппинга: {formatInt(t.unmappedRowCount)}, ~{formatNum(t.unmappedRowShare * 100)}%)
              </dd>
            </div>
            <div>
              <dt>Σ спрос/день</dt>
              <dd>
                {formatNum(t.sumForecastDailyDemand)} (без маппинга: {formatNum(t.unmappedSumForecastDailyDemand)}, ~{formatNum(t.unmappedForecastShare * 100)}%)
              </dd>
            </div>
            <div>
              <dt>Σ start_stock</dt>
              <dd>
                {formatInt(Math.round(t.sumStartStock))} (без маппинга: {formatInt(Math.round(t.unmappedSumStartStock))})
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      {data?.clusterTotals?.length ? (
        <section class="panel warehouse-audit-clusters">
          <h2>Кластеры (по макрорегиону)</h2>
          <p class="muted">
            Сибирь / ДВ / Новосибирск-хаб объединены в одну группу; внутри макрорегионы не дублируются.
          </p>
          <div class="table-wrap">
            <table class="warehouse-audit-table">
              <thead>
                <tr>
                  <th>Кластер</th>
                  <th>Складов</th>
                  <th>Строк</th>
                  <th>Σ спрос/день</th>
                  <th>Σ остаток</th>
                </tr>
              </thead>
              <tbody>
                {data.clusterTotals.map((c) => (
                  <tr key={c.clusterId}>
                    <td>{c.clusterLabel}</td>
                    <td>{formatInt(c.warehouseCount)}</td>
                    <td>{formatInt(c.rowCount)}</td>
                    <td>{formatNum(c.sumForecastDailyDemand)}</td>
                    <td>{formatInt(Math.round(c.sumStartStock))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data?.macroRegionTotals?.length ? (
        <section class="panel warehouse-audit-macro">
          <h2>По макрорегиону (только сопоставленные склады)</h2>
          <div class="table-wrap">
            <table class="warehouse-audit-table">
              <thead>
                <tr>
                  <th>Макрорегион</th>
                  <th>Складов</th>
                  <th>Строк</th>
                  <th>Σ спрос/день</th>
                  <th>Σ остаток</th>
                </tr>
              </thead>
              <tbody>
                {data.macroRegionTotals.map((m) => (
                  <tr key={m.macroRegion}>
                    <td>{m.macroRegion}</td>
                    <td>{formatInt(m.warehouseCount)}</td>
                    <td>{formatInt(m.rowCount)}</td>
                    <td>{formatNum(m.sumForecastDailyDemand)}</td>
                    <td>{formatInt(Math.round(m.sumStartStock))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data?.unmappedSortedByForecast?.length ? (
        <section class="panel warehouse-audit-unmapped">
          <h2>Склады без маппинга (по убыванию Σ спрос/день)</h2>
          <div class="table-wrap">
            <table class="warehouse-audit-table">
              <thead>
                <tr>
                  <th>warehouse_key</th>
                  <th>Имя (сырое)</th>
                  <th>Строк</th>
                  <th>Σ спрос/день</th>
                  <th>Σ start_stock</th>
                </tr>
              </thead>
              <tbody>
                {data.unmappedSortedByForecast.map((w) => (
                  <tr key={w.warehouseKey}>
                    <td>
                      <code>{w.warehouseKey}</code>
                    </td>
                    <td>{w.warehouseNameRaw ?? "—"}</td>
                    <td>{formatInt(w.rowCount)}</td>
                    <td>{formatNum(w.sumForecastDailyDemand)}</td>
                    <td>{formatInt(Math.round(w.sumStartStock))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data && data.unmappedSortedByForecast.length === 0 ? (
        <p class="muted">Все склады среза сопоставлены с макрорегионом.</p>
      ) : null}

      <style>{`
        .warehouse-audit-page .warehouse-audit-lede { max-width: 48rem; line-height: 1.45; }
        .warehouse-audit-controls-grid { display: flex; flex-wrap: wrap; gap: 0.65rem 1rem; align-items: flex-end; margin-bottom: 0.75rem; }
        .warehouse-audit-controls-grid label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.85rem; }
        .warehouse-audit-controls-grid input, .warehouse-audit-controls-grid select {
          min-width: 9rem; padding: 0.35rem 0.5rem; border: 1px solid var(--fu-border-strong); border-radius: 6px; background: var(--fu-input-bg);
        }
        .warehouse-audit-dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: 0.5rem 1rem; margin: 0; }
        .warehouse-audit-dl dt { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em; color: var(--fu-muted, #666); margin: 0; }
        .warehouse-audit-dl dd { margin: 0.15rem 0 0 0; font-size: 0.95rem; }
        .warehouse-audit-table { font-size: 0.82rem; }
        .warehouse-audit-table th, .warehouse-audit-table td { white-space: nowrap; }
        .warehouse-audit-table td:nth-child(2) { white-space: normal; max-width: 18rem; }
        .warehouse-audit-unmapped code { font-size: 0.78rem; }
      `}</style>
    </div>
  );
}
