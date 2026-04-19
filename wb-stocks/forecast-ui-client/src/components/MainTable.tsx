import type { ForecastViewMode } from "../api/types.js";
import type { ExplainFocus } from "../types/explain.js";
import { tableEmptyState } from "../../styled-system/recipes";
import { TableHeadHintCell } from "./hints/index.js";
import {
  badgeClass,
  formatInt,
  formatNum,
  riskLabelWbTotal,
} from "../utils/forecastFormat.js";
import { formatWarehouseWithRegion } from "../utils/wbWarehouseRegion.js";

function wbCellClass(selected: boolean, explainFocus: ExplainFocus) {
  const base = "col-explain-wb col-metric-click";
  if (selected && explainFocus === "wb") return `${base} explain-highlight-wb`;
  return base;
}

function supplierAggCellClass(selected: boolean, explainFocus: ExplainFocus) {
  const base = "col-explain-supplier-agg col-metric-click";
  if (selected && explainFocus === "supplier") return `${base} explain-highlight-supplier`;
  return base;
}

function rowRec(row: unknown): Record<string, unknown> {
  return row && typeof row === "object" ? (row as Record<string, unknown>) : {};
}

function RiskStrip({ inv }: { inv: unknown }) {
  if (!inv || typeof inv !== "object") {
    return <>—</>;
  }
  const o = inv as Record<string, unknown>;
  const s = o.systemRisk ? "on" : "";
  const w = o.wbRisk ? "on" : "";
  const l = o.localRisk ? "on" : "";
  const rd = Boolean(o.regionalDeficit);
  return (
    <>
      <div
        class="risk-strip"
        title="Красный=система, оранжевый=WB∑, жёлтый=локальный WB"
      >
        <span class={`risk-dot risk-sys ${s}`}>S</span>
        <span class={`risk-dot risk-wb ${w}`}>W</span>
        <span class={`risk-dot risk-loc ${l}`}>L</span>
      </div>
      {rd ? (
        <span
          class="reg-def"
          title="Региональный дефицит: на этом WB пусто, запас есть elsewhere"
        >
          {" "}
          РД
        </span>
      ) : null}
    </>
  );
}

function TheadWbTotal() {
  return (
    <>
      <tr>
        <th class="th-risk-wb-total" scope="col">
          Риск
        </th>
        <th class="th-vendor-wb-total" scope="col">
          vendor
        </th>
        <th scope="col">nm_id</th>
        <th scope="col">Размер</th>
        <th scope="col">WB ∑</th>
        <th scope="col">Сток WB</th>
        <th scope="col">В пути</th>
        <th scope="col">Own</th>
        <th scope="col">System</th>
        <th scope="col">Дн. WB</th>
        <th scope="col">Спрос/день Σ</th>
        <th scope="col">На WB</th>
        <th scope="col">У пр-ля</th>
        <th scope="col">OOS (WB)</th>
        <th class="th-drill-wb-total" scope="col">
          Склады
        </th>
      </tr>
      <tr class="thead-hint-row">
        <TableHeadHintCell>бакет по дням</TableHeadHintCell>
        <TableHeadHintCell></TableHeadHintCell>
        <TableHeadHintCell></TableHeadHintCell>
        <TableHeadHintCell></TableHeadHintCell>
        <TableHeadHintCell>доступно = сток + в пути</TableHeadHintCell>
        <TableHeadHintCell>снимок на сети WB</TableHeadHintCell>
        <TableHeadHintCell>поставки в горизонте, уже едут</TableHeadHintCell>
        <TableHeadHintCell>наш склад</TableHeadHintCell>
        <TableHeadHintCell>WB∑ + own, общий пул</TableHeadHintCell>
        <TableHeadHintCell>дней покрытия (сеть)</TableHeadHintCell>
        <TableHeadHintCell>прогноз Σ/день</TableHeadHintCell>
        <TableHeadHintCell>довоз до целевого покрытия</TableHeadHintCell>
        <TableHeadHintCell>простой заказ у пр-ля</TableHeadHintCell>
        <TableHeadHintCell>ранняя дата OOS</TableHeadHintCell>
        <TableHeadHintCell>разбивка по складам</TableHeadHintCell>
      </tr>
    </>
  );
}

