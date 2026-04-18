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

describe("buildRegionDemandRecords", () => {
  const SNAP = "2026-04-17";
  const TO = "2026-04-16";

  it("mirrors warehouse demand math for region buckets", () => {
    const rows: WbOrdersDailyRegionRecord[] = [];
    for (let i = 0; i < 30; i += 1) {
      const d = `2026-${i < 14 ? "03" : "04"}-${String(
        i < 14 ? 18 + i : i - 13,
      ).padStart(2, "0")}`;
      rows.push(regionOrder(d, 1));
    }
    const out = buildRegionDemandRecords(rows, SNAP, TO, "now");
    expect(out).toHaveLength(1);
    const r = out[0]!;
    expect(r.regionKey).toBe("москва");
    expect(r.regionalForecastDailyDemand).toBeCloseTo(1, 10);
  });

  it("keeps separate rows per region key", () => {
    const rows: WbOrdersDailyRegionRecord[] = [];
    for (let i = 0; i < 30; i += 1) {
      const d = `2026-${i < 14 ? "03" : "04"}-${String(
        i < 14 ? 18 + i : i - 13,
      ).padStart(2, "0")}`;
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
