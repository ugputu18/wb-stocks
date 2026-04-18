import { Fragment } from "preact";
import type { ForecastViewMode } from "../api/types.js";
import type { ExplainFocus } from "../types/explain.js";
import {
  computeDetailDiagnosis,
  detailActionLine,
} from "../utils/detailDiagnosis.js";
import { formatDetailVal, formatInt, formatNum } from "../utils/forecastFormat.js";
import type { DetailViewKind } from "../utils/detailViewKind.js";
import { resolveDetailViewKind } from "../utils/detailViewKind.js";
import { findSupplierRow } from "../utils/supplierLookup.js";
import { DetailExplainSection } from "./explain/DetailExplainSection.js";
import type { WbExplainCtx } from "./explain/WbReplenishExplain.js";

export type { DetailViewKind } from "../utils/detailViewKind.js";
export { resolveDetailViewKind } from "../utils/detailViewKind.js";

function rowRec(row: unknown): Record<string, unknown> {
  return row && typeof row === "object" ? (row as Record<string, unknown>) : {};
}

function buildWbCtx(
  row: Record<string, unknown>,
  viewKind: DetailViewKind,
  inv: unknown,
): WbExplainCtx {
  const invO = inv && typeof inv === "object" ? (inv as Record<string, unknown>) : null;
  if (viewKind === "wbWarehouses") {
    return {
      forecastDailyDemand: row.forecastDailyDemand,
      ownStock: invO ? invO.ownStock : null,
      systemAvailable: invO ? invO.systemAvailable : null,
      wbStockOnHand: row.startStock,
      wbIncomingUnits: row.incomingUnits,
    };
  }
  return {
    forecastDailyDemand: row.forecastDailyDemandTotal,
    ownStock: row.ownStock,
    systemAvailable: invO ? invO.systemAvailable : null,
    wbStockOnHand: row.wbStartStockTotal,
    wbIncomingUnits: row.wbIncomingUnitsTotal,
  };
}

function DdVal({ v }: { v: unknown }) {
  if (v == null) return <>—</>;
  if (typeof v === "number") return <>{formatDetailVal(v)}</>;
  return <>{String(v)}</>;
}

interface Props {
  row: unknown | null;
  viewMode: ForecastViewMode;
  explainFocus: ExplainFocus;
  supplierRows: unknown[] | undefined;
}

