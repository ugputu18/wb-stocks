import { useMemo, useState } from "preact/hooks";
import type { JSX } from "preact";
import { TableHeadHintCell } from "./hints/index.js";
import { formatInt, formatNum } from "../utils/forecastFormat.js";
import { supplierRowKey } from "../utils/supplierLookup.js";

function rowRec(row: unknown): Record<string, unknown> {
  return row && typeof row === "object" ? (row as Record<string, unknown>) : {};
}

function sortSupplierRows(rows: unknown[]): unknown[] {
  return [...rows].sort((a, b) => {
    const ra = rowRec(a);
    const rb = rowRec(b);
    const wa = Boolean(ra.willStockoutBeforeArrival);
    const wb = Boolean(rb.willStockoutBeforeArrival);
    if (wa !== wb) return wa ? -1 : 1;
    const oa = Number(ra.recommendedOrderQty) || 0;
    const ob = Number(rb.recommendedOrderQty) || 0;
    if (ob !== oa) return ob - oa;
    const fa = Number(ra.recommendedFromSupplier) || 0;
    const fb = Number(rb.recommendedFromSupplier) || 0;
    if (fb !== fa) return fb - fa;
    const na = Number(ra.nmId) || 0;
    const nb = Number(rb.nmId) || 0;
    return na - nb;
  });
}

function isProblematic(r: Record<string, unknown>): boolean {
  if (Boolean(r.willStockoutBeforeArrival)) return true;
  const d = r.daysUntilStockout;
  if (typeof d === "number" && !Number.isNaN(d) && d >= 0 && d < 14) return true;
  return false;
}

function hasPositiveOrder(r: Record<string, unknown>): boolean {
  return (
    (Number(r.recommendedOrderQty) || 0) > 0 ||
    (Number(r.recommendedFromSupplier) || 0) > 0
  );
}

interface Props {
  rows: unknown[];
  highlightSupplierKey: string | null;
  supplierExplainActive: boolean;
  onRowClick: (row: unknown, index: number) => void;
}

