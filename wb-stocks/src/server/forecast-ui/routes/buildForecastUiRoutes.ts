import type { ForecastUiHandlerDeps } from "../types.js";
import type { ForecastUiServerCtx } from "../forecastUiServerCtx.js";
import { createDiagnosticsRoutes } from "../handlers/diagnosticsRoutes.js";
import { createExportRoutes } from "../handlers/exportRoutes.js";
import { createForecastReadRoutes } from "../handlers/forecastReadRoutes.js";
import { createHealthRoute } from "../handlers/healthRoute.js";
import { createRecalculateRoute } from "../handlers/recalculateRoute.js";
import { createSpaStaticRoutes } from "../handlers/spaStaticRoutes.js";
import type { ForecastRouteMatch } from "./routeTypes.js";

/** SPA + static + health — без `WbForecastSnapshotRepository` (как раньше до строки с `forecastRepo`). */
export function buildForecastUiSpaHealthRoutes(): ForecastRouteMatch[] {
  return [...createSpaStaticRoutes(), createHealthRoute()];
}

/**
 * Остальные `/api/forecast/*` — после создания `forecastRepo` на запрос (как в исходном `forecastUiServer.ts`).
 */
export function buildForecastUiApiRoutes(
  ctx: ForecastUiServerCtx,
  apiDeps: ForecastUiHandlerDeps,
): ForecastRouteMatch[] {
  return [
    ...createForecastReadRoutes(apiDeps),
    ...createDiagnosticsRoutes(apiDeps),
    ...createExportRoutes(apiDeps),
    createRecalculateRoute(ctx),
  ];
}