export function DetailPanel({ row, viewMode, explainFocus, supplierRows }: Props) {
  if (row == null) {
    return (
      <section class="panel detail-panel">
        <h2>Детали строки</h2>
        <p class="muted" id="detailHint">
          Выберите строку в таблице прогноза выше.
        </p>
      </section>
    );
  }

  const r = rowRec(row);
  const inv = r.inventoryLevels;
  const rep = r.replenishment;
  const viewKind = resolveDetailViewKind(viewMode, r);
  const nmId = typeof r.nmId === "number" ? r.nmId : Number(r.nmId);
  const supplierRow =
    nmId != null && Number.isFinite(nmId)
      ? findSupplierRow(supplierRows, nmId, r.techSize)
      : null;
  const wbCtx = buildWbCtx(r, viewKind, inv);

  const pairs: [string, unknown][] = [];

  if (viewKind === "systemTotal") {
    pairs.push(
      ["Режим строки", "Запасы в целом (system = WB∑ + own по SKU)"],
      ["Bucket риска (по дням запаса system)", r.risk],
      ["nm_id", r.nmId],
      ["Размер", r.techSize],
      ["vendor_code", r.vendorCode],
      ["Сток WB (сеть, Σ снимок)", formatInt(r.wbStartStockTotal)],
      ["В пути WB (Σ, горизонт)", formatInt(r.wbIncomingUnitsTotal)],
      ["WB ∑ доступно (= сток + в пути)", formatInt(r.wbAvailableTotal)],
      ["ownStock", formatInt(r.ownStock)],
      ["systemAvailable", formatInt(inv && typeof inv === "object" ? (inv as Record<string, unknown>).systemAvailable : null)],
      ["Спрос/день Σ", formatNum(r.forecastDailyDemandTotal)],
      ["Дней запаса (system)", formatNum(r.daysOfStockSystem)],
      [
        "OOS (system) — оценка: snapshot + floor(дней system)",
        r.systemStockoutDateEstimate ?? "—",
      ],
      ["Сток snapshot (MIN по складам)", r.stockSnapshotAtSystem ?? "—"],
      [
        "wbRisk / systemRisk",
        inv && typeof inv === "object"
          ? [
              (inv as Record<string, unknown>).wbRisk,
              (inv as Record<string, unknown>).systemRisk,
            ].join(" / ")
          : "—",
      ],
      ["Рекомендация на WB (сеть)", formatInt(rep && typeof rep === "object" ? (rep as Record<string, unknown>).recommendedToWB : null)],
      ["Заказать (простой)", formatInt(r.recommendedFromSupplier)],
      ["Заказ (LT)", formatInt(r.recommendedOrderQty)],
      ["Риск до прихода (план LT)", r.willStockoutBeforeArrival ? "да" : "нет"],
    );
  } else if (viewKind === "wbTotal") {
    pairs.push(
      ["Режим строки", "WB в целом (одна строка на SKU по сети)"],
      ["Bucket риска (по дням запаса WB, сеть)", r.risk],
      ["nm_id", r.nmId],
      ["Размер", r.techSize],
      ["vendor_code", r.vendorCode],
      ["Сток WB (сеть, Σ снимок)", formatInt(r.wbStartStockTotal)],
      ["В пути WB (Σ, горизонт)", formatInt(r.wbIncomingUnitsTotal)],
      ["WB ∑ доступно (= сток + в пути)", formatInt(r.wbAvailableTotal)],
      ["Спрос/день Σ по сети", formatNum(r.forecastDailyDemandTotal)],
      ["Дней запаса WB (сеть)", formatNum(r.daysOfStockWB)],
      ["Дата OOS (MIN по складам)", r.stockoutDateWB ?? "—"],
      ["Сток snapshot (MIN по складам)", r.stockSnapshotAtWB ?? "—"],
      ["ownStock", formatInt(r.ownStock)],
      ["systemAvailable", formatInt(inv && typeof inv === "object" ? (inv as Record<string, unknown>).systemAvailable : null)],
      ["Рекомендация на WB (сеть)", formatInt(rep && typeof rep === "object" ? (rep as Record<string, unknown>).recommendedToWB : null)],
      ["Рекомендация у производителя (SKU)", formatInt(r.recommendedFromSupplier)],
    );
  } else {
    pairs.push(
      ["Bucket риска", r.risk],
      ["Склад (как в WB)", r.warehouseNameRaw ?? r.warehouseKey],
      ["nm_id", r.nmId],
      ["Размер", r.techSize],
      ["vendor_code", r.vendorCode],
      ["Штрихкод", r.barcode],
      [
        "Продажи 7д / 30д (шт.)",
        [r.units7, r.units30].filter((x) => x != null).join(" / "),
      ],
      [
        "Средний спрос 7д / 30д",
        [formatNum(r.avgDaily7), formatNum(r.avgDaily30)].join(" / "),
      ],
      ["Базовый спрос (сглаж.)", formatDetailVal(r.baseDailyDemand)],
      [
        "Тренд (сырой / clamp)",
        [formatNum(r.trendRatio), formatNum(r.trendRatioClamped)].join(" / "),
      ],
      ["Прогноз спроса/день (в симуляции)", formatDetailVal(r.forecastDailyDemand)],
      ["Сток (срез WB)", r.stockSnapshotAt ?? "—"],
      [
        "start_stock → end_stock",
        [formatNum(r.startStock), formatNum(r.endStock)].join(" → "),
      ],
      ["В пути / incoming (горизонт, уже в расчёте доступного)", formatDetailVal(r.incomingUnits)],
    );
    if (inv && typeof inv === "object") {
      const io = inv as Record<string, unknown>;
      pairs.push(
        ["— Запасы (read-side)", ""],
        ["systemAvailable (WB∑ + own)", formatInt(io.systemAvailable)],
        ["wbAvailable (сумма по складам WB)", formatInt(io.wbAvailable)],
        ["localAvailable (этот склад WB)", formatInt(io.localAvailable)],
        ["ownStock (наш склад по vendor)", formatInt(io.ownStock)],
        [
          "systemRisk / wbRisk / localRisk",
          [io.systemRisk, io.wbRisk, io.localRisk].join(" / "),
        ],
        ["regionalDeficit (локально пусто, запас есть)", io.regionalDeficit ? "да" : "нет"],
      );
    }
    if (rep && typeof rep === "object") {
      const rp = rep as Record<string, unknown>;
      pairs.push(
        ["— Поставка на WB (эта строка склада)", ""],
        ["targetCoverageDays", rp.targetCoverageDays],
        ["targetDemandWB (спрос/день×дни на этом WB)", formatDetailVal(rp.targetDemandWB)],
        ["wbAvailableTotal (сеть WB, тот же WB∑)", formatInt(rp.wbAvailableTotal)],
        ["recommendedToWB", formatInt(rp.recommendedToWB)],
        ["Закупка у пр-ля по SKU — см. таблицу «Закупка у производителя»", ""],
      );
    }
    pairs.push(
      ["Прогноз продаж (шт., горизонт)", formatDetailVal(r.forecastUnits)],
      ["Дней запаса (целых)", formatDetailVal(r.daysOfStock)],
      ["Дата исчерпания (если есть)", r.stockoutDate ?? "—"],
      ["computed_at", r.computedAt ?? "—"],
    );
  }

  const supForDiag =
    supplierRow && typeof supplierRow === "object"
      ? (supplierRow as Record<string, unknown>)
      : null;
  const diagnosis = computeDetailDiagnosis(row, viewMode, supForDiag);
  const actionLine = detailActionLine(viewKind, explainFocus, row, supForDiag);

  return (
    <section class="panel detail-panel">
      <h2>Детали строки</h2>
      <div
        class={`detail-diagnosis detail-diagnosis-${diagnosis.kind}`}
        role="status"
      >
        <p class="detail-diagnosis-title">{diagnosis.title}</p>
        <p class="muted detail-diagnosis-hint">{diagnosis.hint}</p>
      </div>
      <p class="detail-action-line">{actionLine}</p>
      <h3 class="detail-section-heading">Объяснение</h3>
      <DetailExplainSection
        viewKind={viewKind}
        focus={explainFocus}
        rep={rep}
        wbCtx={wbCtx}
        supplierRow={supplierRow}
      />
      <h3 class="detail-section-heading">Показатели</h3>
      <dl class="detail-dl" id="detailDl">
        {pairs.map(([k, v], idx) => (
          <Fragment key={idx}>
            <dt>{k}</dt>
            <dd>
              <DdVal v={v} />
            </dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}
