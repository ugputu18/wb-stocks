import type { ForecastViewMode } from "../api/types.js";

/** Align with legacy `renderSummary` / `renderRows` viewMode normalization. */
export function normalizeRowsViewMode(raw: string | undefined | null): ForecastViewMode {
  if (raw === "wbWarehouses") return "wbWarehouses";
  if (raw === "systemTotal") return "systemTotal";
  return "wbTotal";
}
