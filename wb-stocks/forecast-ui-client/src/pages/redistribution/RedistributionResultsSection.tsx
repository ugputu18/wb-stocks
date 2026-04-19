import type { JSX } from "preact";
import { resultsLede, sectionHeadingRow } from "../../../styled-system/recipes";
import { Panel } from "../../components/ui/Panel.js";
import { DenseDataTable } from "../../components/ui/DenseDataTable.js";
import { ScrollTableWrap } from "../../components/ui/ScrollTableWrap.js";
import { SectionHeading } from "../../components/ui/SectionHeading.js";
import { cn } from "../../components/ui/cn.js";
import type { RankingMode, RedistributionRow } from "../../utils/wbRedistributionDonorModel.js";
import { RedistributionRankingPill } from "./RedistributionRankingPill.js";
import {
  FulfillmentRecommendationRow,
  RegionalRecommendationRow,
} from "./RedistributionResultsRows.js";
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
  const { loading, error, resultNote, meta, results, rankingMode, skuNetworkSelection, openSkuRow } =
    props;

  return (
    <>
      {results.length > 0 ? (
        <Panel>
          <SectionHeading as="h2" class={sectionHeadingRow()}>
            <span>
              Рекомендации (regional: дефицит → дни в регионе → спрос){" "}
            </span>
            <RedistributionRankingPill rankingMode={rankingMode} />
          </SectionHeading>
          <p class={cn(resultsLede())}>
            {rankingMode === "fulfillment" ? (
              <>
                <strong>transferScore</strong> = перевод ×{" "}
                <strong>спрос/день по складу получателя</strong> (fulfillment).{" "}
              </>
            ) : (
              <>
                Цель — <strong>регион</strong>; <strong>нехватка</strong> до покрытия с учётом Σ
                local в регионе; перевод = min(можно забрать, нехватка). Строки «донор и цель в одном
                регионе» не показываются. <strong>transferScore</strong> = перевод × Σ
                regional/день.{" "}
              </>
            )}
            <strong>Клик по строке</strong> открывает сеть по SKU на всех складах WB.
          </p>
          <ScrollTableWrap class="table-wrap">
            <DenseDataTable>
              <thead>
                {rankingMode === "regional" ? (
                  <tr>
                    <th>Ранг</th>
                    <th>SKU / vendor</th>
                    <th>Донор local</th>
                    <th>Резерв (шт.)</th>
                    <th>Можно забрать</th>
                    <th>Регион назначения</th>
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
                      const rowKey = `${r.nmId}-${r.techSize}-macro-${r.targetMacroRegion}-${r.priorityRank}`;
                      return (
                        <RegionalRecommendationRow
                          key={rowKey}
                          row={r}
                          skuNetworkSelection={skuNetworkSelection}
                          openSkuRow={openSkuRow}
                        />
                      );
                    })
                  : results.map((r) => {
                      if (r.kind !== "warehouse") return null;
                      const rowKey = `${r.nmId}-${r.techSize}-${r.targetWarehouseKey}-${r.priorityRank}`;
                      return (
                        <FulfillmentRecommendationRow
                          key={rowKey}
                          row={r}
                          skuNetworkSelection={skuNetworkSelection}
                          openSkuRow={openSkuRow}
                        />
                      );
                    })}
              </tbody>
            </DenseDataTable>
          </ScrollTableWrap>
        </Panel>
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
