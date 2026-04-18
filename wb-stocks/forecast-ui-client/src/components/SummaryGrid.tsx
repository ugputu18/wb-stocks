import type { JSX } from "preact";
import type { ForecastSummaryResponse, ForecastViewMode } from "../api/types.js";

interface Props {
  data: ForecastSummaryResponse;
  /** Same as legacy: often merged from rows `viewMode`. */
  viewMode: ForecastViewMode;
}

function cell(
  label: string,
  value: unknown,
  cls: string,
  title: string,
  muted?: boolean,
): JSX.Element {
  const v =
    typeof value === "number"
      ? String(value)
      : value == null
        ? "—"
        : String(value);
  return (
    <div
      class={`cell${muted ? " cell-muted" : ""}`}
      title={title}
    >
      <span class="muted">{label}</span>
      <strong class={cls || undefined}>{v}</strong>
    </div>
  );
}

export function SummaryGrid({ data, viewMode }: Props) {
  const r = data.risk ?? {
    critical: 0,
    warning: 0,
    attention: 0,
    ok: 0,
  };
  const vm = viewMode;

  const rowLabel =
    vm === "wbWarehouses"
      ? "Всего строк (склад × SKU по фильтру)"
      : vm === "systemTotal"
        ? "Всего строк (SKU, запасы system по фильтру)"
        : "Всего строк (SKU по сети WB по фильтру)";

  const operational: JSX.Element[] = [
    cell(
      rowLabel,
      data.totalRows,
      "",
      vm === "wbWarehouses"
        ? "Число строк warehouse×SKU после фильтров (как в основной таблице)."
        : vm === "systemTotal"
          ? "Число строк SKU в режиме «Запасы в целом» (как в таблице)."
          : "Число строк SKU (nm_id×размер) в режиме WB в целом после фильтров.",
    ),
    cell(
      "Critical · запас < 7 дн.",
      r.critical,
      "risk-critical",
      `Строк с целыми днями запаса < 7 (${vm === "systemTotal" ? "по system" : "в текущем виде"}) и фильтре (bucket critical).`,
    ),
    cell(
      "Warning · [7, 14) дн.",
      r.warning,
      "risk-warning",
      "Строк в диапазоне [7; 14) дней покрытия (bucket warning).",
    ),
    cell(
      "Attention · [14, 30) дн.",
      r.attention,
      "risk-attention",
      "Строк в диапазоне [14; 30) дней покрытия (bucket attention).",
    ),
    cell(
      "OK ≥30",
      r.ok,
      "risk-ok",
      "Строк с покрытием не менее 30 дней (bucket ok).",
    ),
  ];

  const rep = data.replenishment;
  if (rep && typeof rep.recommendedToWBTotal === "number") {
    const mode = rep.replenishmentMode || "wb";
    const primary =
      mode === "supplier" ? rep.recommendedFromSupplierTotal : rep.recommendedToWBTotal;
    operational.push(
      cell(
        "KPI по режиму (" + mode + "), шт.",
        primary,
        "",
        mode === "supplier"
          ? "Суммарная рекомендация «Заказать» у поставщика по уникальным SKU (витрина ниже); для режима wb здесь была бы сумма «На WB»."
          : "Сумма рекомендаций довоза на WB по строкам текущего вида (в режиме WB в целом — по SKU-сети).",
      ),
    );
    const wbSumLabel =
      vm === "wbWarehouses"
        ? "Σ на WB (по строкам склад×SKU, network−спрос)"
        : vm === "systemTotal"
          ? "Σ на WB (SKU, сеть WB — те же строки, что в таблице)"
          : "Σ на WB (SKU по сети, сумма рекомендаций «На WB»)";
    operational.push(
      cell(
        wbSumLabel,
        rep.recommendedToWBTotal,
        "",
        "Сумма столбца «На WB» по полному фильтру (без лимита таблицы): max(0, ceil( спрос×targetCoverage − WB∑ сети )) на строку.",
      ),
    );
    operational.push(
      cell(
        "Σ у производителя (уникальные SKU, см. таблицу ниже)",
        rep.recommendedFromSupplierTotal,
        "",
        "Сумма recommendedFromSupplier по SKU-витрине; riskStockout к supplier-списку не применяется.",
      ),
    );
    if (typeof rep.recommendedOrderQtyTotal === "number") {
      operational.push(
        cell(
          "Σ заказ (LT)",
          rep.recommendedOrderQtyTotal,
          "",
          "Сумма recommendedOrderQty по тем же SKU и leadTime/coverage/safety, что в таблице закупки.",
        ),
      );
    }
  }

  const staleLabel =
    vm === "wbWarehouses"
      ? "Устаревший сток (строк склад×SKU)"
      : vm === "systemTotal"
        ? "Устаревший сток (строк SKU, system)"
        : "Устаревший сток (строк SKU по сети)";

  const technical: JSX.Element[] = [];
  if (data.replenishment?.ownWarehouseCode) {
    technical.push(
      cell(
        "own warehouse_code",
        data.replenishment.ownWarehouseCode,
        "",
        "Код строки own_stock_snapshots, использованный в расчёте own и system.",
        true,
      ),
    );
  }
  technical.push(
    cell(
      staleLabel,
      data.staleStockRowCount,
      "",
      "Строк, у которых дата stock_snapshot_at старше выбранной snapshotDate (построчно или по SKU в режиме WB в целом — см. сервер).",
      true,
    ),
    cell(
      "Сток snapshot min",
      data.oldestStockSnapshotAt ?? "—",
      "",
      "Минимальная отметка времени снимка остатка среди строк, попавших в KPI.",
      true,
    ),
    cell(
      "Сток snapshot max",
      data.newestStockSnapshotAt ?? "—",
      "",
      "Максимальная отметка времени снимка остатка среди строк KPI.",
      true,
    ),
  );

  return (
    <div class="summary-grid-wrap">
      <div class="summary-grid summary-grid-operational">{operational}</div>
      <p class="summary-grid-tech-label muted">Техническое состояние данных</p>
      <div class="summary-grid summary-grid-technical">{technical}</div>
    </div>
  );
}