function TheadWarehouses() {
  return (
    <>
      <tr>
        <th>Risk</th>
        <th>
          Риск
          <br />
          уровней
        </th>
        <th>Склад WB · регион</th>
        <th>nm_id</th>
        <th>vendor</th>
        <th>Дней запаса</th>
        <th>Спрос/день</th>
        <th>System</th>
        <th>WB ∑</th>
        <th>WB лок.</th>
        <th>Сток</th>
        <th>В пути</th>
        <th>На WB</th>
        <th>Сток снимок</th>
      </tr>
      <tr class="thead-hint-row">
        <TableHeadHintCell></TableHeadHintCell>
        <TableHeadHintCell>S / W / L</TableHeadHintCell>
        <TableHeadHintCell>регион из справочника</TableHeadHintCell>
        <TableHeadHintCell></TableHeadHintCell>
        <TableHeadHintCell></TableHeadHintCell>
        <TableHeadHintCell></TableHeadHintCell>
        <TableHeadHintCell></TableHeadHintCell>
        <TableHeadHintCell>WB∑ + own</TableHeadHintCell>
        <TableHeadHintCell>сумма по сети</TableHeadHintCell>
        <TableHeadHintCell>этот склад (start+incoming)</TableHeadHintCell>
        <TableHeadHintCell>снимок на складе</TableHeadHintCell>
        <TableHeadHintCell>план в горизонте</TableHeadHintCell>
        <TableHeadHintCell>довоз на склад</TableHeadHintCell>
        <TableHeadHintCell></TableHeadHintCell>
      </tr>
    </>
  );
}

function TheadSystemTotal() {
  return (
    <>
      <tr>
        <th class="th-risk-wb-total" scope="col">
          Риск
        </th>
        <th class="th-vendor-wb-total" scope="col">
          vendor
        </th>
        <th scope="col">nm_id</th>
        <th scope="col">Размер</th>
        <th scope="col">WB ∑</th>
        <th scope="col">Сток WB</th>
        <th scope="col">В пути</th>
        <th scope="col">Own</th>
        <th scope="col">System</th>
        <th scope="col">Спрос/день Σ</th>
        <th scope="col">Дн. system</th>
        <th scope="col">OOS (system)</th>
        <th scope="col">На WB</th>
        <th scope="col">Заказать</th>
        <th scope="col">Заказ (LT)</th>
        <th class="th-drill-wb-total" scope="col">
          Склады
        </th>
      </tr>
      <tr class="thead-hint-row">
        <TableHeadHintCell>бакет по дням</TableHeadHintCell>
        <TableHeadHintCell></TableHeadHintCell>
        <TableHeadHintCell></TableHeadHintCell>
        <TableHeadHintCell></TableHeadHintCell>
        <TableHeadHintCell>доступно = сток + в пути</TableHeadHintCell>
        <TableHeadHintCell>снимок на сети WB</TableHeadHintCell>
        <TableHeadHintCell>поставки в горизонте</TableHeadHintCell>
        <TableHeadHintCell>наш склад</TableHeadHintCell>
        <TableHeadHintCell>WB∑ + own</TableHeadHintCell>
        <TableHeadHintCell>прогноз Σ/день</TableHeadHintCell>
        <TableHeadHintCell>дней покрытия (system)</TableHeadHintCell>
        <TableHeadHintCell>оценка даты OOS</TableHeadHintCell>
        <TableHeadHintCell>довоз до цели (сеть)</TableHeadHintCell>
        <TableHeadHintCell>простой заказ (target)</TableHeadHintCell>
        <TableHeadHintCell>план с LT и покрытием</TableHeadHintCell>
        <TableHeadHintCell>по складам</TableHeadHintCell>
      </tr>
    </>
  );
}

