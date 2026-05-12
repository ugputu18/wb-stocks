/**
 * Единый реестр кастомных pathname forecast UI (Preact SPA, `index.html`).
 * Сервер: `wb-stocks/src/forecastUiRoutes.ts` реэкспортирует отсюда же значения.
 */
export const HOME_ROUTE = "/";
export const REDISTRIBUTION_ROUTE = "/redistribution";
export const REGIONAL_STOCKS_ROUTE = "/regional-stocks";
export const WAREHOUSE_REGION_AUDIT_ROUTE = "/warehouse-region-audit";
export const REGIONAL_DEMAND_DIAGNOSTICS_ROUTE = "/regional-demand-diagnostics";
/** Удобный объект для ссылок и сравнения в роутере. */
export const FORECAST_UI_SPA_ROUTES = {
    home: HOME_ROUTE,
    redistribution: REDISTRIBUTION_ROUTE,
    regionalStocks: REGIONAL_STOCKS_ROUTE,
    warehouseRegionAudit: WAREHOUSE_REGION_AUDIT_ROUTE,
    regionalDemandDiagnostics: REGIONAL_DEMAND_DIAGNOSTICS_ROUTE,
};
/** Пути кроме {@link HOME_ROUTE}, для которых отдаётся тот же `index.html`. */
export const FORECAST_UI_SPA_PATHS = [
    REDISTRIBUTION_ROUTE,
    REGIONAL_STOCKS_ROUTE,
    WAREHOUSE_REGION_AUDIT_ROUTE,
    REGIONAL_DEMAND_DIAGNOSTICS_ROUTE,
];
export function normalizeForecastUiPathname(pathname) {
    const t = pathname.trim();
    if (!t || t === "/")
        return "/";
    return t.replace(/\/+$/, "") || "/";
}
/** `true` для `/` и известных кастомных страниц forecast UI (не `/api`). */
export function isKnownForecastRoute(pathname) {
    const p = normalizeForecastUiPathname(pathname);
    if (p === HOME_ROUTE)
        return true;
    return FORECAST_UI_SPA_PATHS.includes(p);
}
/** Синоним {@link isKnownForecastRoute} — используется в HTTP-сервере. */
export function isForecastUiSpaPath(pathname) {
    return isKnownForecastRoute(pathname);
}
