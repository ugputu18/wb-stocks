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
    expect(out.rows[0]!.ownWarehouseStock).toBe(0);
    expect(out.rows[0]!.recommendedOrderQty).toBe(0); // min(390, 0)
    expect(out.summary.recommendedToRegionTotal).toBe(390);
    expect(out.summary.ownWarehouseStockTotal).toBe(0);
    expect(out.summary.recommendedOrderQtyTotal).toBe(0);
    expect(out.ownWarehouseCode).toBe("main");
  });

  it("looks up own warehouse stock by vendor code and uses min(need, on_hand) for order qty", () => {
    const out = buildRegionalStocksReport({
      snapshotDate: "2026-04-18",
      horizonDays: 30,
      macroRegion: "Центральный",
      targetCoverageDays: 42,
      ownWarehouseCode: "main",
      ownStockByVendor: new Map<string, number>([
        ["A", 1000], // огромный остаток → ограничителем будет «Нужно»
        ["B", 5], // мало остатка → ограничителем будет «Склад»
      ]),
      stockRows: [
        {
          warehouseKey: "коледино",
          nmId: 1,
          techSize: "0",
          vendorCode: "A",
          startStock: 100,
          incomingUnits: 0,
          stockSnapshotAt: "2026-04-18T00:00:00Z",
        },
        {
          warehouseKey: "коледино",
          nmId: 2,
          techSize: "0",
          vendorCode: "B",
          startStock: 0,
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
          regionalForecastDailyDemand: 5,
        },
        {
          regionKey: "buyer-central",
          nmId: 2,
          techSize: "0",
          vendorCode: "B",
          regionalForecastDailyDemand: 10,
        },
      ],
      regionMacroLookup: lookup,
    });

    const byNm = new Map(out.rows.map((r) => [r.nmId, r]));
    const a = byNm.get(1)!;
    expect(a.recommendedToRegion).toBe(110); // 5*42-100
    expect(a.ownWarehouseStock).toBe(1000);
    expect(a.recommendedOrderQty).toBe(110); // min(110, 1000)

    const b = byNm.get(2)!;
    expect(b.recommendedToRegion).toBe(420); // 10*42-0
    expect(b.ownWarehouseStock).toBe(5);
    expect(b.recommendedOrderQty).toBe(5); // min(420, 5)

    expect(out.summary.ownWarehouseStockTotal).toBe(1005);
    expect(out.summary.recommendedOrderQtyTotal).toBe(115);
    expect(out.ownWarehouseCode).toBe("main");
  });

  it("treats missing/blank vendor code in own-stock map as zero (and zero order)", () => {
    const out = buildRegionalStocksReport({
      snapshotDate: "2026-04-18",
      horizonDays: 30,
      macroRegion: "Центральный",
      targetCoverageDays: 42,
      ownStockByVendor: new Map<string, number>([["A", 99]]),
      stockRows: [],
      demandRows: [
        {
          regionKey: "buyer-central",
          nmId: 9,
          techSize: "0",
          vendorCode: null,
          regionalForecastDailyDemand: 1,
        },
      ],
      regionMacroLookup: lookup,
    });

    expect(out.rows[0]!.ownWarehouseStock).toBe(0);
    // Нет vendor_code → склад=0 → min(нужно, 0) = 0.
    expect(out.rows[0]!.recommendedOrderQty).toBe(0);
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
