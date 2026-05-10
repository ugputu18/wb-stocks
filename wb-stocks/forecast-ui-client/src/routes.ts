/**
 * Единый публичный модуль маршрутов forecast UI — импортируйте отсюда в клиенте (`./routes.js` / `../routes.js`).
 * Значения и хелперы задаются в `wb-stocks/src/forecastUiRoutes.ts` (тот же модуль подключает HTTP-сервер).
 */

export type { ForecastUiSpaPath } from "../../src/forecastUiRoutes.js";
export {
  FORECAST_UI_SPA_PATHS,
  FORECAST_UI_SPA_ROUTES,
  HOME_ROUTE,
  REDISTRIBUTION_ROUTE,
  REGIONAL_STOCKS_ROUTE,
  REGIONAL_DEMAND_DIAGNOSTICS_ROUTE,
  WAREHOUSE_REGION_AUDIT_ROUTE,
  isForecastUiSpaPath,
  isKnownForecastRoute,
  normalizeForecastUiPathname,
} from "../../src/forecastUiRoutes.js";
