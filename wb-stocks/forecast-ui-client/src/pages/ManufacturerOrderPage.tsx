import type { JSX } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  downloadForecastFile,
  fetchSupplierReplenishment,
  ForecastApiError,
  postForecastRecalculate,
} from "../api/client.js";
import type { SupplierReplenishmentRow } from "../api/types.js";
import { ForecastSystemNav } from "../components/ForecastSystemNav.js";
import { HelpToggle } from "../components/HelpToggle.js";
import { LabelWithInlineHelp } from "../components/hints/index.js";
import { defaultFormState, formStateFromSearchParams } from "../state/urlState.js";
import { formatInt, formatNum } from "../utils/forecastFormat.js";

type TargetCoverage = "30" | "45" | "60";
type HorizonDays = "30" | "60" | "90";
type OrderFocus = "orders" | "arrivalRisk" | "all";

interface ManufacturerOrderForm {
  horizonDays: HorizonDays;
  targetCoverageDays: TargetCoverage;
  leadTimeDays: string;
  coverageDays: string;
  safetyDays: string;
  ownWarehouseCode: string;
  q: string;
  techSize: string;
  focus: OrderFocus;
}

const ORDER_FOCUS_LABELS: Record<OrderFocus, string> = {
  orders: "К заказу > 0",
  arrivalRisk: "Риск до прихода",
  all: "Все SKU",
};

function readFocus(params: URLSearchParams): OrderFocus {
  const raw = params.get("focus")?.trim();
  return raw === "arrivalRisk" || raw === "all" ? raw : "orders";
}

function initForm(): ManufacturerOrderForm {
  const params =
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);
  const base =
    typeof window === "undefined" ? defaultFormState() : formStateFromSearchParams(params);
  return {
    horizonDays:
      base.horizonDays === "60" || base.horizonDays === "90"
        ? base.horizonDays
        : "30",
    targetCoverageDays:
      base.targetCoverageDays === "45" || base.targetCoverageDays === "60"
        ? base.targetCoverageDays
        : "30",
    leadTimeDays: base.leadTimeDays,
    coverageDays: base.coverageDays,
    safetyDays: base.safetyDays,
    ownWarehouseCode: base.ownWarehouseCode,
    q: base.q,
    techSize: base.techSize,
    focus: readFocus(params),
  };
}

function normalizedInt(
  raw: string,
  min: number,
  max: number,
  fallback: string,
): string {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return String(n);
}

function buildSearchParams(form: ManufacturerOrderForm): URLSearchParams {
  const p = new URLSearchParams({
    horizonDays: form.horizonDays,
    targetCoverageDays: form.targetCoverageDays,
    replenishmentMode: "supplier",
    leadTimeDays: normalizedInt(form.leadTimeDays, 1, 1000, "45"),
    coverageDays: normalizedInt(form.coverageDays, 1, 730, "90"),
    safetyDays: normalizedInt(form.safetyDays, 0, 365, "0"),
    viewMode: "systemTotal",
  });
  if (form.ownWarehouseCode.trim()) {
    p.set("ownWarehouseCode", form.ownWarehouseCode.trim());
  }
  if (form.q.trim()) p.set("q", form.q.trim());
  if (form.techSize.trim()) p.set("techSize", form.techSize.trim());
  return p;
}

function sortRows(rows: readonly SupplierReplenishmentRow[]): SupplierReplenishmentRow[] {
  return [...rows].sort((a, b) => {
    if (a.willStockoutBeforeArrival !== b.willStockoutBeforeArrival) {
      return a.willStockoutBeforeArrival ? -1 : 1;
    }
    if (b.recommendedOrderQty !== a.recommendedOrderQty) {
      return b.recommendedOrderQty - a.recommendedOrderQty;
    }
    const da = a.daysUntilStockout ?? Number.POSITIVE_INFINITY;
    const db = b.daysUntilStockout ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    if (a.nmId !== b.nmId) return a.nmId - b.nmId;
    return a.techSize.localeCompare(b.techSize, "ru");
  });
}

