import type { JSX } from "preact";
import { useCallback, useMemo, useState } from "preact/hooks";
import {
  fetchRegionalVsWarehouseSummary,
  ForecastApiError,
} from "../api/client.js";
import type { RegionalVsWarehouseSummaryResponse } from "../api/types.js";
import { FORECAST_UI_SPA_ROUTES } from "../routes.js";
import { defaultFormState, formStateFromSearchParams } from "../state/urlState.js";
import { formatNum } from "../utils/forecastFormat.js";

function initForm() {
  if (typeof window === "undefined") return defaultFormState();
  return formStateFromSearchParams(new URLSearchParams(window.location.search));
}

function pct(x: number): string {
  return `${formatNum(x * 100)}%`;
}

export function RegionalDemandDiagnosticsPage(): JSX.Element {
  const [form, setForm] = useState(initForm);
  const [apiToken, setApiToken] = useState("");
  const [data, setData] = useState<RegionalVsWarehouseSummaryResponse | null>(null);
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
      const res = await fetchRegionalVsWarehouseSummary(sp, apiToken);
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
    <div class="forecast-next-root regional-diagnostics-page">
      <header class="top">
        <h1>Региональный спрос vs fulfillment по сети</h1>
        <p class="muted">
          <a href={FORECAST_UI_SPA_ROUTES.home}>← К прогнозу</a>
          {" · "}
          <a href={FORECAST_UI_SPA_ROUTES.redistribution}>Перераспределение</a>
          {" · "}
          <a href={FORECAST_UI_SPA_ROUTES.warehouseRegionAudit}>Аудит складов</a>
        </p>
        <p class="muted regional-diagnostics-lede">
          Сравнение агрегатов без фильтра по SKU:{" "}
          <strong>регион заказа</strong> (снимок <code>wb_region_demand_snapshots</code>, география покупателя) и{" "}
          <strong>спрос по складу исполнения</strong> (снимок <code>wb_forecast_snapshots</code> по складам, тот же{" "}
          <code>horizonDays</code>, что в форме). Регион для buyer-регионов — таблица{" "}
          <code>wb_region_macro_region</code> + bootstrap в <code>wbRegionKeyMacroRegionBootstrap.ts</code> (БД
          перекрывает код); для складов —{" "}
          <code>wbWarehouseMacroRegion.ts</code>. Pipeline прогноза не меняется.
        </p>
      </header>

      <section class="panel regional-diagnostics-controls">
        <div class="regional-diagnostics-controls-grid">
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
            Дата снимка регионального спроса
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
            Горизонт fulfillment (дн.)
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
          {loading ? "Загрузка…" : "Загрузить сводку"}
        </button>
      </section>

      {error ? (
        <p class="forecast-next-error" role="alert">
          {error}
        </p>
      ) : null}

      {t && data ? (
        <section class="panel regional-diagnostics-summary">
          <h2>Общая сводка</h2>
          <p class="muted regional-diagnostics-hint">
            Доли считаются внутри своей колонки (сумма regional ≈ 100%, сумма fulfillment ≈ 100%).{" "}
            <strong>gapShare</strong> = разница долей (п.п.), крупные |gap| — где география спроса и исполнения
            расходятся.
          </p>
          <dl class="regional-diagnostics-dl">
            <div>
              <dt>Σ regional (buyer regions)</dt>
              <dd>{formatNum(t.regionalTotalDemand)}</dd>
            </div>
            <div>
              <dt>Σ fulfillment (склады)</dt>
              <dd>{formatNum(t.fulfillmentTotalDemand)}</dd>
            </div>
            <div>
              <dt>С сопоставленным регионом (доля от Σ regional)</dt>
              <dd>
                {formatNum(t.regionalMappedDemand)} ({pct(t.regionalMappedShareOfRegional)})
              </dd>
            </div>
            <div>
              <dt>Без маппинга (доля от Σ regional)</dt>
              <dd>
                {formatNum(t.regionalUnmappedDemand)} ({pct(t.regionalUnmappedShareOfRegional)})
              </dd>
            </div>
          </dl>
          {data.unmappedRegionalTotals.length === 0 ? (
            <p class="muted regional-diagnostics-unmapped-ok">
              Все <code>region_key</code> в срезе сопоставлены с регионом (in-code + БД).
            </p>
          ) : t.regionalUnmappedShareOfRegional <= 0.05 ? (
            <p class="muted regional-diagnostics-unmapped-ok">
              Несопоставлено мало (&lt;5% Σ regional) — блок ниже для контроля остаточных ключей.
            </p>
          ) : null}
        </section>
      ) : null}

      {data?.regionalTotals?.length ? (
        <section class="panel regional-diagnostics-block">
          <h2>Региональный спрос по region_key</h2>
          <div class="table-wrap">
            <table class="regional-diagnostics-table">
              <thead>
                <tr>
                  <th>region_key</th>
                  <th>region (сырой)</th>
                  <th>Спрос/день</th>
                  <th>Доля от Σ regional</th>
                </tr>
              </thead>
              <tbody>
                {data.regionalTotals.map((r) => (
                  <tr key={r.regionKey}>
                    <td>
                      <code>{r.regionKey}</code>
                    </td>
                    <td>{r.regionNameRaw ?? "—"}</td>
                    <td>{formatNum(r.regionalForecastDailyDemand)}</td>
                    <td>{pct(r.shareOfRegionalTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data?.warehouseMacroRegionTotals?.length ? (
        <section class="panel regional-diagnostics-block">
          <h2>Fulfillment по региону склада</h2>
          <div class="table-wrap">
            <table class="regional-diagnostics-table">
              <thead>
                <tr>
                  <th>Регион</th>
                  <th>Спрос/день (Σ по складам)</th>
                  <th>Доля от Σ fulfillment</th>
                </tr>
              </thead>
              <tbody>
                {data.warehouseMacroRegionTotals.map((r) => (
                  <tr key={r.macroRegion}>
                    <td>{r.macroRegion}</td>
                    <td>{formatNum(r.fulfillmentForecastDailyDemand)}</td>
                    <td>{pct(r.shareOfFulfillmentTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data?.comparisonByMacroRegion?.length ? (
        <section class="panel regional-diagnostics-block">
          <h2>Сравнение по региону</h2>
          <p class="muted">
            Сортировка: по убыванию <code>|gapShare|</code> — сначала самые «сдвинутые» кластеры.
          </p>
          <div class="table-wrap">
            <table class="regional-diagnostics-table">
              <thead>
                <tr>
                  <th>Регион</th>
                  <th>Regional</th>
                  <th>Fulfillment</th>
                  <th>Доля regional</th>
                  <th>Доля fulfillment</th>
                  <th>gap</th>
                  <th>gapShare</th>
                </tr>
              </thead>
              <tbody>
                {data.comparisonByMacroRegion.map((r) => (
                  <tr key={r.macroRegion}>
                    <td>{r.macroRegion}</td>
                    <td>{formatNum(r.regionalDemand)}</td>
                    <td>{formatNum(r.fulfillmentDemand)}</td>
                    <td>{pct(r.regionalShare)}</td>
                    <td>{pct(r.fulfillmentShare)}</td>
                    <td>{formatNum(r.gap)}</td>
                    <td>{formatNum(r.gapShare)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data?.unmappedRegionalTotals?.length ? (
        <section class="panel regional-diagnostics-block">
          <h2>Регионы заказа без маппинга</h2>
          <p class="muted">
            Ключи <code>region_key</code> без пары в bootstrap / БД. Дополняйте{" "}
            <code>wb_region_macro_region</code> или явные ключи в{" "}
            <code>wbRegionKeyMacroRegionBootstrap.ts</code> (без угадываний по подстроке).
          </p>
          <div class="table-wrap">
            <table class="regional-diagnostics-table">
              <thead>
                <tr>
                  <th>region_key</th>
                  <th>Название</th>
                  <th>Спрос/день</th>
                  <th>Доля от Σ regional</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {data.unmappedRegionalTotals.map((r) => (
                  <tr key={r.regionKey}>
                    <td>
                      <code>{r.regionKey}</code>
                    </td>
                    <td>{r.regionNameRaw ?? "—"}</td>
                    <td>{formatNum(r.regionalForecastDailyDemand)}</td>
                    <td>{pct(r.shareOfRegionalTotal)}</td>
                    <td>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!loading && !error && data && data.regionalTotals.length === 0 ? (
        <p class="muted">Нет строк в <code>wb_region_demand_snapshots</code> на выбранную дату.</p>
      ) : null}

      <style>{`
        .regional-diagnostics-page .regional-diagnostics-controls-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 0.65rem 1rem;
          align-items: flex-end;
          margin-bottom: 0.75rem;
        }
        .regional-diagnostics-page .regional-diagnostics-controls-grid label {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          font-size: 0.85rem;
        }
        .regional-diagnostics-page .regional-diagnostics-dl {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
          gap: 0.75rem 1.25rem;
          margin: 0;
        }
        .regional-diagnostics-page .regional-diagnostics-dl dt {
          font-size: 0.78rem;
          color: var(--muted, #6b7280);
          margin: 0;
        }
        .regional-diagnostics-page .regional-diagnostics-dl dd {
          margin: 0.15rem 0 0 0;
          font-weight: 600;
          font-size: 1rem;
        }
        .regional-diagnostics-page .regional-diagnostics-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.82rem;
        }
        .regional-diagnostics-page .regional-diagnostics-table th,
        .regional-diagnostics-page .regional-diagnostics-table td {
          padding: 0.35rem 0.5rem;
          text-align: left;
          border-bottom: 1px solid rgba(0,0,0,0.08);
        }
        .regional-diagnostics-page .regional-diagnostics-lede,
        .regional-diagnostics-page .regional-diagnostics-hint {
          max-width: 52rem;
          line-height: 1.45;
        }
      `}</style>
    </div>
  );
}
