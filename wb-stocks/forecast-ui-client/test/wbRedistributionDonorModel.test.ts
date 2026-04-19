import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compareRedistributionExecutionTargets,
  computeDonorMacroRegionRecommendations,
  computeDonorWarehouseRecommendations,
  getUnknownWarehouseUsageStats,
  pickTopSurplusSkus,
  redistributionExecutionTargetDebugSortKey,
  redistributionMacroTraceFilterFromGetItemResult,
  resetUnknownWarehouseUsageStats,
  shouldTraceRedistributionMacroRow,
  skuKey,
  sortRedistributionExecutionTargets,
  type RedistributionMacroTraceFilter,
  type WarehouseInMacroCandidate,
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

describe("redistribution macro trace filter", () => {
  it("getItem null (key absent) -> off", () => {
    expect(redistributionMacroTraceFilterFromGetItemResult(null)).toEqual({ kind: "off" });
  });

  it("empty string -> trace all rows", () => {
    expect(redistributionMacroTraceFilterFromGetItemResult("")).toEqual({ kind: "all" });
    expect(shouldTraceRedistributionMacroRow("any", "row", { kind: "all" })).toBe(true);
    expect(shouldTraceRedistributionMacroRow("any", "row", { kind: "off" })).toBe(false);
  });

  it("whitespace-only -> trace all (trimmed empty)", () => {
    expect(redistributionMacroTraceFilterFromGetItemResult(" \t  ")).toEqual({ kind: "all" });
  });

  it("non-empty substring -> match only when warehouseKey|raw includes needle (ru case-folding)", () => {
    const f = redistributionMacroTraceFilterFromGetItemResult("новосибирск") as Extract<
      RedistributionMacroTraceFilter,
      { kind: "substring" }
    >;
    expect(f.kind).toBe("substring");
    expect(shouldTraceRedistributionMacroRow("другой", "склад", f)).toBe(false);
    expect(shouldTraceRedistributionMacroRow("склад новосибирск", "x", f)).toBe(true);
    expect(shouldTraceRedistributionMacroRow("x", "НОВОСИБИРСК склад", f)).toBe(true);
  });
});

function macroExec(
  warehouseKey: string,
  o: Partial<Omit<WarehouseInMacroCandidate, "warehouseKey">> = {},
): WarehouseInMacroCandidate {
  return {
    warehouseKey,
    warehouseNameRaw: o.warehouseNameRaw ?? warehouseKey,
    recommendedToWB: o.recommendedToWB ?? 0,
    daysOfStock: o.daysOfStock ?? 0,
    localAvailable: o.localAvailable ?? 0,
    priorityWithinMacro: o.priorityWithinMacro ?? 0,
  };
}

describe("compareRedistributionExecutionTargets", () => {
  it("higher recommendedToWB wins", () => {
    const hi = macroExec("a", { recommendedToWB: 10 });
    const lo = macroExec("b", { recommendedToWB: 5 });
    expect(compareRedistributionExecutionTargets(hi, lo)).toBeLessThan(0);
    expect(compareRedistributionExecutionTargets(lo, hi)).toBeGreaterThan(0);
  });

  it("lower daysOfStock breaks tie on recommendedToWB", () => {
    const a = macroExec("a", { recommendedToWB: 7, daysOfStock: 2 });
    const b = macroExec("b", { recommendedToWB: 7, daysOfStock: 9 });
    expect(compareRedistributionExecutionTargets(a, b)).toBeLessThan(0);
  });

  it("lower localAvailable breaks tie on rec and days", () => {
    const a = macroExec("a", { recommendedToWB: 4, daysOfStock: 1, localAvailable: 3 });
    const b = macroExec("b", { recommendedToWB: 4, daysOfStock: 1, localAvailable: 100 });
    expect(compareRedistributionExecutionTargets(a, b)).toBeLessThan(0);
  });

  it("higher priorityWithinMacro breaks further tie", () => {
    const a = macroExec("a", { recommendedToWB: 1, daysOfStock: 1, localAvailable: 1, priorityWithinMacro: 9 });
    const b = macroExec("b", { recommendedToWB: 1, daysOfStock: 1, localAvailable: 1, priorityWithinMacro: 2 });
    expect(compareRedistributionExecutionTargets(a, b)).toBeLessThan(0);
  });

  it("stable final ordering by warehouseKey (ru locale)", () => {
    const z = macroExec("ямало", { recommendedToWB: 1, daysOfStock: 1, localAvailable: 1, priorityWithinMacro: 0 });
    const a = macroExec("архангельск", { recommendedToWB: 1, daysOfStock: 1, localAvailable: 1, priorityWithinMacro: 0 });
    const sorted = sortRedistributionExecutionTargets([z, a]);
    expect(sorted.map((c) => c.warehouseKey)).toEqual(["архангельск", "ямало"]);
    expect(redistributionExecutionTargetDebugSortKey(a)).toContain("архангельск");
  });
});

