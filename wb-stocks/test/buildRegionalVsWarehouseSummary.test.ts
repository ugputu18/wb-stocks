import { describe, expect, it } from "vitest";
import { buildRegionalVsWarehouseSummary } from "../src/application/buildRegionalVsWarehouseSummary.js";
import {
  buildRegionMacroLookup,
  UNMAPPED_REGION_MACRO_REGION,
} from "../src/domain/wbRegionMacroRegion.js";

describe("buildRegionalVsWarehouseSummary", () => {
  it("aggregates regional by macro, fulfillment by macro, and sorts comparison by |gapShare|", () => {
    const lookup = buildRegionMacroLookup([
      { regionKey: "москва", macroRegion: "Центральный" },
      { regionKey: "новосибирск", macroRegion: "Сибирский и Дальневосточный" },
    ]);
    const out = buildRegionalVsWarehouseSummary({
      snapshotDate: "2026-04-18",
      horizonDays: 30,
      regionalByRegion: [
        {
          regionKey: "москва",
          regionNameRaw: "Москва",
          regionalForecastDailyDemand: 100,
        },
        {
          regionKey: "новосибирск",
          regionNameRaw: "Новосибирск",
          regionalForecastDailyDemand: 50,
        },
        {
          regionKey: "<no-region>",
          regionNameRaw: null,
          regionalForecastDailyDemand: 10,
        },
      ],
      warehouseMetrics: [
        { warehouseKey: "коледино", sumForecastDailyDemand: 80 },
        { warehouseKey: "новосибирск", sumForecastDailyDemand: 40 },
      ],
      regionMacroLookup: lookup,
    });

    expect(out.totals.regionalTotalDemand).toBe(160);
    expect(out.totals.regionalMappedDemand).toBe(150);
    expect(out.totals.regionalMappedShareOfRegional).toBeCloseTo(150 / 160, 10);
    expect(out.totals.regionalUnmappedDemand).toBe(10);
    expect(out.totals.regionalUnmappedShareOfRegional).toBeCloseTo(10 / 160, 10);
    expect(out.unmappedRegionalTotals).toHaveLength(1);
    expect(out.unmappedRegionalTotals[0]!.regionKey).toBe("<no-region>");

    const central = out.comparisonByMacroRegion.find((r) => r.macroRegion === "Центральный");
    expect(central?.regionalDemand).toBe(100);
    expect(central?.fulfillmentDemand).toBe(80);

    const sorted = [...out.comparisonByMacroRegion];
    const byAbs = [...sorted].sort(
      (a, b) => Math.abs(b.gapShare) - Math.abs(a.gapShare),
    );
    expect(out.comparisonByMacroRegion.map((r) => r.macroRegion)).toEqual(
      byAbs.map((r) => r.macroRegion),
    );
  });

  it("top russian regions from bootstrap are not unmapped when DB empty", () => {
    const lookup = buildRegionMacroLookup([]);
    const out = buildRegionalVsWarehouseSummary({
      snapshotDate: "2026-04-18",
      horizonDays: 30,
      regionalByRegion: [
        {
          regionKey: "москва",
          regionNameRaw: "Москва",
          regionalForecastDailyDemand: 100,
        },
        {
          regionKey: "санкт-петербург",
          regionNameRaw: "Санкт-Петербург",
          regionalForecastDailyDemand: 50,
        },
      ],
      warehouseMetrics: [],
      regionMacroLookup: lookup,
    });
    expect(out.unmappedRegionalTotals).toHaveLength(0);
    expect(out.totals.regionalUnmappedDemand).toBe(0);
    expect(out.totals.regionalMappedShareOfRegional).toBe(1);
  });

  it("maps unknown region key to UNMAPPED macro bucket", () => {
    const lookup = buildRegionMacroLookup([]);
    const out = buildRegionalVsWarehouseSummary({
      snapshotDate: "2026-04-18",
      horizonDays: 30,
      regionalByRegion: [
        { regionKey: "unknown-region-xyz", regionNameRaw: "X", regionalForecastDailyDemand: 5 },
      ],
      warehouseMetrics: [],
      regionMacroLookup: lookup,
    });
    expect(
      out.comparisonByMacroRegion.some((r) => r.macroRegion === UNMAPPED_REGION_MACRO_REGION),
    ).toBe(true);
  });
});
