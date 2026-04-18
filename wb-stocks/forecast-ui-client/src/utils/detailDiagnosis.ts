import type { ForecastViewMode } from "../api/types.js";
import { formatInt } from "./forecastFormat.js";
import type { DetailViewKind } from "./detailViewKind.js";
import { resolveDetailViewKind } from "./detailViewKind.js";

function rec(row: unknown): Record<string, unknown> {
  return row && typeof row === "object" ? (row as Record<string, unknown>) : {};
}

export type DetailDiagnosisKind =
  | "ok"
  | "need_wb"
  | "stockout_before_arrival"
  | "regional_deficit";

export interface DetailDiagnosis {
  kind: DetailDiagnosisKind;
  title: string;
  hint: string;
}

/** Короткий диагноз по строке (без новых API). */
export function computeDetailDiagnosis(
  row: unknown,
  viewMode: ForecastViewMode,
  supplierRow: Record<string, unknown> | null,
): DetailDiagnosis {
  const r = rec(row);
  const vk: DetailViewKind = resolveDetailViewKind(viewMode, r);
  const inv = r.inventoryLevels;
  const io =
    inv && typeof inv === "object" ? (inv as Record<string, unknown>) : null;
  const rep = r.replenishment;
  const rp = rep && typeof rep === "object" ? (rep as Record<string, unknown>) : null;

  const regional = Boolean(io?.regionalDeficit);
  if (regional && vk === "wbWarehouses") {
    return {
      kind: "regional_deficit",
      title: "Региональный дефицит",
      hint: "На этом складе пусто, запас есть на других WB — см. риск и довоз.",
    };
  }

  const recWb = Number(rp?.recommendedToWB ?? 0);
  if (recWb > 0 && (vk === "wbTotal" || vk === "systemTotal")) {
    return {
      kind: "need_wb",
      title: "Не хватает на WB",
      hint: "По сети нужен довоз до целевого покрытия — см. колонку «На WB».",
    };
  }

  const sup = supplierRow;
  if (sup && Boolean(sup.willStockoutBeforeArrival)) {
    return {
      kind: "stockout_before_arrival",
      title: "Закончится до прихода",
      hint: "К моменту прихода партии не хватит покрытия спроса за lead time.",
    };
  }

  if (vk !== "wbWarehouses" && Boolean(r.willStockoutBeforeArrival)) {
    return {
      kind: "stockout_before_arrival",
      title: "Закончится до прихода",
      hint: "Риск по плану LT / покрытию после прихода.",
    };
  }

  const risk = String(r.risk ?? "");
  if (risk === "critical" || risk === "warning") {
    return {
      kind: "need_wb",
      title: "Повышенный риск (запас)",
      hint: "Дней запаса мало относительно порога — проверьте довоз и заказ.",
    };
  }

  return {
    kind: "ok",
    title: "OK",
    hint: "Критичных сигналов по этой строке не выявлено — уточните детали ниже.",
  };
}

export function detailActionLine(
  viewKind: DetailViewKind,
  explainFocus: string | null,
  row: unknown,
  supplierRow: Record<string, unknown> | null,
): string | null {
  const r = rec(row);
  const rep = r.replenishment;
  const rp = rep && typeof rep === "object" ? (rep as Record<string, unknown>) : null;

  if (explainFocus === "wb") {
    const n = Number(rp?.recommendedToWB ?? 0);
    return `Действие: довезти на WB — до ${formatInt(n)} шт. (оценка по целевому покрытию).`;
  }
  if (explainFocus === "supplier") {
    const sup = supplierRow;
    const fromSup = sup ? Number(sup.recommendedFromSupplier ?? 0) : 0;
    const ord = sup ? Number(sup.recommendedOrderQty ?? 0) : 0;
    if (sup) {
      return `Действие: заказ у производителя — простая рекомендация ${formatInt(fromSup)} шт.; заказ (LT) ${formatInt(ord)} шт.`;
    }
    return "Действие: откройте закупку по SKU в таблице ниже или смените режим таблицы.";
  }
  return "Действие: кликните по «На WB» или «У пр-ля» в таблице, чтобы увидеть расчёт.";
}
