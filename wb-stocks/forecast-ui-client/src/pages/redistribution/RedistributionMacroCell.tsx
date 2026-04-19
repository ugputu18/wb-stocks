import type { JSX } from "preact";
import { macroRegionHead, macroRegionTd } from "../../../styled-system/recipes";
import { RegionWarehousesDisclosure } from "../../components/redistribution/RegionWarehousesDisclosure.js";
import type { DonorMacroRegionRecommendation } from "../../utils/wbRedistributionDonorModel.js";

export function RedistributionMacroCell({
  row,
}: {
  row: DonorMacroRegionRecommendation;
}): JSX.Element {
  return (
    <td class={macroRegionTd()}>
      <div class={macroRegionHead()}>
        <strong>{row.targetMacroRegion}</strong>
        <RegionWarehousesDisclosure row={row} />
      </div>
    </td>
  );
}
