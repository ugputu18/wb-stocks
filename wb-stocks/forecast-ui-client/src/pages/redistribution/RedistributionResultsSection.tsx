import type { JSX } from "preact";
import { formatInt, formatNum } from "../../utils/forecastFormat.js";
import {
  formatWarehouseRegionFirst,
} from "../../utils/wbWarehouseRegion.js";
import type { RankingMode, RedistributionRow } from "../../utils/wbRedistributionDonorModel.js";
import { RegionWarehousesDisclosure } from "../../components/redistribution/RegionWarehousesDisclosure.js";
import type { SkuNetworkSelection } from "./redistributionTypes.js";

export type RedistributionResultsSectionProps = {
  loading: boolean;
  error: string | null;
  resultNote: string | null;
  meta: { donorRowsLoaded: number; skuNetworksFetched: number } | null;
  results: RedistributionRow[];
  rankingMode: RankingMode;
  skuNetworkSelection: SkuNetworkSelection | null;
  openSkuRow: (r: RedistributionRow) => void;
};

export function RedistributionResultsSection(props: RedistributionResultsSectionProps): JSX.Element {
  const {
    loading,
    error,
    resultNote,
    meta,
    results,
    rankingMode,
    skuNetworkSelection,
    openSkuRow,
  } = props;

  return (
    <>
      {results.length > 0 ? (
        <section class="panel redistribution-results">
          <h2>
            Рекомендации (regional: дефицит → дни в регионе → спрос){" "}
            <span class="redistribution-ranking-pill" title="Активный режим ranking">
              {rankingMode === "fulfillment" ? "Fulfillment" : "Regional (рекомендуется)"}
            </span>
          </h2>
          <p class="muted redistribution-lede">
            {rankingMode === "fulfillment" ? (
              <>
                <strong>transferScore</strong> = перевод ×{" "}
                <strong>спрос/день по складу получателя</strong> (fulfillment).{" "}
              </>
            ) : (
              <>
                Цель — <strong>макрорегион</strong>; <strong>нехватка</strong> до покрытия с учётом Σ
                local в регионе; перевод = min(можно забрать, нехватка). Строки «донор и цель в одном
                макрорегионе» не показываются. <strong>transferScore</strong> = перевод × Σ
                regional/день.{" "}
              </>
            )}
            <strong>Клик по строке</strong> открывает сеть по SKU на всех складах WB.
          </p>
          <div class="table-wrap">
            <table class="wb-redistribution-table redistribution-wide">
              <thead>
                {rankingMode === "regional" ? (
                  <tr>
                    <th>Ранг</th>
                    <th>SKU / vendor</th>
                    <th>Донор local</th>
                    <th>Резерв (шт.)</th>
                    <th>Можно забрать</th>
                    <th>Макрорегион назначения</th>
                    <th>Σ regional / день</th>
                    <th>Σ в регионе</th>
                    <th>Дн. в регионе</th>
                    <th>Нехватка</th>
                    <th>Σ На WB (регион)</th>
                    <th>Прим. склад</th>
                    <th>Перевести</th>
                    <th>Score</th>
                  </tr>
                ) : (
                  <tr>
                    <th>Ранг</th>
                    <th>SKU / vendor</th>
                    <th>Донор local</th>
                    <th>Резерв (шт.)</th>
                    <th>Можно забрать</th>
                    <th>Куда (склад)</th>
                    <th>Спрос/день</th>
                    <th>Дн. запаса</th>
                    <th>На WB</th>
                    <th>Перевести</th>
                    <th>Score</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {rankingMode === "regional"
                  ? results.map((r) => {
                      if (r.kind !== "macro") return null;
                      const rk = `${r.nmId}-${r.techSize}-macro-${r.targetMacroRegion}-${r.priorityRank}`;
                      const skuFocus =
                        skuNetworkSelection &&
                        skuNetworkSelection.nmId === r.nmId &&
                        skuNetworkSelection.techSize === r.techSize;
                      const selected = skuNetworkSelection?.rowKey === rk;
                      const recRowClass = [
                        "redistribution-rec-row",
                        skuFocus ? "redistribution-rec-row-sku-focus" : "",
                        selected ? "redistribution-rec-row-selected" : "",
                      ]
                        .filter(Boolean)
                        .join(" ");
                      const prefLabel = r.preferredWarehouseKey
                        ? (() => {
                            const idx = r.candidateWarehouseKeys.indexOf(r.preferredWarehouseKey);
                            return idx >= 0 ? r.candidateWarehouseLabels[idx] : r.preferredWarehouseKey;
                          })()
                        : "—";
                      return (
                        <tr
                          key={rk}
                          class={recRowClass}
                          tabIndex={0}
                          role="button"
                          aria-expanded={Boolean(selected)}
                          aria-label={`Открыть сеть по SKU ${r.nmId}, регион ${r.targetMacroRegion}`}
                          onClick={() => openSkuRow(r)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openSkuRow(r);
                            }
                          }}
                        >
                          <td>{r.priorityRank}</td>
                          <td>
                            <span class="redistribution-sku">{r.nmId}</span> /{" "}
                            <span class="muted">{r.techSize}</span>
                            <div class="muted redistribution-vendor">{r.vendorCode}</div>
                          </td>
                          <td>{formatInt(r.donorLocalAvailable)}</td>
                          <td>{formatNum(r.donorReserveUnits)}</td>
                          <td>{formatInt(r.donorTransferableUnits)}</td>
                          <td class="redistribution-macro-td">
                            <div class="redistribution-macro-head">
                              <strong>{r.targetMacroRegion}</strong>
                              <RegionWarehousesDisclosure row={r} />
                            </div>
                            <div class="muted redistribution-macro-hint">
                              {r.candidateWarehouseKeys.length
                                ? `${r.candidateWarehouseKeys.length} склад(ов) в регионе · нажмите «Склады»`
                                : "нет складов в сети по маппингу"}
                            </div>
                          </td>
                          <td>{formatNum(r.targetRegionalDemand)}</td>
                          <td>{formatInt(r.regionalAvailableUnits)}</td>
                          <td title="Σ local в макрорегионе / Σ regional/день">
                            {formatNum(r.regionalDaysOfStock)}
                          </td>
                          <td title="ceil(целевой запас до покрытия − Σ local в регионе)">
                            {formatInt(r.regionalNeedUnits)}
                          </td>
                          <td>{formatInt(r.sumRecommendedToWBInRegion)}</td>
                          <td class="redistribution-pref-warehouse">
                            {prefLabel}
                            {r.preferredWarehouseKey ? (
                              <span class="muted wb-redistribution-key"> {r.preferredWarehouseKey}</span>
                            ) : null}
                          </td>
                          <td>
                            <strong>{formatInt(r.recommendedTransferUnitsToRegion)}</strong>
                          </td>
                          <td title="transferScore = перевод × Σ regional/день; сортировка: дни в регионе ↑, спрос ↓, score ↓">
                            {formatNum(r.transferScore)}
                          </td>
                        </tr>
                      );
                    })
                  : results.map((r) => {
                      if (r.kind !== "warehouse") return null;
                      const rk = `${r.nmId}-${r.techSize}-${r.targetWarehouseKey}-${r.priorityRank}`;
                      const skuFocus =
                        skuNetworkSelection &&
                        skuNetworkSelection.nmId === r.nmId &&
                        skuNetworkSelection.techSize === r.techSize;
                      const selected = skuNetworkSelection?.rowKey === rk;
                      const recRowClass = [
                        "redistribution-rec-row",
                        skuFocus ? "redistribution-rec-row-sku-focus" : "",
                        selected ? "redistribution-rec-row-selected" : "",
                      ]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <tr
                          key={rk}
                          class={recRowClass}
                          tabIndex={0}
                          role="button"
                          aria-expanded={Boolean(selected)}
                          aria-label={`Открыть сеть по SKU ${r.nmId} для склада ${r.targetWarehouseNameRaw}`}
                          onClick={() => openSkuRow(r)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openSkuRow(r);
                            }
                          }}
                        >
                          <td>{r.priorityRank}</td>
                          <td>
                            <span class="redistribution-sku">{r.nmId}</span> /{" "}
                            <span class="muted">{r.techSize}</span>
                            <div class="muted redistribution-vendor">{r.vendorCode}</div>
                          </td>
                          <td>{formatInt(r.donorLocalAvailable)}</td>
                          <td>{formatNum(r.donorReserveUnits)}</td>
                          <td>{formatInt(r.donorTransferableUnits)}</td>
                          <td>
                            {formatWarehouseRegionFirst(
                              r.targetWarehouseNameRaw,
                              r.targetWarehouseKey,
                            )}
                            <span class="muted wb-redistribution-key"> {r.targetWarehouseKey}</span>
                          </td>
                          <td>{formatNum(r.targetForecastDailyDemand)}</td>
                          <td>{formatNum(r.targetDaysOfStock)}</td>
                          <td>{formatInt(r.targetRecommendedToWB)}</td>
                          <td>
                            <strong>{formatInt(r.recommendedTransferUnits)}</strong>
                          </td>
                          <td title="transferScore = перевод × спрос/день по складу">
                            {formatNum(r.transferScore)}
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!loading && results.length === 0 && !error && !resultNote && !meta ? (
        <p class="muted redistribution-empty-hint">
          Выберите склад-донор и нажмите «Подобрать перемещения». Список складов выше показывает
          суммарный <strong>localAvailable</strong> по строкам прогноза (до лимита) — ориентир
          избытка.
        </p>
      ) : null}
    </>
  );
}
