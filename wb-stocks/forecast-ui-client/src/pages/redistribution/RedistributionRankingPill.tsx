import type { JSX } from "preact";
import { rankingPill } from "../../../styled-system/recipes";
import type { RankingMode } from "../../utils/wbRedistributionDonorModel.js";

export function RedistributionRankingPill({
  rankingMode,
}: {
  rankingMode: RankingMode;
}): JSX.Element {
  return (
    <span class={rankingPill()} title="Активный режим ranking">
      {rankingMode === "fulfillment" ? "Fulfillment" : "Regional (рекомендуется)"}
    </span>
  );
}
