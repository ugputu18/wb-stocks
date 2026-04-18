import { describe, expect, it } from "vitest";
import {
  computeDonorMacroRegionRecommendations,
  computeDonorWarehouseRecommendations,
  pickTopSurplusSkus,
  skuKey,
} from "../src/utils/wbRedistributionDonorModel.js";

function wh(
  key: string,
  local: number,
  fd: number,
  days: number,
  rec: number,
): Record<string, unknown> {
  return {
    warehouseKey: key,
    warehouseNameRaw: key,
    forecastDailyDemand: fd,
    daysOfStock: days,
    inventoryLevels: { localAvailable: local },
    replenishment: { recommendedToWB: rec },
  };
}

function donorRow(nm: number, ts: string, local: number, fd: number): Record<string, unknown> {
  return {
    nmId: nm,
    techSize: ts,
    vendorCode: "V",
    forecastDailyDemand: fd,
    inventoryLevels: { localAvailable: local },
  };
}

describe("skuKey", () => {
  it("joins nm and tech", () => {
    expect(skuKey(1, "0")).toBe("1|0");
  });
});

describe("computeDonorWarehouseRecommendations", () => {
  it("ranks by transferScore", () => {
    const donorRows = [donorRow(1, "0", 100, 2)];
    const net = new Map<string, unknown[]>([
      [
        "1|0",
        [
          wh("казань", 100, 2, 20, 0),
          wh("новосибирск", 0, 10, 1, 30),
          wh("краснодар", 0, 5, 2, 20),
        ],
      ],
    ]);
    const r = computeDonorWarehouseRecommendations(donorRows, net, "казань", 14, 1);
    expect(r.length).toBe(2);
    expect(r[0].transferScore).toBeGreaterThanOrEqual(r[1].transferScore);
    expect(r[0].targetWarehouseKey).toBe("новосибирск");
    expect(r[0].transferScore).toBe(30 * 10);
    expect(r[0].rankingMode).toBe("fulfillment");
    expect(r[0].targetRankingDemand).toBe(r[0].targetForecastDailyDemand);
  });

  it("transferScore uses target forecastDailyDemand (fulfillment)", () => {
    const donorRows = [donorRow(1, "0", 100, 2)];
    const net = new Map<string, unknown[]>([
      [
        "1|0",
        [
          wh("новосибирск", 0, 100, 1, 30),
          wh("краснодар", 0, 5, 2, 20),
        ],
      ],
    ]);
    const r = computeDonorWarehouseRecommendations(donorRows, net, "казань", 14, 1);
    const toNsk = r.find((x) => x.targetWarehouseKey === "новосибирск");
    expect(toNsk?.targetForecastDailyDemand).toBe(100);
    expect(toNsk?.transferScore).toBe(30 * 100);
    expect(toNsk?.rankingMode).toBe("fulfillment");
    expect(toNsk?.targetRankingDemand).toBe(100);
  });
});

describe("computeDonorMacroRegionRecommendations", () => {
  it("uses regional shortage: need = ceil(targetCoverage − Σ local in macro)", () => {
    const donorRows = [donorRow(1, "0", 1000, 2)];
    const net = new Map<string, unknown[]>([
      [
        "1|0",
        [
          wh("новосибирск", 0, 100, 1, 5),
          wh("краснодар", 0, 5, 2, 3),
        ],
      ],
    ]);
    const bySku = new Map<string, Map<string, number>>();
    bySku.set("1|0", new Map([["Сибирский и Дальневосточный", 2]]));
    const r = computeDonorMacroRegionRecommendations(
      donorRows,
      net,
      "казань",
      14,
      1,
      bySku,
      30,
    );
    expect(r.length).toBe(1);
    expect(r[0].kind).toBe("macro");
    expect(r[0].targetCoverageStockUnits).toBe(60);
    expect(r[0].regionalAvailableUnits).toBe(0);
    expect(r[0].regionalNeedUnits).toBe(60);
    expect(r[0].recommendedTransferUnitsToRegion).toBe(60);
    expect(r[0].transferScore).toBe(60 * 2);
  });

  it("skips saturated macro (need 0)", () => {
    const donorRows = [donorRow(1, "0", 1000, 2)];
    const net = new Map<string, unknown[]>([
      ["1|0", [wh("новосибирск", 500, 10, 1, 0)]],
    ]);
    const bySku = new Map<string, Map<string, number>>();
    bySku.set("1|0", new Map([["Сибирский и Дальневосточный", 10]]));
    const r = computeDonorMacroRegionRecommendations(
      donorRows,
      net,
      "казань",
      14,
      1,
      bySku,
      30,
    );
    expect(r.length).toBe(0);
  });

  it("skips target macro equal to donor macro (inter-region only)", () => {
    const donorRows = [donorRow(1, "0", 100, 2)];
    const net = new Map<string, unknown[]>([
      ["1|0", [wh("новосибирск", 0, 10, 1, 30)]],
    ]);
    const bySku = new Map<string, Map<string, number>>();
    bySku.set("1|0", new Map([["Сибирский и Дальневосточный", 5]]));
    const r = computeDonorMacroRegionRecommendations(
      donorRows,
      net,
      "новосибирск",
      14,
      1,
      bySku,
      30,
    );
    expect(r.length).toBe(0);
  });

  it("ranks by lower regionalDaysOfStock, then demand, then transferScore", () => {
    const donorRows = [donorRow(1, "0", 100, 2)];
    const net = new Map<string, unknown[]>([
      [
        "1|0",
        [
          wh("новосибирск", 0, 10, 1, 10),
          wh("краснодар", 0, 10, 1, 5),
        ],
      ],
    ]);
    const bySku = new Map<string, Map<string, number>>();
    bySku.set(
      "1|0",
      new Map([
        ["Сибирский и Дальневосточный", 5],
        ["Южный и Северо-Кавказский", 10],
      ]),
    );
    const r = computeDonorMacroRegionRecommendations(
      donorRows,
      net,
      "казань",
      14,
      1,
      bySku,
      30,
    );
    expect(r.length).toBe(2);
    expect(r[0].regionalDaysOfStock).toBe(0);
    expect(r[1].regionalDaysOfStock).toBe(0);
    expect(r[0].targetRegionalDemand).toBeGreaterThanOrEqual(r[1].targetRegionalDemand);
    expect(r[0].targetMacroRegion).toBe("Южный и Северо-Кавказский");
    expect(r[1].targetMacroRegion).toBe("Сибирский и Дальневосточный");
  });

  it("skips macro rows with zero regional demand", () => {
    const donorRows = [donorRow(1, "0", 100, 2)];
    const net = new Map<string, unknown[]>([
      ["1|0", [wh("новосибирск", 0, 100, 1, 30)]],
    ]);
    const bySku = new Map<string, Map<string, number>>();
    bySku.set("1|0", new Map([["Сибирский и Дальневосточный", 0]]));
    const r = computeDonorMacroRegionRecommendations(
      donorRows,
      net,
      "казань",
      14,
      1,
      bySku,
      30,
    );
    expect(r.length).toBe(0);
  });
});

describe("pickTopSurplusSkus", () => {
  const rows = [
    donorRow(1, "0", 50, 1),
    donorRow(2, "0", 200, 1),
    donorRow(3, "0", 10, 1),
  ];
  it("limits count", () => {
    const top = pickTopSurplusSkus(rows, "казань", 14, 0, 2);
    expect(top.map((x) => x.nmId)).toEqual([2, 1]);
  });
});
