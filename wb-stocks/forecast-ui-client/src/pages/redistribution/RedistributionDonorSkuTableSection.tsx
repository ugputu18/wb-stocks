import type { JSX } from "preact";
import { formatInt, formatNum } from "../../utils/forecastFormat.js";
import { donorSkuKey, type DonorSkuTableRow } from "../../utils/donorSkuTableRows.js";
import type { SkuNetworkSelection } from "./redistributionTypes.js";

export type RedistributionDonorSkuTableSectionProps = {
  donorSummaryLoading: boolean;
  donorSummaryError: string | null;
  donorRowsRaw: unknown[] | null;
  donorSkuTableRows: DonorSkuTableRow[];
  skuNetworkSelection: SkuNetworkSelection | null;
  openSkuFromDonorTable: (row: DonorSkuTableRow) => void;
};

export function RedistributionDonorSkuTableSection(
  props: RedistributionDonorSkuTableSectionProps,
): JSX.Element {
  const {
    donorSummaryLoading,
    donorSummaryError,
    donorRowsRaw,
    donorSkuTableRows,
    skuNetworkSelection,
    openSkuFromDonorTable,
  } = props;

  return (
    <section class="panel redistribution-donor-skus" aria-live="polite">
      <h2>Товары донора</h2>
      <p class="muted redistribution-donor-skus-lede">
        Все SKU×размер по строкам прогноза на выбранном складе. Резерв и «можно снять» считаются так же,
        как для «Подобрать перемещения». Клик по строке открывает сеть по SKU и подсвечивает этот артикул
        в таблице рекомендаций (если они уже посчитаны).
      </p>
      {donorSummaryLoading ? (
        <p class="muted">Загрузка списка SKU…</p>
      ) : donorSummaryError ? (
        <p class="muted">Таблица недоступна из‑за ошибки загрузки (см. блок сводки выше).</p>
      ) : donorRowsRaw && donorRowsRaw.length === 0 ? (
        <p class="redistribution-donor-skus-empty" role="status">
          На выбранном складе нет SKU с данными для перераспределения.
        </p>
      ) : donorSkuTableRows.length > 0 ? (
        <div class="table-wrap">
          <table class="wb-redistribution-table redistribution-donor-skus-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>nm_id</th>
                <th>Размер</th>
                <th>Локально</th>
                <th>В пути</th>
                <th>Всего на складе</th>
                <th>Спрос/день</th>
                <th>Дней запаса</th>
                <th>Резерв (шт.)</th>
                <th>Можно снять</th>
              </tr>
            </thead>
            <tbody>
              {donorSkuTableRows.map((row) => {
                const netSel = skuNetworkSelection;
                const skuK = donorSkuKey(row.nmId, row.techSize);
                const rowActive =
                  netSel && netSel.nmId === row.nmId && netSel.techSize === row.techSize;
                const rowClass = rowActive
                  ? "redistribution-donor-sku-row redistribution-donor-sku-row-active"
                  : "redistribution-donor-sku-row";
                return (
                  <tr
                    key={skuK}
                    class={rowClass}
                    tabIndex={0}
                    role="button"
                    aria-expanded={rowActive ?? false}
                    aria-label={`Открыть сеть по SKU ${row.nmId}`}
                    onClick={() => openSkuFromDonorTable(row)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openSkuFromDonorTable(row);
                      }
                    }}
                  >
                    <td class="redistribution-donor-vendor">{row.vendorCode || "—"}</td>
                    <td>
                      <span class="redistribution-sku">{row.nmId}</span>
                    </td>
                    <td>{row.techSize || "—"}</td>
                    <td>{formatInt(row.localAvailable)}</td>
                    <td>{formatInt(row.incomingUnits)}</td>
                    <td>{formatInt(row.totalOnWarehouse)}</td>
                    <td>{formatNum(row.forecastDailyDemand)}</td>
                    <td>{formatNum(row.daysOfStock)}</td>
                    <td>{formatNum(row.donorReserveUnits)}</td>
                    <td>
                      <strong>{formatInt(row.donorTransferableUnits)}</strong>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