function focusMatches(row: SupplierReplenishmentRow, focus: OrderFocus): boolean {
  if (focus === "orders") return row.recommendedOrderQty > 0;
  if (focus === "arrivalRisk") return row.willStockoutBeforeArrival;
  return true;
}

function summaryCell(label: string, value: string | number, cls = ""): JSX.Element {
  return (
    <div class="cell">
      <span class="muted">{label}</span>
      <strong class={cls || undefined}>{value}</strong>
    </div>
  );
}

function sum(rows: readonly SupplierReplenishmentRow[], pick: (row: SupplierReplenishmentRow) => number): number {
  return rows.reduce((acc, row) => acc + pick(row), 0);
}

function formatMaybeDays(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : formatNum(value);
}

export function ManufacturerOrderPage(): JSX.Element {
  const [form, setForm] = useState<ManufacturerOrderForm>(initForm);
  const [rows, setRows] = useState<SupplierReplenishmentRow[] | null>(null);
  const [meta, setMeta] = useState<{
    snapshotDate?: string;
    horizonDays?: number;
    targetCoverageDays?: number;
    leadTimeDays?: number;
    coverageDays?: number;
    safetyDays?: number;
    ownWarehouseCode?: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [recalculateBusy, setRecalculateBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialLoadDoneRef = useRef(false);

  const sp = useMemo(() => buildSearchParams(form), [form]);

  const patch = (p: Partial<ManufacturerOrderForm>) => {
    setForm((f) => ({ ...f, ...p }));
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSupplierReplenishment(sp);
      setRows(Array.isArray(res.rows) ? res.rows : []);
      setMeta({
        snapshotDate: res.snapshotDate,
        horizonDays: res.horizonDays,
        targetCoverageDays: res.targetCoverageDays,
        leadTimeDays: res.leadTimeDays,
        coverageDays: res.coverageDays,
        safetyDays: res.safetyDays,
        ownWarehouseCode: res.ownWarehouseCode,
      });
    } catch (e) {
      setRows(null);
      setMeta(null);
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

  const exportXlsx = useCallback(async () => {
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams(sp);
      params.set("onlyOrder", "1");
      const qs = params.toString();
      const datePart = meta?.snapshotDate ?? "latest";
      await downloadForecastFile(
        `/api/forecast/export-supplier${qs ? `?${qs}` : ""}`,
        `manufacturer-order-${datePart}-h${form.horizonDays}.xlsx`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }, [form.horizonDays, meta?.snapshotDate, sp]);

  const recalculate = useCallback(async () => {
    setRecalculateBusy(true);
    setError(null);
    try {
      const h = Number(form.horizonDays);
      await postForecastRecalculate({
        horizons: [Number.isFinite(h) && h > 0 ? h : 30],
        dryRun: false,
      });
      await load();
    } catch (e) {
      setError("Пересчёт: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRecalculateBusy(false);
    }
  }, [form.horizonDays, load]);

  useEffect(() => {
    if (initialLoadDoneRef.current) return;
    initialLoadDoneRef.current = true;
    void load();
  }, [load]);

  const allRows = rows ?? [];
  const visibleRows = useMemo(
    () => sortRows(allRows.filter((row) => focusMatches(row, form.focus))),
    [allRows, form.focus],
  );
  const orderableRowCount = useMemo(
    () => allRows.filter((r) => r.recommendedOrderQty > 0).length,
    [allRows],
  );
  const riskRowCount = useMemo(
    () => allRows.filter((r) => r.willStockoutBeforeArrival).length,
    [allRows],
  );
  const totalOrderQty = useMemo(
    () => sum(allRows, (r) => r.recommendedOrderQty),
    [allRows],
  );
  const totalSimpleNeed = useMemo(
    () => sum(allRows, (r) => r.recommendedFromSupplier),
    [allRows],
  );
  const totalDailyDemand = useMemo(
    () => sum(allRows, (r) => r.sumForecastDailyDemand),
    [allRows],
  );
  const totalSystemAvailable = useMemo(
    () => sum(allRows, (r) => r.systemAvailable),
    [allRows],
  );
  const totalStockAtArrival = useMemo(
    () => sum(allRows, (r) => r.stockAtArrival),
    [allRows],
  );

  const titleMeta = meta
    ? `LT ${meta.leadTimeDays ?? form.leadTimeDays} дн. · покрытие ${
        meta.coverageDays ?? form.coverageDays
      } дн.`
    : "параметры заказа";
  return (
    <div class="forecast-next-root manufacturer-order-page">
      <ForecastSystemNav
        dataDate={meta?.snapshotDate}
        onRecalculate={recalculate}
        recalculateBusy={recalculateBusy}
        recalculateDisabled={loading}
      />
      <header class="top">
        <h1>Планирование заказа у производителя</h1>
      </header>

      <section class="panel manufacturer-order-controls">
        <div class="manufacturer-order-controls-grid">
          <div class="manufacturer-order-row">
            <label>
              <LabelWithInlineHelp>
                Горизонт WB
                <HelpToggle label="Горизонт WB">
                  Горизонт прогноза и входящих WB-поставок, на котором построен
                  текущий срез. Для заказа производителю дальше используются
                  отдельные параметры LT и покрытия после прихода.
                </HelpToggle>
              </LabelWithInlineHelp>
              <select
                value={form.horizonDays}
                onChange={(e) =>
                  patch({ horizonDays: (e.target as HTMLSelectElement).value as HorizonDays })
                }
              >
                <option value="30">30 дн.</option>
                <option value="60">60 дн.</option>
                <option value="90">90 дн.</option>
              </select>
            </label>
            <label>
              <LabelWithInlineHelp>
                LT
                <HelpToggle label="LT">
                  Лид-тайм производства и доставки. Колонка «К приходу» =
                  текущий system-запас минус спрос за LT.
                </HelpToggle>
              </LabelWithInlineHelp>
              <input
                type="number"
                min="1"
                max="1000"
                inputMode="numeric"
                value={form.leadTimeDays}
                onInput={(e) =>
                  patch({ leadTimeDays: (e.target as HTMLInputElement).value })
                }
              />
            </label>
            <label>
              <LabelWithInlineHelp>
                Покрытие
                <HelpToggle label="Покрытие">
                  Сколько дней продаж должно остаться после прихода заказа.
                  «Заказ (LT)» закрывает это покрытие с учётом ожидаемого
                  остатка к приходу.
                </HelpToggle>
              </LabelWithInlineHelp>
              <input
                type="number"
                min="1"
                max="730"
                inputMode="numeric"
                value={form.coverageDays}
                onInput={(e) =>
                  patch({ coverageDays: (e.target as HTMLInputElement).value })
                }
              />
            </label>
            <label>
              <LabelWithInlineHelp>
                Страх
                <HelpToggle label="Страх">
                  Дополнительные дни спроса поверх покрытия после прихода.
                  Используется только в колонке «Заказ (LT)».
                </HelpToggle>
              </LabelWithInlineHelp>
              <input
                type="number"
                min="0"
                max="365"
                inputMode="numeric"
                value={form.safetyDays}
                onInput={(e) =>
                  patch({ safetyDays: (e.target as HTMLInputElement).value })
                }
              />
            </label>
          </div>
          <div class="manufacturer-order-row">
            <label>
              <LabelWithInlineHelp>
                Простой target
                <HelpToggle label="Простой target">
                  Поддерживает прежнюю метрику «простого» заказа: спрос × target
                  минус текущий system-запас. Это справочная колонка, основной
                  план здесь — «Заказ (LT)».
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
                <option value="30">30 дн.</option>
                <option value="45">45 дн.</option>
                <option value="60">60 дн.</option>
              </select>
            </label>
            <label>
              Склад own
              <input
                type="text"
                placeholder="main"
                value={form.ownWarehouseCode}
                onInput={(e) =>
                  patch({ ownWarehouseCode: (e.target as HTMLInputElement).value })
                }
              />
            </label>
            <label class="manufacturer-order-search">
              Поиск
              <input
                type="search"
                placeholder="nm_id, артикул…"
                value={form.q}
                onInput={(e) => patch({ q: (e.target as HTMLInputElement).value })}
              />
            </label>
            <label>
              Размер
              <input
                type="text"
                value={form.techSize}
                onInput={(e) =>
                  patch({ techSize: (e.target as HTMLInputElement).value })
                }
              />
            </label>
            <label>
              Фокус
              <select
                value={form.focus}
                onChange={(e) =>
                  patch({ focus: (e.target as HTMLSelectElement).value as OrderFocus })
                }
              >
                <option value="orders">{ORDER_FOCUS_LABELS.orders}</option>
                <option value="arrivalRisk">{ORDER_FOCUS_LABELS.arrivalRisk}</option>
                <option value="all">{ORDER_FOCUS_LABELS.all}</option>
              </select>
            </label>
            <button
              type="button"
              class="btn-load primary"
              disabled={loading}
              onClick={() => void load()}
            >
              {loading ? "Обновление…" : "Обновить"}
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <p class="forecast-next-error" role="alert">
          {error}
        </p>
      ) : null}

      {rows ? (
        <section class="panel manufacturer-order-summary">
          <h2>Сводка заказа</h2>
          <div class="summary-grid summary-grid-operational">
            {summaryCell("SKU в расчёте", allRows.length)}
            {summaryCell("К заказу", orderableRowCount, orderableRowCount > 0 ? "risk-warning" : "risk-ok")}
            {summaryCell("Риск до прихода", riskRowCount, riskRowCount > 0 ? "risk-critical" : "risk-ok")}
            {summaryCell("Σ заказ (LT)", formatInt(totalOrderQty))}
            {summaryCell("Простой дефицит", formatInt(totalSimpleNeed))}
            {summaryCell("Σ спрос/день", formatNum(totalDailyDemand))}
            {summaryCell("Σ system сейчас", formatInt(totalSystemAvailable))}
            {summaryCell("Σ к приходу", formatNum(totalStockAtArrival))}
          </div>
        </section>
      ) : null}

      {rows ? (
        <section class="panel manufacturer-order-table-panel">
          <div class="manufacturer-order-table-header">
            <h2>{titleMeta}</h2>
            <div class="manufacturer-order-table-actions">
              <span class="muted manufacturer-order-export-hint">
                {ORDER_FOCUS_LABELS[form.focus]}: {visibleRows.length} из {allRows.length}
              </span>
              <button
                type="button"
                class="btn-load"
                disabled={exporting || orderableRowCount === 0}
                onClick={() => void exportXlsx()}
                title="Экспортировать в Excel (XLSX) позиции с ненулевым «Заказ (LT)»"
              >
                {exporting ? "Экспорт…" : "Экспорт заказа"}
              </button>
            </div>
          </div>
          {visibleRows.length ? (
            <div class="table-wrap">
              <table class="manufacturer-order-table">
                <thead>
                  <tr>
                    <th>Риск</th>
                    <th>vendor</th>
                    <th>nm_id</th>
                    <th>Размер</th>
                    <th>Спрос/день</th>
                    <th>Дней запаса</th>
                    <th>WB сток</th>
                    <th>В пути</th>
                    <th>Own</th>
                    <th>System</th>
                    <th title="System сейчас − спрос за lead time">К приходу</th>
                    <th title="Единиц товара в коробе. Если справочник не заполнен — 1.">
                      Квант
                    </th>
                    <th title="Плановый заказ с учётом LT, покрытия и страхового буфера">
                      Заказ (LT)
                    </th>
                    <th title="Справочно: простой дефицит до targetCoverageDays">
                      Прост. заказ
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => (
                    <tr
                      key={`${r.nmId}-${r.techSize}`}
                      class={r.willStockoutBeforeArrival ? "manufacturer-order-risk-row" : undefined}
                    >
                      <td class="risk-cell">
                        {r.willStockoutBeforeArrival ? (
                          <span class="badge badge-critical">да</span>
                        ) : (
                          <span class="badge badge-ok">нет</span>
                        )}
                      </td>
                      <td>{r.vendorCode ?? ""}</td>
                      <td>{r.nmId}</td>
                      <td>{r.techSize}</td>
                      <td>{formatNum(r.sumForecastDailyDemand)}</td>
                      <td>{formatMaybeDays(r.daysUntilStockout)}</td>
                      <td>{formatInt(r.wbStartStockTotal)}</td>
                      <td>{formatInt(r.wbIncomingUnitsTotal)}</td>
                      <td>{formatInt(r.ownStock)}</td>
                      <td>{formatInt(r.systemAvailable)}</td>
                      <td class={r.stockAtArrival < 0 ? "manufacturer-order-negative-cell" : undefined}>
                        {formatNum(r.stockAtArrival)}
                      </td>
                      <td>{formatInt(r.unitsPerBox)}</td>
                      <td class={r.recommendedOrderQty > 0 ? "manufacturer-order-qty-cell" : undefined}>
                        {formatInt(r.recommendedOrderQty)}
                      </td>
                      <td>{formatInt(r.recommendedFromSupplier)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div class="main-table-empty">
              <p class="table-empty-title">Нет строк по текущему фокусу</p>
              <p class="muted table-empty-hint">
                Переключите «Фокус» на «Все SKU» или измените поиск и параметры заказа.
              </p>
            </div>
          )}
        </section>
      ) : null}

      <style>{`
        .manufacturer-order-page .manufacturer-order-controls-grid {
          display: flex;
          flex-direction: column;
          gap: 0.65rem 1rem;
        }
        .manufacturer-order-page .manufacturer-order-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.65rem 1rem;
          align-items: flex-end;
        }
        .manufacturer-order-page .manufacturer-order-controls-grid label {
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
          font-size: 0.85rem;
        }
        .manufacturer-order-page .manufacturer-order-controls-grid input[type="number"] {
          width: 6.5rem;
        }
        .manufacturer-order-page .manufacturer-order-search {
          min-width: 14rem;
        }
        .manufacturer-order-page .manufacturer-order-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.84rem;
        }
        .manufacturer-order-page .manufacturer-order-table th,
        .manufacturer-order-page .manufacturer-order-table td {
          padding: 0.42rem 0.5rem;
          text-align: left;
          border-bottom: 1px solid rgba(0,0,0,0.08);
          white-space: nowrap;
        }
        .manufacturer-order-page .manufacturer-order-table th:nth-child(2),
        .manufacturer-order-page .manufacturer-order-table td:nth-child(2) {
          white-space: normal;
          min-width: 8rem;
        }
        .manufacturer-order-page .manufacturer-order-table-header {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 0.6rem 1rem;
          margin-bottom: 0.4rem;
        }
        .manufacturer-order-page .manufacturer-order-table-header h2 {
          margin: 0;
        }
        .manufacturer-order-page .manufacturer-order-table-actions {
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }
        .manufacturer-order-page .manufacturer-order-export-hint {
          font-size: 0.82rem;
        }
        .manufacturer-order-page .manufacturer-order-qty-cell {
          font-weight: 700;
        }
        .manufacturer-order-page .manufacturer-order-negative-cell {
          color: var(--fu-danger);
          font-weight: 650;
        }
        .manufacturer-order-page .manufacturer-order-risk-row {
          box-shadow: inset 3px 0 0 #f87171;
        }
      `}</style>
    </div>
  );
}
