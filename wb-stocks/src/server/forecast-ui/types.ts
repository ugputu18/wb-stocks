import type { WbForecastSnapshotRepository } from "../../infra/wbForecastSnapshotRepository.js";
import type { ForecastUiServerCtx } from "./forecastUiServerCtx.js";

/** Per-request deps for `/api/forecast/*` after static + health (matches previous `forecastRepo` scope). */
export type ForecastUiHandlerDeps = ForecastUiServerCtx & {
  forecastRepo: WbForecastSnapshotRepository;
};

export type { ForecastUiServerCtx };