describe("computeDonorWarehouseRecommendations", () => {
  afterEach(() => {
    resetUnknownWarehouseUsageStats();
  });

  it("excludes unknown warehouses from fulfillment execution targets", () => {
    const donorRows = [donorRow(1, "0", 100, 2)];
    const net = new Map<string, unknown[]>([
      [
        "1|0",
        [
          wh("totally-unknown-warehouse-zzz", 0, 10, 1, 50),
          wh("новосибирск", 0, 5, 1, 20),
        ],
      ],
    ]);
    const r = computeDonorWarehouseRecommendations(donorRows, net, "казань", 14, 1);
    expect(r.map((x) => x.targetWarehouseKey)).toEqual(["новосибирск"]);
  });

  it("excludes virtual warehouses as fulfillment targets when they are in the registry", () => {
    const donorRows = [donorRow(1, "0", 100, 2)];
    const net = new Map<string, unknown[]>([
      [
        "1|0",
        [
          wh("виртуальный новосибирск", 0, 50, 1, 40),
          wh("новосибирск", 0, 10, 1, 30),
        ],
      ],
    ]);
    const r = computeDonorWarehouseRecommendations(donorRows, net, "казань", 14, 1);
    expect(r.length).toBe(1);
    expect(r[0].targetWarehouseKey).toBe("новосибирск");
  });

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

describe("unknown warehouse usage stats", () => {
  afterEach(() => {
    resetUnknownWarehouseUsageStats();
  });

  it("накопляет счётчик по нормализованному ключу, warn остаётся однократным", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const donorRows = [donorRow(1, "0", 1000, 2)];
    const net = new Map<string, unknown[]>([
      ["1|0", [wh("unseen-wh-abc", 0, 1, 1, 1), wh("unseen-wh-abc", 0, 1, 1, 1)]],
    ]);
    const bySku = new Map<string, Map<string, number>>();
    bySku.set("1|0", new Map([["Сибирский", 8]]));
    computeDonorMacroRegionRecommendations(donorRows, net, "казань", 14, 1, bySku, 30);
    computeDonorMacroRegionRecommendations(donorRows, net, "казань", 14, 1, bySku, 30);
    expect(getUnknownWarehouseUsageStats().get("unseen-wh-abc")).toBe(4);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

describe("computeDonorMacroRegionRecommendations", () => {
  afterEach(() => {
    resetUnknownWarehouseUsageStats();
  });

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
    expect(r[0].hasCandidateWarehouses).toBe(true);
    expect(r[0].executionTargetCount).toBe(1);
    expect(r[0].hasExecutionTargets).toBe(true);
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
    expect(r[0].hasCandidateWarehouses).toBe(true);
    expect(r[1].hasCandidateWarehouses).toBe(true);
  });

  it("сц шушары → шушары: остатки ряда сц в Σ региона; исполнение по записи шушары (ключ в сети может остаться сц)", () => {
    const donorRows = [donorRow(1, "0", 1000, 2)];
    const net = new Map<string, unknown[]>([
      [
        "1|0",
        [
          wh("сц шушары", 80, 1, 1, 0),
          wh("санкт-петербург", 40, 2, 1, 5),
        ],
      ],
    ]);
    const bySku = new Map<string, Map<string, number>>();
    bySku.set("1|0", new Map([["Северо-Западный", 5]]));
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
    expect(r[0].regionalAvailableUnits).toBe(120);
    expect(r[0].candidateWarehouseKeys).toEqual(["санкт-петербург", "сц шушары"]);
    expect(r[0].hasCandidateWarehouses).toBe(true);
  });

  it("preferred warehouse: при равном recommendedToWB выбирается склад с меньшим daysOfStock", () => {
    const donorRows = [donorRow(1, "0", 1000, 2)];
    const net = new Map<string, unknown[]>([
      [
        "1|0",
        [
          wh("новосибирск", 0, 5, 8, 10),
          wh("красноярск", 0, 5, 2, 10),
        ],
      ],
    ]);
    const bySku = new Map<string, Map<string, number>>();
    bySku.set("1|0", new Map([["Сибирский", 8]]));
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
    expect(r[0].preferredWarehouseKey).toBe("красноярск");
  });

  it("includes Siberian+FarEast-mapped warehouses when target macro is Сибирский", () => {
    const donorRows = [donorRow(1, "0", 1000, 2)];
    const net = new Map<string, unknown[]>([
      [
        "1|0",
        [
          wh("новосибирск", 0, 10, 1, 5),
          wh("красноярск", 0, 5, 1, 3),
        ],
      ],
    ]);
    const bySku = new Map<string, Map<string, number>>();
    bySku.set("1|0", new Map([["Сибирский", 8]]));
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
    expect(r[0].targetMacroRegion).toBe("Сибирский");
    expect(r[0].candidateWarehouseKeys).toEqual(["новосибирск", "красноярск"]);
    expect(r[0].candidateWarehouseLabels).toEqual(["новосибирск", "красноярск"]);
    expect(r[0].hasCandidateWarehouses).toBe(true);
  });

  it("drops virtual warehouse when real exists for same base name", () => {
    const donorRows = [donorRow(1, "0", 1000, 2)];
    const net = new Map<string, unknown[]>([
      [
        "1|0",
        [
          wh("новосибирск", 0, 10, 1, 8),
          wh("виртуальный новосибирск", 0, 1, 1, 50),
          wh("красноярск", 0, 5, 1, 3),
        ],
      ],
    ]);
    const bySku = new Map<string, Map<string, number>>();
    bySku.set("1|0", new Map([["Сибирский", 8]]));
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
    expect(r[0].candidateWarehouseKeys).toContain("новосибирск");
    expect(r[0].candidateWarehouseKeys).not.toContain("виртуальный новосибирск");
    expect(r[0].preferredWarehouseKey).toBe("новосибирск");
    expect(r[0].hasCandidateWarehouses).toBe(true);
  });

  it("hasCandidateWarehouses: есть macro-matched строка, hasExecutionTargets false если только виртуальный склад в регионе", () => {
    const donorRows = [donorRow(1, "0", 1000, 2)];
    const net = new Map<string, unknown[]>([
      ["1|0", [wh("виртуальный новосибирск", 0, 8, 1, 5)]],
    ]);
    const bySku = new Map<string, Map<string, number>>();
    bySku.set("1|0", new Map([["Сибирский и Дальневосточный", 5]]));
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
    expect(r[0].hasCandidateWarehouses).toBe(true);
    expect(r[0].hasExecutionTargets).toBe(false);
    expect(r[0].candidateWarehouseKeys).toEqual([]);
    expect(r[0].regionalAvailableUnits).toBe(0);
    expect(r[0].sumRecommendedToWBInRegion).toBe(0);
    expect(r[0].regionMinDaysOfStockHint).toBe(null);
  });

  it("hasCandidateWarehouses true при одном СЦ в регионе без execution targets; агрегаты по availabilityContributors", () => {
    const donorRows = [donorRow(1, "0", 1000, 2)];
    const net = new Map<string, unknown[]>([
      ["1|0", [wh("сц барнаул", 40, 2, 1, 3)]],
    ]);
    const bySku = new Map<string, Map<string, number>>();
    bySku.set("1|0", new Map([["Сибирский", 10]]));
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
    expect(r[0].hasCandidateWarehouses).toBe(true);
    expect(r[0].hasExecutionTargets).toBe(false);
    expect(r[0].candidateWarehouseKeys).toEqual([]);
    expect(r[0].regionalAvailableUnits).toBe(40);
    expect(r[0].sumRecommendedToWBInRegion).toBe(3);
    expect(r[0].regionMinDaysOfStockHint).toBe(1);
  });

  it("CIS: warehouses of one country are not candidates for another country's target macro", () => {
    const donorRows = [donorRow(1, "0", 1000, 2)];
    const net = new Map<string, unknown[]>([["1|0", [wh("актобе", 0, 10, 1, 5)]]]);
    const bySku = new Map<string, Map<string, number>>();
    bySku.set("1|0", new Map([["Беларусь", 6]]));
    const r = computeDonorMacroRegionRecommendations(
      donorRows,
      net,
      "астана",
      14,
      1,
      bySku,
      30,
    );
    expect(r.length).toBe(1);
    expect(r[0].targetMacroRegion).toBe("Беларусь");
    expect(r[0].candidateWarehouseKeys).toEqual([]);
    expect(r[0].hasCandidateWarehouses).toBe(false);
    expect(r[0].hasExecutionTargets).toBe(false);
  });

  it("keeps macro row when candidateWarehouseKeys is empty (regional deficit without mapped warehouses in network)", () => {
    const donorRows = [donorRow(1, "0", 1000, 2)];
    const net = new Map<string, unknown[]>([["1|0", [wh("казань", 0, 10, 1, 5)]]]);
    const bySku = new Map<string, Map<string, number>>();
    bySku.set("1|0", new Map([["Сибирский", 8]]));
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
    expect(r[0].candidateWarehouseKeys).toEqual([]);
    expect(r[0].hasCandidateWarehouses).toBe(false);
    expect(r[0].hasExecutionTargets).toBe(false);
    expect(r[0].regionalNeedUnits).toBeGreaterThan(0);
    expect(r[0].recommendedTransferUnitsToRegion).toBeGreaterThan(0);
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
