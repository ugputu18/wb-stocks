import { describe, expect, it } from "vitest";
import {
  FORECAST_UI_SPA_ROUTES,
  isForecastUiSpaPath,
  isKnownForecastRoute,
  normalizeForecastUiPathname,
} from "../src/routes.js";

describe("forecast UI route registry (client)", () => {
  it("keeps stable paths for bookmarks", () => {
    expect(FORECAST_UI_SPA_ROUTES.home).toBe("/");
    expect(FORECAST_UI_SPA_ROUTES.redistribution).toBe("/redistribution");
    expect(FORECAST_UI_SPA_ROUTES.warehouseRegionAudit).toBe("/warehouse-region-audit");
    expect(FORECAST_UI_SPA_ROUTES.regionalDemandDiagnostics).toBe("/regional-demand-diagnostics");
  });

  it("isKnownForecastRoute matches server behavior", () => {
    expect(isKnownForecastRoute("/")).toBe(true);
    expect(isForecastUiSpaPath("/regional-demand-diagnostics/")).toBe(true);
    expect(normalizeForecastUiPathname("/regional-demand-diagnostics/")).toBe(
      "/regional-demand-diagnostics",
    );
  });
});