interface Props {
  rows: unknown[];
  viewMode: ForecastViewMode;
  selectedIndex: number | null;
  explainFocus: ExplainFocus;
  onSelectRow: (idx: number, focus?: ExplainFocus) => void;
  /** Только для `wbTotal` и `systemTotal` — клик по vendor/nm/размер/«По складам». */
  onDrillToWarehouses?: (nmId: number, techSize: string) => void;
}

export function MainTable({
  rows,
  viewMode,
  selectedIndex,
  explainFocus,
  onSelectRow,
  onDrillToWarehouses,
}: Props) {
  const vm = viewMode;
  const canDrill =
    (vm === "wbTotal" || vm === "systemTotal") && typeof onDrillToWarehouses === "function";

  const handleDrill = (ev: Event, nmId: number, techSize: string) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!canDrill || !Number.isFinite(nmId)) return;
    onDrillToWarehouses!(nmId, techSize);
  };

  const thead =
    vm === "wbWarehouses" ? (
      <TheadWarehouses />
    ) : vm === "systemTotal" ? (
      <TheadSystemTotal />
    ) : (
      <TheadWbTotal />
    );

  const tbody = rows.map((raw, idx) => {
    const row = rowRec(raw);
    const risk = row.risk;
    const riskKey = typeof risk === "string" ? risk : "ok";
    const inv = row.inventoryLevels;
    const rep = row.replenishment;
    const nmId = typeof row.nmId === "number" ? row.nmId : Number(row.nmId);
    const techSize = row.techSize != null ? String(row.techSize) : "";
    const selected = selectedIndex === idx;
    const xf = explainFocus;

    if (vm === "wbWarehouses") {
      return (
        <tr
          key={idx}
          class={`tr-row tr-risk-${riskKey}${selected ? " tr-selected" : ""}`}
          data-idx={idx}
          tabindex={0}
          title="Клик — детали расчёта"
          onClick={() => onSelectRow(idx, null)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              onSelectRow(idx, null);
            }
          }}
        >
          <td class="risk-cell">
            <span class={`badge ${badgeClass(risk)}`}>{String(risk ?? "")}</span>
          </td>
          <td class="risk-strip-cell">
            <RiskStrip inv={inv} />
          </td>
          <td>
            {formatWarehouseWithRegion(
              row.warehouseNameRaw != null ? String(row.warehouseNameRaw) : null,
              row.warehouseKey != null ? String(row.warehouseKey) : null,
            )}
          </td>
          <td>{String(row.nmId ?? "")}</td>
          <td>{String(row.vendorCode ?? "")}</td>
          <td>{formatNum(row.daysOfStock)}</td>
          <td>{formatNum(row.forecastDailyDemand)}</td>
          <td>
            {formatInt(
              inv && typeof inv === "object"
                ? (inv as Record<string, unknown>).systemAvailable
                : null,
            )}
          </td>
          <td>
            {formatInt(
              inv && typeof inv === "object"
                ? (inv as Record<string, unknown>).wbAvailable
                : null,
            )}
          </td>
          <td>
            {formatInt(
              inv && typeof inv === "object"
                ? (inv as Record<string, unknown>).localAvailable
                : null,
            )}
          </td>
          <td title="Остаток на этом складе (снимок)">{formatInt(row.startStock)}</td>
          <td
            class="metric-incoming"
            title="Поставки в горизонте — уже запланированы / в пути"
          >
            {formatInt(row.incomingUnits)}
          </td>
          <td
            class={wbCellClass(selected, xf)}
            title="Клик — расчёт «На WB»"
            onClick={(e) => {
              e.stopPropagation();
              onSelectRow(idx, "wb");
            }}
          >
            {formatInt(rep && typeof rep === "object" ? (rep as Record<string, unknown>).recommendedToWB : null)}
          </td>
          <td>{String(row.stockSnapshotAt ?? "")}</td>
        </tr>
      );
    }

    if (vm === "systemTotal") {
      return (
        <tr
          key={idx}
          class={`tr-row tr-risk-${riskKey}${selected ? " tr-selected" : ""}`}
          data-idx={idx}
          data-drill-nm={Number.isFinite(nmId) ? nmId : undefined}
          data-drill-ts={encodeURIComponent(techSize)}
          tabindex={0}
          title="Запасы в целом по SKU; клик по ячейке — детали или расчёт"
          onClick={() => onSelectRow(idx, null)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              onSelectRow(idx, null);
            }
          }}
        >
          <td class="risk-cell risk-cell-wb-total">
            <span class={`badge badge-wb-total ${badgeClass(risk)}`}>
              {riskLabelWbTotal(risk)}
            </span>
          </td>
          <td class="col-vendor-wb-total">
            <button
              type="button"
              class="wb-drill-link js-wb-drill"
              title="Показать строки по складам WB для этого SKU"
              onClick={(e) =>
                handleDrill(e, nmId, techSize)
              }
            >
              {String(row.vendorCode ?? "")}
            </button>
          </td>
          <td class="td-drill-nm">
            <button
              type="button"
              class="wb-drill-link tabular js-wb-drill"
              title="Показать строки по складам WB для этого SKU"
              onClick={(e) =>
                handleDrill(e, nmId, techSize)
              }
            >
              {String(row.nmId ?? "")}
            </button>
          </td>
          <td class="td-drill-size">
            <button
              type="button"
              class="wb-drill-link js-wb-drill"
              title="Показать строки по складам WB для этого SKU"
              onClick={(e) =>
                handleDrill(e, nmId, techSize)
              }
            >
              {techSize}
            </button>
          </td>
          <td>{formatInt(row.wbAvailableTotal)}</td>
          <td title="Σ сток по сети WB (снимок)">{formatInt(row.wbStartStockTotal)}</td>
          <td
            class="metric-incoming"
            title="Σ поставок в горизонте по сети WB — уже запланировано"
          >
            {formatInt(row.wbIncomingUnitsTotal)}
          </td>
          <td>{formatInt(row.ownStock)}</td>
          <td>
            {formatInt(
              inv && typeof inv === "object"
                ? (inv as Record<string, unknown>).systemAvailable
                : null,
            )}
          </td>
          <td>{formatNum(row.forecastDailyDemandTotal)}</td>
          <td>{formatNum(row.daysOfStockSystem)}</td>
          <td>{String(row.systemStockoutDateEstimate ?? "")}</td>
          <td
            class={wbCellClass(selected, xf)}
            title="Клик — расчёт «На WB»"
            onClick={(e) => {
              e.stopPropagation();
              onSelectRow(idx, "wb");
            }}
          >
            {formatInt(rep && typeof rep === "object" ? (rep as Record<string, unknown>).recommendedToWB : null)}
          </td>
          <td
            class={supplierAggCellClass(selected, xf)}
            title="Клик — закупка у производителя"
            onClick={(e) => {
              e.stopPropagation();
              onSelectRow(idx, "supplier");
            }}
          >
            {formatInt(row.recommendedFromSupplier)}
          </td>
          <td>{formatInt(row.recommendedOrderQty)}</td>
          <td class="td-drill-action">
            <button
              type="button"
              class="btn-drill-warehouses js-wb-drill"
              title="Показать этот SKU по складам WB"
              onClick={(e) => handleDrill(e, nmId, techSize)}
            >
              По складам
            </button>
          </td>
        </tr>
      );
    }

    // wbTotal
    return (
      <tr
        key={idx}
        class={`tr-row tr-risk-${riskKey}${selected ? " tr-selected" : ""}`}
        data-idx={idx}
        data-drill-nm={Number.isFinite(nmId) ? nmId : undefined}
        data-drill-ts={encodeURIComponent(techSize)}
        tabindex={0}
        title="Строка: детали; vendor / nm / размер / «По складам» — разбивка по складам"
        onClick={() => onSelectRow(idx, null)}
        onKeyDown={(ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            onSelectRow(idx, null);
          }
        }}
      >
        <td class="risk-cell risk-cell-wb-total">
          <span class={`badge badge-wb-total ${badgeClass(risk)}`}>
            {riskLabelWbTotal(risk)}
          </span>
        </td>
        <td class="col-vendor-wb-total">
          <button
            type="button"
            class="wb-drill-link js-wb-drill"
            title="Показать строки по складам WB для этого SKU"
            onClick={(e) => handleDrill(e, nmId, techSize)}
          >
            {String(row.vendorCode ?? "")}
          </button>
        </td>
        <td class="td-drill-nm">
          <button
            type="button"
            class="wb-drill-link tabular js-wb-drill"
            title="Показать строки по складам WB для этого SKU"
            onClick={(e) => handleDrill(e, nmId, techSize)}
          >
            {String(row.nmId ?? "")}
          </button>
        </td>
        <td class="td-drill-size">
          <button
            type="button"
            class="wb-drill-link js-wb-drill"
            title="Показать строки по складам WB для этого SKU"
            onClick={(e) => handleDrill(e, nmId, techSize)}
          >
            {techSize}
          </button>
        </td>
        <td>{formatInt(row.wbAvailableTotal)}</td>
        <td title="Σ сток по сети WB (снимок)">{formatInt(row.wbStartStockTotal)}</td>
        <td
          class="metric-incoming"
          title="Σ поставок в горизонте по сети WB — уже запланировано"
        >
          {formatInt(row.wbIncomingUnitsTotal)}
        </td>
        <td>{formatInt(row.ownStock)}</td>
        <td>
          {formatInt(
            inv && typeof inv === "object"
              ? (inv as Record<string, unknown>).systemAvailable
              : null,
          )}
        </td>
        <td>{formatNum(row.daysOfStockWB)}</td>
        <td>{formatNum(row.forecastDailyDemandTotal)}</td>
        <td
          class={wbCellClass(selected, xf)}
          title="Клик — расчёт «На WB»"
          onClick={(e) => {
            e.stopPropagation();
            onSelectRow(idx, "wb");
          }}
        >
          {formatInt(rep && typeof rep === "object" ? (rep as Record<string, unknown>).recommendedToWB : null)}
        </td>
        <td
          class={supplierAggCellClass(selected, xf)}
          title="Клик — закупка у производителя (как «У пр-ля»)"
          onClick={(e) => {
            e.stopPropagation();
            onSelectRow(idx, "supplier");
          }}
        >
          {formatInt(row.recommendedFromSupplier)}
        </td>
        <td>{String(row.stockoutDateWB ?? "")}</td>
        <td class="td-drill-action">
          <button
            type="button"
            class="btn-drill-warehouses js-wb-drill"
            title="Показать этот SKU по складам WB"
            onClick={(e) => handleDrill(e, nmId, techSize)}
          >
            По складам
          </button>
        </td>
      </tr>
    );
  });

  if (rows.length === 0) {
    return (
      <div class={`main-table-empty ${tableEmptyState()}`}>
        <p class="table-empty-title">Нет строк по текущим фильтрам</p>
        <p class="muted table-empty-hint">
          Смягчите «Риск окончания», увеличьте лимит или сбросьте поиск / быстрый фокус. Если данные
          должны быть — проверьте дату среза и токен, затем нажмите «Загрузить».
        </p>
      </div>
    );
  }

  return (
    <div class="table-wrap">
      <table id="grid" class={vm === "wbWarehouses" ? undefined : "grid-wb-total"}>
        <thead>{thead}</thead>
        <tbody id="tbody">{tbody}</tbody>
      </table>
    </div>
  );
}
