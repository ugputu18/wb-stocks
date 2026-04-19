import type { JSX } from "preact";
import type { RefObject } from "preact";
import { formatInt, formatNum } from "../../utils/forecastFormat.js";
import {
  formatWarehouseRegionFirst,
  getWarehouseMacroRegion,
  UNMAPPED_WAREHOUSE_REGION_LABEL,
} from "../../utils/wbWarehouseRegion.js";
import type { WbWarehouseNetworkRow } from "../../utils/wbWarehouseNetworkRow.js";
import type { SkuNetworkSelection } from "./redistributionTypes.js";

export type RedistributionSkuNetworkSectionProps = {
  donorKey: string;
  skuNetworkSelection: SkuNetworkSelection | null;
  onClose: () => void;
  skuNetworkRows: WbWarehouseNetworkRow[] | null;
  skuNetworkLoading: boolean;
  skuNetworkError: string | null;
  skuNetworkPanelRef: RefObject<HTMLDivElement>;
};

export function RedistributionSkuNetworkSection(
  props: RedistributionSkuNetworkSectionProps,
): JSX.Element | null {
  const {
    donorKey,
    skuNetworkSelection,
    onClose,
    skuNetworkRows,
    skuNetworkLoading,
    skuNetworkError,
    skuNetworkPanelRef,
  } = props;

  if (!skuNetworkSelection) return null;

  return (
    <div
      ref={skuNetworkPanelRef}
      class="redistribution-sku-network"
      id="redistribution-sku-network-panel"
      role="region"
      aria-labelledby="redistribution-sku-network-title"
    >
      <div class="redistribution-sku-network-head">
        <h3 id="redistribution-sku-network-title">
          Сеть по SKU: <span class="redistribution-sku">{skuNetworkSelection.nmId}</span>
          {skuNetworkSelection.techSize ? (
            <>
              {" "}
              / <span class="muted">{skuNetworkSelection.techSize}</span>
            </>
          ) : null}
        </h3>
        <button type="button" class="btn-load" onClick={onClose}>
          Закрыть
        </button>
      </div>
      <p class="muted redistribution-sku-network-lede">
        Те же строки «по складам WB», что и при расчёте: один артикул и размер, все склады сети.{" "}
        <span class="redistribution-badge redistribution-badge-donor">Донор</span> — выбранный склад-донор.{" "}
        {skuNetworkSelection.targetMacroRegion ? (
          <>
            <span class="redistribution-badge redistribution-badge-macro">Регион назначения</span> —
            склады в регионе из строки рекомендации;{" "}
            <span class="redistribution-badge redistribution-badge-target">Прим. склад</span> — склад с max
            «На WB» среди кандидатов в регионе (если есть).
          </>
        ) : (
          <>
            <span class="redistribution-badge redistribution-badge-target">Получатель</span> — склад из
            кликнутой строки (fulfillment).
          </>
        )}{" "}
        Строки с довозом на WB подсвечены (колонка «На WB» &gt; 0).
      </p>
      {skuNetworkLoading ? (
        <p class="muted">Загрузка складов…</p>
      ) : skuNetworkError ? (
        <p class="forecast-next-error" role="alert">
          {skuNetworkError}
        </p>
      ) : skuNetworkRows && skuNetworkRows.length > 0 ? (
        <div class="table-wrap">
          <table class="wb-redistribution-table redistribution-network-table">
            <thead>
              <tr>
                <th>Склад WB</th>
                <th>Локально</th>
                <th>В пути</th>
                <th>Всего на складе</th>
                <th>Спрос/день</th>
                <th>Дней запаса</th>
                <th>На WB</th>
                <th>OOS (дата)</th>
              </tr>
            </thead>
            <tbody>
              {skuNetworkRows.map((row) => {
                const isDonor = row.warehouseKey === donorKey.trim();
                const macroDest = skuNetworkSelection.targetMacroRegion?.trim();
                const rowMacro =
                  getWarehouseMacroRegion(row.warehouseKey) ?? UNMAPPED_WAREHOUSE_REGION_LABEL;
                const isInMacroDest = Boolean(macroDest) && rowMacro === macroDest && !isDonor;
                const isPreferredTarget =
                  Boolean(skuNetworkSelection.targetWarehouseKey.trim()) &&
                  row.warehouseKey === skuNetworkSelection.targetWarehouseKey.trim();
                const isTarget = skuNetworkSelection.targetMacroRegion
                  ? isPreferredTarget
                  : row.warehouseKey === skuNetworkSelection.targetWarehouseKey.trim();
                const need = row.recommendedToWB > 0;
                const rowClass = [
                  "redistribution-network-row",
                  isDonor ? "redistribution-network-row-donor" : "",
                  isTarget ? "redistribution-network-row-target" : "",
                  isInMacroDest && !isTarget ? "redistribution-network-row-macro" : "",
                  need ? "redistribution-network-row-need" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <tr key={row.warehouseKey} class={rowClass}>
                    <td>
                      {formatWarehouseRegionFirst(row.warehouseNameRaw, row.warehouseKey)}
                      <span class="muted wb-redistribution-key"> {row.warehouseKey}</span>
                      <div class="redistribution-network-badges">
                        {isDonor ? (
                          <span class="redistribution-badge redistribution-badge-donor">Донор</span>
                        ) : null}
                        {skuNetworkSelection.targetMacroRegion ? (
                          <>
                            {isInMacroDest ? (
                              <span class="redistribution-badge redistribution-badge-macro">
                                Регион назначения
                              </span>
                            ) : null}
                            {isTarget ? (
                              <span class="redistribution-badge redistribution-badge-target">
                                Прим. склад
                              </span>
                            ) : null}
                          </>
                        ) : isTarget ? (
                          <span class="redistribution-badge redistribution-badge-target">Получатель</span>
                        ) : null}
                      </div>
                    </td>
                    <td>{formatInt(row.localAvailable)}</td>
                    <td>{formatInt(row.incomingUnits)}</td>
                    <td>{formatInt(row.totalOnWarehouse)}</td>
                    <td>{formatNum(row.forecastDailyDemand)}</td>
                    <td>{formatNum(row.daysOfStock)}</td>
                    <td>{formatInt(row.recommendedToWB)}</td>
                    <td>{row.stockoutDate ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p class="muted">Нет строк по этому SKU.</p>
      )}
    </div>
  );
}
