import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDatabase } from "../src/infra/db.js";
import { WbOrdersDailyByRegionRepository } from "../src/infra/wbOrdersDailyByRegionRepository.js";
import { WbRegionDemandSnapshotRepository } from "../src/infra/wbRegionDemandSnapshotRepository.js";
import {
  buildRegionDemandRecords,
  computeRegionDemandSnapshot,
} from "../src/application/computeRegionDemandSnapshot.js";
import type { WbOrdersDailyRegionRecord } from "../src/domain/wbOrder.js";
import { NO_REGION_KEY } from "../src/domain/regionName.js";

function silentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Parameters<typeof computeRegionDemandSnapshot>[0]["logger"];
}

function regionOrder(
  orderDate: string,
  units: number,
  overrides: Partial<WbOrdersDailyRegionRecord> = {},
): WbOrdersDailyRegionRecord {
  return {
    orderDate,
    regionNameRaw: "Москва",
    regionKey: "москва",
    nmId: 100,
    techSize: "0",
    vendorCode: "SKU-1",
    barcode: "111",
    units,
    cancelledUnits: 0,
    grossUnits: units,
    firstSeenAt: "2026-04-17T00:00:00.000Z",
    lastSeenAt: "2026-04-17T00:00:00.000Z",
    ...overrides,
  };
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

describe("buildRegionDemandRecords", () => {
  const SNAP = "2026-04-17";
  const TO = "2026-04-16";

  it("mirrors warehouse demand math for region buckets", () => {
    const rows: WbOrdersDailyRegionRecord[] = [];
    for (let i = 89; i >= 0; i -= 1) {
      rows.push(regionOrder(addDays(TO, -i), 1));
    }
    const out = buildRegionDemandRecords(rows, SNAP, TO, "now");
    expect(out).toHaveLength(1);
    const r = out[0]!;
    expect(r.regionKey).toBe("москва");
    expect(r.units7).toBe(7);
    expect(r.units30).toBe(30);
    expect(r.units90).toBe(90);
    expect(r.avgDaily90).toBeCloseTo(1, 10);
    expect(r.regionalForecastDailyDemand).toBeCloseTo(1, 10);
  });

  it("uses 30-day fallback when regional avgDaily7 is zero", () => {
    const rows: WbOrdersDailyRegionRecord[] = [];
    for (let day = 1; day <= 9; day += 1) {
      rows.push(regionOrder(`2026-04-${String(day).padStart(2, "0")}`, 3));
    }
    const r = buildRegionDemandRecords(rows, SNAP, TO, "now")[0]!;
    expect(r.units7).toBe(0);
    expect(r.units30).toBe(27);
    expect(r.units90).toBe(27);
    expect(r.baseDailyDemand).toBeCloseTo(0.5 * 0.9 + 0.3 * 0.9 + 0.2 * 0.3, 10);
    expect(r.trendRatioClamped).toBe(0.75);
  });

  it("uses 90-day fallback when regional avgDaily7/30 are zero", () => {
    const rows: WbOrdersDailyRegionRecord[] = [];
    for (let i = 89; i >= 30; i -= 1) {
      rows.push(regionOrder(addDays(TO, -i), 1));
    }
    const r = buildRegionDemandRecords(rows, SNAP, TO, "now")[0]!;
    expect(r.units7).toBe(0);
    expect(r.units30).toBe(0);
    expect(r.units90).toBe(60);
    expect(r.avgDaily90).toBeCloseTo(60 / 90, 10);
    expect(r.baseDailyDemand).toBeCloseTo(60 / 90, 10);
    expect(r.regionalForecastDailyDemand).toBeCloseTo((60 / 90) * 0.75, 10);
  });

  it("keeps separate rows per region key", () => {
    const rows: WbOrdersDailyRegionRecord[] = [];
    for (let i = 89; i >= 0; i -= 1) {
      const d = addDays(TO, -i);
      rows.push(regionOrder(d, 1));
      rows.push(regionOrder(d, 1, { regionKey: "новосибирск", regionNameRaw: "Новосибирск" }));
    }
    const out = buildRegionDemandRecords(rows, SNAP, TO, "now");
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.regionKey).sort()).toEqual(["москва", "новосибирск"]);
  });
});

describe("computeRegionDemandSnapshot use case", () => {
  let ordersRepo: WbOrdersDailyByRegionRepository;
  let demandRepo: WbRegionDemandSnapshotRepository;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    ordersRepo = new WbOrdersDailyByRegionRepository(db);
    demandRepo = new WbRegionDemandSnapshotRepository(db);
    ordersRepo.replaceDay("2026-04-16", [
      {
        orderDate: "2026-04-16",
        regionNameRaw: null,
        regionKey: NO_REGION_KEY,
        nmId: 42,
        techSize: "0",
        vendorCode: "V",
        barcode: null,
        units: 1,
        cancelledUnits: 0,
        grossUnits: 1,
        firstSeenAt: "2026-04-17T00:00:00.000Z",
        lastSeenAt: "2026-04-17T00:00:00.000Z",
      },
    ]);
  });

  it("persists snapshot rows", async () => {
    const r = await computeRegionDemandSnapshot(
      {
        ordersByRegionRepository: ordersRepo,
        regionDemandRepository: demandRepo,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T12:00:00.000Z"),
      },
      { snapshotDate: "2026-04-17", dryRun: false },
    );
    expect(r.demandRows).toBeGreaterThanOrEqual(1);
    expect(r.rowsInserted).toBe(r.demandRows);
    expect(demandRepo.countForDate("2026-04-17")).toBe(r.demandRows);
  });
});
