import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { buildForecastUiSpaHealthRoutes } from "../src/server/forecast-ui/routes/buildForecastUiRoutes.js";

describe("forecast UI route registry (smoke)", () => {
  it("includes a handler for GET /api/forecast/health", () => {
    const routes = buildForecastUiSpaHealthRoutes();
    const req = { method: "GET" } as IncomingMessage;
    const url = new URL("http://127.0.0.1/api/forecast/health");
    expect(routes.some((r) => r.match(req, url))).toBe(true);
  });

  it("SPA/static table is non-empty", () => {
    expect(buildForecastUiSpaHealthRoutes().length).toBeGreaterThan(0);
  });
});
