import { describe, expect, it } from "vitest";
import {
  FORECAST_UI_SPA_ROUTES,
  HOME_ROUTE,
  isForecastUiSpaPath,
  isKnownForecastRoute,
  normalizeForecastUiPathname,
  REDISTRIBUTION_ROUTE,
  REGIONAL_STOCKS_ROUTE,
} from "../forecast-ui-client/src/routes.js";

describe("forecast UI routes (shared with server re-export)", () => {
  it("normalizes pathnames", () => {
    expect(normalizeForecastUiPathname("/")).toBe("/");
    expect(normalizeForecastUiPathname("/redistribution/")).toBe(REDISTRIBUTION_ROUTE);
    expect(normalizeForecastUiPathname("/regional-stocks/")).toBe(REGIONAL_STOCKS_ROUTE);
    expect(normalizeForecastUiPathname("/warehouse-region-audit")).toBe("/warehouse-region-audit");
  });

  it("isKnownForecastRoute / isForecastUiSpaPath match SPA roots", () => {
    expect(isKnownForecastRoute("/")).toBe(true);
    expect(isForecastUiSpaPath("/")).toBe(true);
    expect(isKnownForecastRoute("/redistribution")).toBe(true);
    expect(isKnownForecastRoute("/redistribution/")).toBe(true);
    expect(isKnownForecastRoute("/regional-stocks")).toBe(true);
    expect(isKnownForecastRoute("/warehouse-region-audit")).toBe(true);
    expect(isKnownForecastRoute("/regional-demand-diagnostics")).toBe(true);
    expect(isKnownForecastRoute("/legacy")).toBe(false);
    expect(isKnownForecastRoute("/api/forecast/rows")).toBe(false);
  });

  it("registry constants stay stable", () => {
    expect(HOME_ROUTE).toBe("/");
    expect(FORECAST_UI_SPA_ROUTES.home).toBe(HOME_ROUTE);
    expect(FORECAST_UI_SPA_ROUTES.redistribution).toBe("/redistribution");
    expect(FORECAST_UI_SPA_ROUTES.regionalStocks).toBe("/regional-stocks");
    expect(FORECAST_UI_SPA_ROUTES.warehouseRegionAudit).toBe("/warehouse-region-audit");
    expect(FORECAST_UI_SPA_ROUTES.regionalDemandDiagnostics).toBe("/regional-demand-diagnostics");
  });
});
