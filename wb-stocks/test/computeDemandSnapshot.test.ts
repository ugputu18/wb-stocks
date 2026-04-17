import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDatabase } from "../src/infra/db.js";
import { WbOrdersDailyRepository } from "../src/infra/wbOrdersDailyRepository.js";
import { WbDemandSnapshotRepository } from "../src/infra/wbDemandSnapshotRepository.js";
import {
  buildDemandRecords,
  computeDemandSnapshot,
} from "../src/application/computeDemandSnapshot.js";
import type { WbOrdersDailyRecord } from "../src/domain/wbOrder.js";

function silentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Parameters<typeof computeDemandSnapshot>[0]["logger"];
}

function order(
  orderDate: string,
  units: number,
  overrides: Partial<WbOrdersDailyRecord> = {},
): WbOrdersDailyRecord {
  return {
    orderDate,
    warehouseNameRaw: "Коледино",
    warehouseKey: "коледино",
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

describe("buildDemandRecords (pure aggregation)", () => {
  // snapshotDate = 2026-04-17, windowTo = 2026-04-16, windowFrom = 2026-03-18.
  // Last 7 days: 2026-04-10 .. 2026-04-16 inclusive.
  const SNAP = "2026-04-17";
  const TO = "2026-04-16";

  it("computes units7/units30 and base demand from a flat 30-day stream", () => {
    // 1 unit/day for 30 days.
    const rows: WbOrdersDailyRecord[] = [];
    for (let i = 0; i < 30; i += 1) {
      const d = `2026-${i < 14 ? "03" : "04"}-${String(
        i < 14 ? 18 + i : i - 13,
      ).padStart(2, "0")}`;
      rows.push(order(d, 1));
    }
    const out = buildDemandRecords(rows, SNAP, TO, "now");
    expect(out).toHaveLength(1);
    const r = out[0]!;
    expect(r.units30).toBe(30);
    expect(r.units7).toBe(7);
    expect(r.avgDaily7).toBeCloseTo(1, 10);
    expect(r.avgDaily30).toBeCloseTo(1, 10);
    expect(r.baseDailyDemand).toBeCloseTo(1, 10);
    expect(r.trendRatio).toBeCloseTo(1, 10);
    expect(r.trendRatioClamped).toBe(1);
    expect(r.forecastDailyDemand).toBeCloseTo(1, 10);
  });

  it("clamps trendRatio upward to 1.25 when last week explodes", () => {
    const rows: WbOrdersDailyRecord[] = [];
    // 7 days × 10 units (last week)
    for (let day = 10; day <= 16; day += 1) {
      rows.push(order(`2026-04-${String(day).padStart(2, "0")}`, 10));
    }
    // Days 18..09 with 0 units → just don't add them.
    const out = buildDemandRecords(rows, SNAP, TO, "now");
    const r = out[0]!;
    expect(r.units7).toBe(70);
    expect(r.units30).toBe(70);
    expect(r.avgDaily7).toBeCloseTo(10, 10);
    expect(r.avgDaily30).toBeCloseTo(70 / 30, 10);
    expect(r.trendRatio).toBeGreaterThan(1.25);
    expect(r.trendRatioClamped).toBe(1.25);
    expect(r.forecastDailyDemand).toBeCloseTo(r.baseDailyDemand * 1.25, 10);
  });

  it("clamps trendRatio downward to 0.75 when last week collapses", () => {
    const rows: WbOrdersDailyRecord[] = [];
    // Days 18 Mar..09 Apr × 10 units, last 7 days × 0.
    const first = new Date(Date.UTC(2026, 2, 18));
    const last = new Date(Date.UTC(2026, 3, 9));
    for (
      let t = first.getTime();
      t <= last.getTime();
      t += 24 * 60 * 60 * 1000
    ) {
      const d = new Date(t);
      const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      rows.push(order(ymd, 10));
    }
    const out = buildDemandRecords(rows, SNAP, TO, "now");
    const r = out[0]!;
    expect(r.units7).toBe(0);
    expect(r.units30).toBeGreaterThan(0);
    expect(r.trendRatio).toBeCloseTo(0, 10);
    expect(r.trendRatioClamped).toBe(0.75);
  });

  it("avoids divide-by-zero when there is no demand at all", () => {
    const out = buildDemandRecords([], SNAP, TO, "now");
    expect(out).toHaveLength(0);
  });

  it("groups by (warehouseKey, nmId, techSize), preserving payload fallbacks", () => {
    const rows = [
      order("2026-04-15", 2, { vendorCode: null, barcode: null }),
      order("2026-04-16", 3, { vendorCode: "SKU-X", barcode: "BC-X" }),
      order("2026-04-15", 1, {
        warehouseKey: "электросталь",
        warehouseNameRaw: "Электросталь",
        nmId: 100,
      }),
    ];
    const out = buildDemandRecords(rows, SNAP, TO, "now");
    expect(out.map((r) => `${r.warehouseKey}/${r.nmId}`)).toEqual([
      "электросталь/100",
      "коледино/100",
    ].sort());

    const koledino = out.find((r) => r.warehouseKey === "коледино")!;
    expect(koledino.units7).toBe(5);
    expect(koledino.units30).toBe(5);
    expect(koledino.vendorCode).toBe("SKU-X"); // fallback from second row
    expect(koledino.barcode).toBe("BC-X");
  });
});

describe("computeDemandSnapshot use case", () => {
  let ordersRepo: WbOrdersDailyRepository;
  let demandRepo: WbDemandSnapshotRepository;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    ordersRepo = new WbOrdersDailyRepository(db);
    demandRepo = new WbDemandSnapshotRepository(db);
  });

  it("reads orders for [snapshotDate-30, snapshotDate-1] only, then writes snapshot", async () => {
    // Inside the window:
    ordersRepo.replaceDay("2026-04-15", [order("2026-04-15", 4)]);
    ordersRepo.replaceDay("2026-04-16", [order("2026-04-16", 6)]);
    // Outside (snapshotDate itself): must be ignored.
    ordersRepo.replaceDay("2026-04-17", [order("2026-04-17", 1000)]);

    const r = await computeDemandSnapshot(
      {
        ordersRepository: ordersRepo,
        demandRepository: demandRepo,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T10:00:00.000Z"),
      },
      { snapshotDate: "2026-04-17" },
    );

    expect(r.windowFrom).toBe("2026-03-18");
    expect(r.windowTo).toBe("2026-04-16");
    expect(r.demandRows).toBe(1);
    expect(r.rowsInserted).toBe(1);

    const persisted = demandRepo.getForDate("2026-04-17")[0]!;
    expect(persisted.units7).toBe(10);
    expect(persisted.units30).toBe(10);
  });

  it("re-running for the same snapshotDate replaces, never duplicates", async () => {
    ordersRepo.replaceDay("2026-04-16", [order("2026-04-16", 5)]);
    const r1 = await computeDemandSnapshot(
      {
        ordersRepository: ordersRepo,
        demandRepository: demandRepo,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T10:00:00.000Z"),
      },
      { snapshotDate: "2026-04-17" },
    );
    expect(r1.rowsInserted).toBe(1);

    // Update the underlying orders, then recompute.
    ordersRepo.replaceDay("2026-04-16", [order("2026-04-16", 8)]);
    const r2 = await computeDemandSnapshot(
      {
        ordersRepository: ordersRepo,
        demandRepository: demandRepo,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T11:00:00.000Z"),
      },
      { snapshotDate: "2026-04-17" },
    );
    expect(r2.rowsDeleted).toBe(1);
    expect(r2.rowsInserted).toBe(1);
    expect(demandRepo.countForDate("2026-04-17")).toBe(1);
    expect(demandRepo.getForDate("2026-04-17")[0]!.units7).toBe(8);
  });

  it("dryRun returns the computed shape without touching DB", async () => {
    ordersRepo.replaceDay("2026-04-16", [order("2026-04-16", 7)]);
    const r = await computeDemandSnapshot(
      {
        ordersRepository: ordersRepo,
        demandRepository: demandRepo,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T10:00:00.000Z"),
      },
      { snapshotDate: "2026-04-17", dryRun: true },
    );
    expect(r.demandRows).toBe(1);
    expect(r.rowsInserted).toBe(0);
    expect(demandRepo.countForDate("2026-04-17")).toBe(0);
  });

  it("when no orders fall in the window, writes zero rows but still 'replaces' (clears) the date", async () => {
    // Pre-seed an old snapshot for the same date that should be cleared.
    demandRepo.replaceForDate("2026-04-17", [
      {
        snapshotDate: "2026-04-17",
        warehouseNameRaw: "x",
        warehouseKey: "x",
        nmId: 1,
        techSize: "0",
        vendorCode: null,
        barcode: null,
        units7: 0,
        units30: 0,
        avgDaily7: 0,
        avgDaily30: 0,
        baseDailyDemand: 0,
        trendRatio: 0,
        trendRatioClamped: 0.75,
        forecastDailyDemand: 0,
        computedAt: "old",
      },
    ]);
    expect(demandRepo.countForDate("2026-04-17")).toBe(1);

    const r = await computeDemandSnapshot(
      {
        ordersRepository: ordersRepo,
        demandRepository: demandRepo,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T10:00:00.000Z"),
      },
      { snapshotDate: "2026-04-17" },
    );
    expect(r.demandRows).toBe(0);
    expect(r.rowsDeleted).toBe(1);
    expect(demandRepo.countForDate("2026-04-17")).toBe(0);
  });
});
