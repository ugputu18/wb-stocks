import { describe, expect, it } from "vitest";
import { buildRegionalStocksReport } from "../src/application/buildRegionalStocksReport.js";
import { buildRegionMacroLookup } from "../src/domain/wbRegionMacroRegion.js";

const lookup = buildRegionMacroLookup([
  { regionKey: "buyer-central", macroRegion: "Центральный" },
  { regionKey: "buyer-volga", macroRegion: "Приволжский" },
]);

describe("buildRegionalStocksReport", () => {
  it("combines buyer-region demand with regional WB stock + incoming", () => {
    const out = buildRegionalStocksReport({
      snapshotDate: "2026-04-18",
      horizonDays: 30,
      macroRegion: "Центральный",
      targetCoverageDays: 42,
      stockRows: [
        {
          warehouseKey: "коледино",
          nmId: 1,
          techSize: "0",
          vendorCode: "A",
          startStock: 20,
          incomingUnits: 10,
          stockSnapshotAt: "2026-04-18T00:00:00Z",
        },
      ],
      demandRows: [
        {
          regionKey: "buyer-central",
          nmId: 1,
          techSize: "0",
          vendorCode: "A",
          regionalForecastDailyDemand: 10,
        },
      ],
      regionMacroLookup: lookup,
    });

    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.regionalAvailable).toBe(30);
    expect(out.rows[0]!.daysOfStockRegional).toBe(3);
    expect(out.rows[0]!.stockoutDateEstimate).toBe("2026-04-21");
    expect(out.rows[0]!.recommendedToRegion).toBe(390);
    expect(out.summary.recommendedToRegionTotal).toBe(390);
  });

  it("changes recommendation when target coverage changes", () => {
    const base = {
      snapshotDate: "2026-04-18",
      horizonDays: 30,
      macroRegion: "Центральный",
      stockRows: [
        {
          warehouseKey: "коледино",
          nmId: 1,
          techSize: "0",
          vendorCode: "A",
          startStock: 10,
          incomingUnits: 0,
          stockSnapshotAt: "2026-04-18T00:00:00Z",
        },
      ],
      demandRows: [
        {
          regionKey: "buyer-central",
          nmId: 1,
          techSize: "0",
          vendorCode: "A",
          regionalForecastDailyDemand: 2,
        },
      ],
      regionMacroLookup: lookup,
    };

    expect(
      buildRegionalStocksReport({ ...base, targetCoverageDays: 30 }).rows[0]!
        .recommendedToRegion,
    ).toBe(50);
    expect(
      buildRegionalStocksReport({ ...base, targetCoverageDays: 60 }).rows[0]!
        .recommendedToRegion,
    ).toBe(110);
  });

  it("marks demand with no regional stock as critical", () => {
    const out = buildRegionalStocksReport({
      snapshotDate: "2026-04-18",
      horizonDays: 30,
      macroRegion: "Центральный",
      targetCoverageDays: 42,
      stockRows: [],
      demandRows: [
        {
          regionKey: "buyer-central",
          nmId: 2,
          techSize: "",
          vendorCode: "B",
          regionalForecastDailyDemand: 5,
        },
      ],
      regionMacroLookup: lookup,
    });

    expect(out.rows[0]!.regionalAvailable).toBe(0);
    expect(out.rows[0]!.risk).toBe("critical");
    expect(out.summary.risk.critical).toBe(1);
  });

  it("drops empty zero-demand zero-stock rows from warehouse snapshots", () => {
    const out = buildRegionalStocksReport({
      snapshotDate: "2026-04-18",
      horizonDays: 30,
      macroRegion: "Центральный",
      targetCoverageDays: 42,
      stockRows: [
        {
          warehouseKey: "коледино",
          nmId: 20,
          techSize: "",
          vendorCode: "EMPTY",
          startStock: 0,
          incomingUnits: 0,
          stockSnapshotAt: "2026-04-18T00:00:00Z",
        },
      ],
      demandRows: [],
      regionMacroLookup: lookup,
    });

    expect(out.rows).toHaveLength(0);
    expect(out.summary.risk.critical).toBe(0);
  });

  it("ignores virtual and unmapped warehouses when aggregating regional stock", () => {
    const out = buildRegionalStocksReport({
      snapshotDate: "2026-04-18",
      horizonDays: 30,
      macroRegion: "Приволжский",
      targetCoverageDays: 42,
      stockRows: [
        {
          warehouseKey: "казань",
          nmId: 3,
          techSize: "",
          vendorCode: "C",
          startStock: 10,
          incomingUnits: 0,
          stockSnapshotAt: "2026-04-18T00:00:00Z",
        },
        {
          warehouseKey: "виртуальный уфа",
          nmId: 3,
          techSize: "",
          vendorCode: "C",
          startStock: 100,
          incomingUnits: 0,
          stockSnapshotAt: "2026-04-18T00:00:00Z",
        },
        {
          warehouseKey: "unknown warehouse",
          nmId: 3,
          techSize: "",
          vendorCode: "C",
          startStock: 100,
          incomingUnits: 0,
          stockSnapshotAt: "2026-04-18T00:00:00Z",
        },
      ],
      demandRows: [
        {
          regionKey: "buyer-volga",
          nmId: 3,
          techSize: "",
          vendorCode: "C",
          regionalForecastDailyDemand: 10,
        },
      ],
      regionMacroLookup: lookup,
    });

    expect(out.rows[0]!.regionalAvailable).toBe(10);
    expect(out.rows[0]!.recommendedToRegion).toBe(410);
  });

  it("applies risk, search, and limit filters after calculation", () => {
    const out = buildRegionalStocksReport({
      snapshotDate: "2026-04-18",
      horizonDays: 30,
      macroRegion: "Центральный",
      targetCoverageDays: 42,
      riskStockout: "lt14",
      q: "SKU",
      limit: 1,
      stockRows: [
        {
          warehouseKey: "коледино",
          nmId: 4,
          techSize: "",
          vendorCode: "SKU-4",
          startStock: 10,
          incomingUnits: 0,
          stockSnapshotAt: "2026-04-18T00:00:00Z",
        },
        {
          warehouseKey: "коледино",
          nmId: 5,
          techSize: "",
          vendorCode: "SKU-5",
          startStock: 1000,
          incomingUnits: 0,
          stockSnapshotAt: "2026-04-18T00:00:00Z",
        },
      ],
      demandRows: [
        {
          regionKey: "buyer-central",
          nmId: 4,
          techSize: "",
          vendorCode: "SKU-4",
          regionalForecastDailyDemand: 10,
        },
        {
          regionKey: "buyer-central",
          nmId: 5,
          techSize: "",
          vendorCode: "SKU-5",
          regionalForecastDailyDemand: 10,
        },
      ],
      regionMacroLookup: lookup,
    });

    expect(out.summary.totalRows).toBe(1);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.nmId).toBe(4);
  });
});
