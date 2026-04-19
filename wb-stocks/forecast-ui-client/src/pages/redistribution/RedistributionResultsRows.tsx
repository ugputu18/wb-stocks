import type { JSX } from "preact";
import { prefWarehouseTd } from "../../../styled-system/recipes";
import { formatInt, formatNum } from "../../utils/forecastFormat.js";
import { formatWarehouseRegionFirst } from "../../utils/wbWarehouseRegion.js";
import type {
  DonorMacroRegionRecommendation,
  DonorWarehouseRecommendation,
  RedistributionRow,
} from "../../utils/wbRedistributionDonorModel.js";
import { recommendationRowClass } from "./redistributionResultsRowClass.js";
import { RedistributionMacroCell } from "./RedistributionMacroCell.js";
import type { SkuNetworkSelection } from "./redistributionTypes.js";

function SkuVendorCells(props: {
  nmId: number;
  techSize: string;
  vendorCode: string;
}): JSX.Element {
  const { nmId, techSize, vendorCode } = props;
  return (
    <td>
      <span class="redistribution-sku">{nmId}</span> / <span class="muted">{techSize}</span>
      <div class="muted redistribution-vendor">{vendorCode}</div>
    </td>
  );
}

export function RegionalRecommendationRow(props: {
  row: DonorMacroRegionRecommendation;
  skuNetworkSelection: SkuNetworkSelection | null;
  openSkuRow: (r: RedistributionRow) => void;
}): JSX.Element {
  const { row: r, skuNetworkSelection, openSkuRow } = props;
  const rk = `${r.nmId}-${r.techSize}-macro-${r.targetMacroRegion}-${r.priorityRank}`;
  const skuFocus =
    skuNetworkSelection &&
    skuNetworkSelection.nmId === r.nmId &&
    skuNetworkSelection.techSize === r.techSize;
  const selected = skuNetworkSelection?.rowKey === rk;
  const recRowClass = recommendationRowClass(Boolean(skuFocus), Boolean(selected));
  const prefLabel = r.preferredWarehouseKey
    ? (() => {
        const idx = r.candidateWarehouseKeys.indexOf(r.preferredWarehouseKey);
        return idx >= 0 ? r.candidateWarehouseLabels[idx] : r.preferredWarehouseKey;
      })()
    : "—";

  return (
    <tr
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
      <SkuVendorCells nmId={r.nmId} techSize={r.techSize} vendorCode={r.vendorCode} />
      <td>{formatInt(r.donorLocalAvailable)}</td>
      <td>{formatNum(r.donorReserveUnits)}</td>
      <td>{formatInt(r.donorTransferableUnits)}</td>
      <RedistributionMacroCell row={r} />
      <td>{formatNum(r.targetRegionalDemand)}</td>
      <td>{formatInt(r.regionalAvailableUnits)}</td>
      <td title="Σ local в регионе / Σ regional/день">
        {formatNum(r.regionalDaysOfStock)}
      </td>
      <td title="ceil(целевой запас до покрытия − Σ local в регионе)">{formatInt(r.regionalNeedUnits)}</td>
      <td>{formatInt(r.sumRecommendedToWBInRegion)}</td>
      <td class={prefWarehouseTd()}>
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
}

export function FulfillmentRecommendationRow(props: {
  row: DonorWarehouseRecommendation;
  skuNetworkSelection: SkuNetworkSelection | null;
  openSkuRow: (r: RedistributionRow) => void;
}): JSX.Element {
  const { row: r, skuNetworkSelection, openSkuRow } = props;
  const rk = `${r.nmId}-${r.techSize}-${r.targetWarehouseKey}-${r.priorityRank}`;
  const skuFocus =
    skuNetworkSelection &&
    skuNetworkSelection.nmId === r.nmId &&
    skuNetworkSelection.techSize === r.techSize;
  const selected = skuNetworkSelection?.rowKey === rk;
  const recRowClass = recommendationRowClass(Boolean(skuFocus), Boolean(selected));

  return (
    <tr
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
      <SkuVendorCells nmId={r.nmId} techSize={r.techSize} vendorCode={r.vendorCode} />
      <td>{formatInt(r.donorLocalAvailable)}</td>
      <td>{formatNum(r.donorReserveUnits)}</td>
      <td>{formatInt(r.donorTransferableUnits)}</td>
      <td>
        {formatWarehouseRegionFirst(r.targetWarehouseNameRaw, r.targetWarehouseKey)}
        <span class="muted wb-redistribution-key"> {r.targetWarehouseKey}</span>
      </td>
      <td>{formatNum(r.targetForecastDailyDemand)}</td>
      <td>{formatNum(r.targetDaysOfStock)}</td>
      <td>{formatInt(r.targetRecommendedToWB)}</td>
      <td>
        <strong>{formatInt(r.recommendedTransferUnits)}</strong>
      </td>
      <td title="transferScore = перевод × спрос/день по складу">{formatNum(r.transferScore)}</td>
    </tr>
  );
}
