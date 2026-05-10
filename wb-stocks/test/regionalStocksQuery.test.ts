import { describe, expect, it } from "vitest";
import { parseRegionalStocksQuery } from "../src/server/forecast-ui/parse/forecastQuery.js";

function url(search: string): URL {
  return new URL(`http://127.0.0.1/api/forecast/regional-stocks?${search}`);
}

describe("parseRegionalStocksQuery", () => {
  it("accepts required regional stocks params and defaults target coverage to 42", () => {
    const q = parseRegionalStocksQuery(
      url("snapshotDate=2026-04-18&horizonDays=10&macroRegion=Центральный"),
    );
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.horizonDays).toBe(10);
    expect(q.targetCoverageDays).toBe(42);
    expect(q.riskStockout).toBe("all");
    expect(q.limit).toBe(500);
  });

  it("accepts 30/42/60 target coverage only", () => {
    expect(
      parseRegionalStocksQuery(
        url("snapshotDate=2026-04-18&horizonDays=5&macroRegion=Центральный&targetCoverageDays=60"),
      ).ok,
    ).toBe(true);
    const bad = parseRegionalStocksQuery(
      url("snapshotDate=2026-04-18&horizonDays=20&macroRegion=Центральный&targetCoverageDays=45"),
    );
    expect(bad.ok).toBe(false);
  });

  it("validates snapshot, horizon, and macroRegion", () => {
    expect(parseRegionalStocksQuery(url("horizonDays=10&macroRegion=Центральный")).ok).toBe(false);
    expect(
      parseRegionalStocksQuery(
        url("snapshotDate=2026-04-18&horizonDays=30&macroRegion=Центральный"),
      ).ok,
    ).toBe(false);
    expect(
      parseRegionalStocksQuery(url("snapshotDate=2026-04-18&horizonDays=10")).ok,
    ).toBe(false);
  });
});
