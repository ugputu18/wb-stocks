/**
 * Реализация маршрутов forecast UI (Preact SPA). Публичный entry в клиенте: `forecast-ui-client/src/routes.ts`.
 */

export const HOME_ROUTE = "/";
export const REDISTRIBUTION_ROUTE = "/redistribution";
export const WAREHOUSE_REGION_AUDIT_ROUTE = "/warehouse-region-audit";
export const REGIONAL_DEMAND_DIAGNOSTICS_ROUTE = "/regional-demand-diagnostics";

export const FORECAST_UI_SPA_ROUTES = {
  home: HOME_ROUTE,
  redistribution: REDISTRIBUTION_ROUTE,
  warehouseRegionAudit: WAREHOUSE_REGION_AUDIT_ROUTE,
  regionalDemandDiagnostics: REGIONAL_DEMAND_DIAGNOSTICS_ROUTE,
} as const;

export const FORECAST_UI_SPA_PATHS = [
  REDISTRIBUTION_ROUTE,
  WAREHOUSE_REGION_AUDIT_ROUTE,
  REGIONAL_DEMAND_DIAGNOSTICS_ROUTE,
] as const;

export type ForecastUiSpaPath = (typeof FORECAST_UI_SPA_PATHS)[number];

export function normalizeForecastUiPathname(pathname: string): string {
  const t = pathname.trim();
  if (!t || t === "/") return "/";
  return t.replace(/\/+$/, "") || "/";
}

export function isKnownForecastRoute(pathname: string): boolean {
  const p = normalizeForecastUiPathname(pathname);
  if (p === HOME_ROUTE) return true;
  return (FORECAST_UI_SPA_PATHS as readonly string[]).includes(p);
}

export function isForecastUiSpaPath(pathname: string): boolean {
  return isKnownForecastRoute(pathname);
}
