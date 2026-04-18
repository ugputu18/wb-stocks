import type { ForecastViewMode } from "../api/types.js";

export type DetailViewKind = "wbTotal" | "systemTotal" | "wbWarehouses";

export function resolveDetailViewKind(
  viewMode: ForecastViewMode,
  row: Record<string, unknown>,
): DetailViewKind {
  if (viewMode === "wbWarehouses") return "wbWarehouses";
  const vk = row.viewKind;
  if (vk === "systemTotal" || vk === "wbTotal") return vk;
  return viewMode === "systemTotal" ? "systemTotal" : "wbTotal";
}