export function SupplierTable({
  rows,
  highlightSupplierKey,
  supplierExplainActive,
  onRowClick,
}: Props): JSX.Element {
  const [onlyProblem, setOnlyProblem] = useState(false);
  const [onlyOrder, setOnlyOrder] = useState(false);

  const prepared = useMemo(() => {
    const sorted = sortSupplierRows(rows);
    let list = sorted;
    if (onlyProblem) {
      list = list.filter((raw) => isProblematic(rowRec(raw)));
    }
    if (onlyOrder) {
      list = list.filter((raw) => hasPositiveOrder(rowRec(raw)));
    }
    return list;
  }, [rows, onlyProblem, onlyOrder]);

  const empty = prepared.length === 0 && rows.length > 0;
  const emptyAll = rows.length === 0;

  const tbody = prepared.map((raw, idx) => {
    const r = rowRec(raw);
    const key = supplierRowKey(r.nmId, r.techSize);
    const matchHighlight =
      supplierExplainActive &&
      highlightSupplierKey !== null &&
      highlightSupplierKey === key;
    const d = r.daysUntilStockout;
    const daysStr =
      d == null || Number.isNaN(d) ? "—" : formatNum(d);

    return (
      <tr
        key={`${key}-${idx}`}
        class={`${matchHighlight ? "tr-selected " : ""}tr-row`}
        data-sup-key={key}
        tabindex={0}
        onClick={() => onRowClick(raw, idx)}
        onKeyDown={(ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            onRowClick(raw, idx);
          }
        }}
      >
        <td>{String(r.nmId ?? "")}</td>
        <td>{String(r.techSize ?? "")}</td>
        <td>{String(r.vendorCode ?? "")}</td>
        <td>{formatNum(r.sumForecastDailyDemand)}</td>
        <td>{daysStr}</td>
        <td>{formatInt(r.targetDemandSystem)}</td>
        <td>{formatInt(r.wbAvailableTotal)}</td>
        <td title="Σ сток по сети WB">{formatInt(r.wbStartStockTotal)}</td>
        <td class="metric-incoming" title="Σ в пути по горизонту">
          {formatInt(r.wbIncomingUnitsTotal)}
        </td>
        <td>{formatInt(r.ownStock)}</td>
        <td>{formatInt(r.systemAvailable)}</td>
        <td
          class={`col-explain-supplier-order col-metric-click${matchHighlight ? " explain-highlight-supplier" : ""}`}
        >
          <strong>{formatInt(r.recommendedFromSupplier)}</strong>
        </td>
        <td>{formatNum(r.stockAtArrival)}</td>
        <td>
          <strong>{formatInt(r.recommendedOrderQty)}</strong>
        </td>
        <td>
          {r.willStockoutBeforeArrival ? (
            <span class="badge badge-critical">да</span>
          ) : (
            "нет"
          )}
        </td>
      </tr>
    );
  });

  return (
    <div class="supplier-table-wrap">
      <div class="supplier-table-toolbar" role="toolbar">
        <label class="supplier-toolbar-toggle">
          <input
            type="checkbox"
            checked={onlyProblem}
            onChange={(e) =>
              setOnlyProblem((e.target as HTMLInputElement).checked)
            }
          />
          <span>Только проблемные</span>
        </label>
        <label class="supplier-toolbar-toggle">
          <input
            type="checkbox"
            checked={onlyOrder}
            onChange={(e) =>
              setOnlyOrder((e.target as HTMLInputElement).checked)
            }
          />
          <span>Только с заказом &gt; 0</span>
        </label>
        <span class="muted supplier-toolbar-hint">
          Сортировка: риск до прихода → заказ (LT) → nm_id
        </span>
      </div>
      {emptyAll ? (
        <div class="table-empty-state">
          <p class="table-empty-title">Нет строк закупки</p>
          <p class="muted table-empty-hint">
            Проверьте дату среза, горизонт и поиск. Для supplier-витрины не применяется фильтр «Риск
            окончания» в основной таблице — при необходимости сузьте поиск или склад.
          </p>
        </div>
      ) : empty ? (
        <div class="table-empty-state">
          <p class="table-empty-title">Нет строк по текущим фильтрам таблицы</p>
          <p class="muted table-empty-hint">
            Снимите «Только проблемные» / «Только с заказом» или ослабьте фильтры в форме выше.
          </p>
        </div>
      ) : (
        <div class="table-wrap">
          <table id="supplierGrid" class="supplier-grid">
            <thead>
              <tr>
                <th>nm_id</th>
                <th>Размер</th>
                <th>vendor</th>
                <th>Σ спрос/день</th>
                <th>Дней до OOS</th>
                <th>target×дни</th>
                <th>WB ∑</th>
                <th>Сток WB</th>
                <th>В пути</th>
                <th>Own</th>
                <th>System</th>
                <th>Заказать</th>
                <th>Запас к приходу</th>
                <th>Заказ (LT)</th>
                <th>Риск до прихода</th>
              </tr>
              <tr class="thead-hint-row">
                <TableHeadHintCell></TableHeadHintCell>
                <TableHeadHintCell></TableHeadHintCell>
                <TableHeadHintCell></TableHeadHintCell>
                <TableHeadHintCell>агрегат по SKU</TableHeadHintCell>
                <TableHeadHintCell>оценка по system</TableHeadHintCell>
                <TableHeadHintCell>цель × дни</TableHeadHintCell>
                <TableHeadHintCell>доступно = сток + в пути</TableHeadHintCell>
                <TableHeadHintCell>снимок на сети</TableHeadHintCell>
                <TableHeadHintCell>в горизонте, уже едет</TableHeadHintCell>
                <TableHeadHintCell>наш склад</TableHeadHintCell>
                <TableHeadHintCell>WB∑ + own</TableHeadHintCell>
                <TableHeadHintCell>простая рекомендация</TableHeadHintCell>
                <TableHeadHintCell>ожидаемый запас к приходу LT</TableHeadHintCell>
                <TableHeadHintCell>план с LT и покрытием</TableHeadHintCell>
                <TableHeadHintCell>не хватит при приходе</TableHeadHintCell>
              </tr>
            </thead>
            <tbody id="supplierTbody">{tbody}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
