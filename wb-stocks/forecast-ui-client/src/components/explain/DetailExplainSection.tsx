import type { ExplainFocus } from "../../types/explain.js";
import type { WbExplainCtx } from "./WbReplenishExplain.js";
import { WbReplenishExplain } from "./WbReplenishExplain.js";
import { SupplierOrderExplain } from "./SupplierOrderExplain.js";

type DetailViewKind = "wbTotal" | "systemTotal" | "wbWarehouses";

interface Props {
  viewKind: DetailViewKind;
  focus: ExplainFocus;
  rep: unknown;
  wbCtx: WbExplainCtx;
  supplierRow: Record<string, unknown> | null;
}

/** Как legacy `setDetailExplainForFocus` + `supplierExplainBlock`. */
export function DetailExplainSection({ viewKind, focus, rep, wbCtx, supplierRow }: Props) {
  if (focus == null) return null;

  if (focus === "wb") {
    const el = WbReplenishExplain(rep, wbCtx);
    return (
      <div class="detail-explain-wrap detail-explain-above">
        {el ?? (
          <p class="explain-muted explain-missing">
            Расчёт «На WB» недоступен: нет replenishment или не задано целевое покрытие
            (targetCoverageDays).
          </p>
        )}
      </div>
    );
  }

  if (focus === "supplier") {
    if (viewKind === "wbWarehouses") {
      return (
        <div class="detail-explain-wrap detail-explain-above explain-highlight-supplier">
          <p class="explain-muted explain-missing">
            Закупка у производителя в этой таблице не показана — откройте режим «Запасы в целом» / «WB в
            целом» или таблицу закупки ниже.
          </p>
        </div>
      );
    }
    return (
      <div class="detail-explain-wrap detail-explain-above">
        {supplierRow ? (
          <SupplierOrderExplain row={supplierRow} />
        ) : (
          <div class="explain-missing-block">
            <p class="explain-muted explain-missing">
              <strong>Нет данных по поставщику для этого SKU</strong> — возможно, SKU не попал в
              текущий фильтр.
            </p>
            <p class="explain-muted">→ попробуйте сбросить фильтр или увеличить limit.</p>
          </div>
        )}
      </div>
    );
  }

  return null;
}
