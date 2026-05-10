import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/infra/db.js";
import { StockSnapshotRepository } from "../src/infra/stockSnapshotRepository.js";
import { WbDemandSnapshotRepository } from "../src/infra/wbDemandSnapshotRepository.js";
import { WbSupplyRepository } from "../src/infra/wbSupplyRepository.js";
import { WbForecastSnapshotRepository } from "../src/infra/wbForecastSnapshotRepository.js";
import { buildForecastSnapshot } from "../src/application/buildForecastSnapshot.js";
import type { StockSnapshotRecord } from "../src/domain/stockSnapshot.js";
import type { WbDemandSnapshotRecord } from "../src/domain/wbDemandSnapshot.js";
import type {
  WbSupplyItemRecord,
  WbSupplyRecord,
} from "../src/domain/wbSupply.js";

function silentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Parameters<typeof buildForecastSnapshot>[0]["logger"];
}

function stock(over: Partial<StockSnapshotRecord> = {}): StockSnapshotRecord {
  return {
    snapshotAt: "2026-04-17T08:00:00.000Z",
    nmId: 42,
    vendorCode: "SKU-1",
    barcode: "111",
    techSize: "0",
    warehouseName: "Коледино",
    quantity: 12,
    inWayToClient: 0,
    inWayFromClient: 0,
    quantityFull: 12,
    lastChangeDate: null,
    ...over,
  };
}

function demand(
  over: Partial<WbDemandSnapshotRecord> = {},
): WbDemandSnapshotRecord {
  return {
    snapshotDate: "2026-04-17",
    warehouseNameRaw: "Коледино",
    warehouseKey: "коледино",
    nmId: 42,
    techSize: "0",
    vendorCode: "SKU-1",
    barcode: "111",
    units7: 14,
    units30: 60,
    units90: 180,
    avgDaily7: 2,
    avgDaily30: 2,
    avgDaily90: 2,
    baseDailyDemand: 2,
    trendRatio: 1,
    trendRatioClamped: 1,
    forecastDailyDemand: 2,
    computedAt: "2026-04-17T09:00:00.000Z",
    ...over,
  };
}

function supply(over: Partial<WbSupplyRecord> = {}): WbSupplyRecord {
  return {
    supplyId: 1001,
    preorderId: null,
    phone: null,
    createDate: null,
    supplyDate: "2026-04-20T00:00:00+03:00",
    factDate: null,
    updatedDate: null,
    statusId: 2, // Planned
    boxTypeId: null,
    virtualTypeId: null,
    isBoxOnPallet: null,
    warehouseId: 507,
    warehouseName: "Коледино",
    actualWarehouseId: null,
    actualWarehouseName: null,
    quantity: 10,
    acceptedQuantity: null,
    unloadingQuantity: null,
    readyForSaleQuantity: null,
    depersonalizedQuantity: null,
    ...over,
  };
}

function item(
  over: Partial<WbSupplyItemRecord> = {},
): WbSupplyItemRecord {
  return {
    supplyId: 1001,
    barcode: "111",
    vendorCode: "SKU-1",
    nmId: 42,
    techSize: "0",
    color: null,
    quantity: 10,
    acceptedQuantity: null,
    readyForSaleQuantity: null,
    unloadingQuantity: null,
    ...over,
  };
}

function setup() {
  const db = openDatabase(":memory:");
  return {
    db,
    stockRepo: new StockSnapshotRepository(db),
    demandRepo: new WbDemandSnapshotRepository(db),
    supplyRepo: new WbSupplyRepository(db),
    forecastRepo: new WbForecastSnapshotRepository(db),
  };
}

describe("buildForecastSnapshot", () => {
  let env: ReturnType<typeof setup>;

  beforeEach(() => {
    env = setup();
  });

  it("aborts cleanly when no stock snapshot is available up to snapshotDate", async () => {
    env.demandRepo.replaceForDate("2026-04-17", [demand()]);

    const r = await buildForecastSnapshot(
      {
        stockRepository: env.stockRepo,
        demandRepository: env.demandRepo,
        supplyRepository: env.supplyRepo,
        forecastRepository: env.forecastRepo,
        logger: silentLogger(),
      },
      { snapshotDate: "2026-04-17", horizonDays: 30 },
    );
    expect(r.stockSnapshotAt).toBeNull();
    expect(r.forecastRows).toBe(0);
    expect(r.rowsInserted).toBe(0);
    expect(env.forecastRepo.countForKey("2026-04-17", 30)).toBe(0);
  });

  it("pins the most recent stock snapshot at-or-before snapshotDate (UTC end-of-day)", async () => {
    // Older snapshot:
    env.stockRepo.saveBatch([
      stock({
        snapshotAt: "2026-04-15T10:00:00.000Z",
        quantity: 999,
      }),
    ]);
    // Newer snapshot from earlier on snapshotDate:
    env.stockRepo.saveBatch([
      stock({ snapshotAt: "2026-04-17T08:00:00.000Z", quantity: 12 }),
    ]);
    // FUTURE snapshot — must NOT be picked when forecasting an earlier date.
    env.stockRepo.saveBatch([
      stock({ snapshotAt: "2026-04-18T08:00:00.000Z", quantity: 1 }),
    ]);
    env.demandRepo.replaceForDate("2026-04-17", [demand()]);

    const r = await buildForecastSnapshot(
      {
        stockRepository: env.stockRepo,
        demandRepository: env.demandRepo,
        supplyRepository: env.supplyRepo,
        forecastRepository: env.forecastRepo,
        logger: silentLogger(),
      },
      { snapshotDate: "2026-04-17", horizonDays: 30 },
    );
    expect(r.stockSnapshotAt).toBe("2026-04-17T08:00:00.000Z");
    const row = env.forecastRepo.getForKey("2026-04-17", 30)[0]!;
    expect(row.startStock).toBe(12);
    expect(row.stockSnapshotAt).toBe("2026-04-17T08:00:00.000Z");
  });

  it("end-to-end happy path with one supply landing inside horizon", async () => {
    env.stockRepo.saveBatch([stock({ quantity: 5 })]);
    env.demandRepo.replaceForDate("2026-04-17", [
      demand({ forecastDailyDemand: 5 }),
    ]);
    env.supplyRepo.upsertSupply(supply(), "2026-04-17T07:00:00.000Z");
    env.supplyRepo.replaceItemsForSupply(1001, [item({ quantity: 10 })]);

    const r = await buildForecastSnapshot(
      {
        stockRepository: env.stockRepo,
        demandRepository: env.demandRepo,
        supplyRepository: env.supplyRepo,
        forecastRepository: env.forecastRepo,
        logger: silentLogger(),
      },
      { snapshotDate: "2026-04-17", horizonDays: 5 },
    );
    expect(r.demandRows).toBe(1);
    expect(r.forecastRows).toBe(1);
    expect(r.rowsInserted).toBe(1);
    expect(r.incomingSupplies).toBe(1);
    expect(r.incomingArrivals).toBe(1);
    expect(r.incomingUnitsTotal).toBe(10);

    const row = env.forecastRepo.getForKey("2026-04-17", 5)[0]!;
    expect(row.startStock).toBe(5);
    expect(row.incomingUnits).toBe(10);
    // day 0: avail=5, sales=5; day 1..2: rescued by 10-unit supply on day 3? supplyDate=20-04 is day 3
    // Actually supplyDate = 2026-04-20 → that is day 3 of horizon [17,18,19,20,21]
    // day 0: avail=5, sales=5, stock=0
    // day 1: avail=0, sales=0 → stockoutDate=2026-04-18
    // day 2: avail=0, sales=0
    // day 3: avail=10 (supply), sales=5, stock=5
    // day 4: avail=5, sales=5, stock=0
    expect(row.stockoutDate).toBe("2026-04-18");
    expect(row.daysOfStock).toBe(1);
    expect(row.forecastUnits).toBe(15);
    expect(row.endStock).toBe(0);
  });

  it("re-running for the same (snapshotDate, horizonDays) is idempotent", async () => {
    env.stockRepo.saveBatch([stock()]);
    env.demandRepo.replaceForDate("2026-04-17", [demand()]);

    const r1 = await buildForecastSnapshot(
      {
        stockRepository: env.stockRepo,
        demandRepository: env.demandRepo,
        supplyRepository: env.supplyRepo,
        forecastRepository: env.forecastRepo,
        logger: silentLogger(),
      },
      { snapshotDate: "2026-04-17", horizonDays: 30 },
    );
    expect(r1.rowsInserted).toBe(1);

    const r2 = await buildForecastSnapshot(
      {
        stockRepository: env.stockRepo,
        demandRepository: env.demandRepo,
        supplyRepository: env.supplyRepo,
        forecastRepository: env.forecastRepo,
        logger: silentLogger(),
      },
      { snapshotDate: "2026-04-17", horizonDays: 30 },
    );
    expect(r2.rowsDeleted).toBe(1);
    expect(r2.rowsInserted).toBe(1);
    expect(env.forecastRepo.countForKey("2026-04-17", 30)).toBe(1);
  });

  it("does NOT silently substitute zero demand for stock keys without a demand snapshot", async () => {
    env.stockRepo.saveBatch([
      stock({ nmId: 42 }),
      stock({ nmId: 999, vendorCode: "X", barcode: "X" }), // no demand
    ]);
    env.demandRepo.replaceForDate("2026-04-17", [demand({ nmId: 42 })]);

    const r = await buildForecastSnapshot(
      {
        stockRepository: env.stockRepo,
        demandRepository: env.demandRepo,
        supplyRepository: env.supplyRepo,
        forecastRepository: env.forecastRepo,
        logger: silentLogger(),
      },
      { snapshotDate: "2026-04-17", horizonDays: 30 },
    );
    // Only 1 forecast row (for nmId=42); the orphan stock key was logged & skipped.
    expect(r.forecastRows).toBe(1);
    expect(
      r.skipped.some(
        (x) => x.reason === "no-demand-snapshot-for-stock-key" && x.count === 1,
      ),
    ).toBe(true);
  });

  it("keys forecast rows by (warehouseKey, nmId, techSize); vendorCode/barcode are payload only", async () => {
    env.stockRepo.saveBatch([stock()]);
    env.demandRepo.replaceForDate("2026-04-17", [
      demand({ vendorCode: "ALT", barcode: "ALT" }),
    ]);

    await buildForecastSnapshot(
      {
        stockRepository: env.stockRepo,
        demandRepository: env.demandRepo,
        supplyRepository: env.supplyRepo,
        forecastRepository: env.forecastRepo,
        logger: silentLogger(),
      },
      { snapshotDate: "2026-04-17", horizonDays: 30 },
    );
    const row = env.forecastRepo.getForKey("2026-04-17", 30)[0]!;
    // payload preserved from demand snapshot:
    expect(row.vendorCode).toBe("ALT");
    expect(row.barcode).toBe("ALT");
    // explainability inline:
    expect(row.units7).toBe(14);
    expect(row.units30).toBe(60);
    expect(row.units90).toBe(180);
    expect(row.forecastDailyDemand).toBe(2);
    // and stock provenance:
    expect(row.stockSnapshotAt).toBe("2026-04-17T08:00:00.000Z");
  });

  it("handles the same товар on multiple warehouses as separate forecast keys", async () => {
    env.stockRepo.saveBatch([
      stock({ warehouseName: "Коледино", quantity: 10 }),
      stock({ warehouseName: "Электросталь", quantity: 20 }),
    ]);
    env.demandRepo.replaceForDate("2026-04-17", [
      demand({ warehouseNameRaw: "Коледино", warehouseKey: "коледино" }),
      demand({
        warehouseNameRaw: "Электросталь",
        warehouseKey: "электросталь",
      }),
    ]);

    const r = await buildForecastSnapshot(
      {
        stockRepository: env.stockRepo,
        demandRepository: env.demandRepo,
        supplyRepository: env.supplyRepo,
        forecastRepository: env.forecastRepo,
        logger: silentLogger(),
      },
      { snapshotDate: "2026-04-17", horizonDays: 30 },
    );

    expect(r.forecastRows).toBe(2);
    const rows = env.forecastRepo.getForKey("2026-04-17", 30);
    expect(rows.map((row) => `${row.warehouseKey}:${row.startStock}`).sort()).toEqual([
      "коледино:10",
      "электросталь:20",
    ]);
  });

  it("handles multiple товаров on one warehouse as separate forecast keys", async () => {
    env.stockRepo.saveBatch([
      stock({ nmId: 42, vendorCode: "SKU-1", barcode: "111", quantity: 10 }),
      stock({ nmId: 99, vendorCode: "SKU-2", barcode: "222", quantity: 3 }),
    ]);
    env.demandRepo.replaceForDate("2026-04-17", [
      demand({ nmId: 42, vendorCode: "SKU-1", barcode: "111" }),
      demand({
        nmId: 99,
        vendorCode: "SKU-2",
        barcode: "222",
        forecastDailyDemand: 1,
      }),
    ]);

    const r = await buildForecastSnapshot(
      {
        stockRepository: env.stockRepo,
        demandRepository: env.demandRepo,
        supplyRepository: env.supplyRepo,
        forecastRepository: env.forecastRepo,
        logger: silentLogger(),
      },
      { snapshotDate: "2026-04-17", horizonDays: 30 },
    );

    expect(r.forecastRows).toBe(2);
    const rows = env.forecastRepo.getForKey("2026-04-17", 30);
    expect(rows.map((row) => `${row.nmId}:${row.startStock}`).sort()).toEqual([
      "42:10",
      "99:3",
    ]);
  });

  it("supports forecast-scope filters by normalized warehouse and SKU without deleting other rows", async () => {
    env.stockRepo.saveBatch([
      stock({ warehouseName: "Коледино", quantity: 10, nmId: 42, vendorCode: "SKU-1" }),
      stock({
        warehouseName: "Электросталь",
        quantity: 20,
        nmId: 42,
        vendorCode: "SKU-1",
      }),
    ]);
    env.demandRepo.replaceForDate("2026-04-17", [
      demand({ warehouseNameRaw: "Коледино", warehouseKey: "коледино", vendorCode: "SKU-1" }),
      demand({
        warehouseNameRaw: "Электросталь",
        warehouseKey: "электросталь",
        vendorCode: "SKU-1",
      }),
    ]);
    await buildForecastSnapshot(
      {
        stockRepository: env.stockRepo,
        demandRepository: env.demandRepo,
        supplyRepository: env.supplyRepo,
        forecastRepository: env.forecastRepo,
        logger: silentLogger(),
      },
      { snapshotDate: "2026-04-17", horizonDays: 30 },
    );

    const r = await buildForecastSnapshot(
      {
        stockRepository: env.stockRepo,
        demandRepository: env.demandRepo,
        supplyRepository: env.supplyRepo,
        forecastRepository: env.forecastRepo,
        logger: silentLogger(),
      },
      {
        snapshotDate: "2026-04-17",
        horizonDays: 30,
        sku: "SKU-1",
        warehouse: "  КОЛЕДИНО\u00A0",
      },
    );

    expect(r.demandRows).toBe(1);
    expect(r.forecastRows).toBe(1);
    expect(r.rowsDeleted).toBe(1);
    expect(r.rowsInserted).toBe(1);
    const rows = env.forecastRepo.getForKey("2026-04-17", 30);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.warehouseKey === "коледино")).toHaveLength(1);
    expect(rows.filter((row) => row.warehouseKey === "электросталь")).toHaveLength(1);
  });

  it("ignores accepted (status 5) supplies — they are already in stock", async () => {
    env.stockRepo.saveBatch([stock({ quantity: 5 })]);
    env.demandRepo.replaceForDate("2026-04-17", [
      demand({ forecastDailyDemand: 5 }),
    ]);
    env.supplyRepo.upsertSupply(
      supply({ statusId: 5, supplyDate: "2026-04-20T00:00:00+03:00" }),
      "2026-04-17T07:00:00.000Z",
    );
    env.supplyRepo.replaceItemsForSupply(1001, [item({ quantity: 10 })]);

    const r = await buildForecastSnapshot(
      {
        stockRepository: env.stockRepo,
        demandRepository: env.demandRepo,
        supplyRepository: env.supplyRepo,
        forecastRepository: env.forecastRepo,
        logger: silentLogger(),
      },
      { snapshotDate: "2026-04-17", horizonDays: 5 },
    );
    expect(r.incomingSupplies).toBe(0);
    const row = env.forecastRepo.getForKey("2026-04-17", 5)[0]!;
    expect(row.incomingUnits).toBe(0);
  });

  it("dryRun computes everything but writes nothing", async () => {
    env.stockRepo.saveBatch([stock()]);
    env.demandRepo.replaceForDate("2026-04-17", [demand()]);

    const r = await buildForecastSnapshot(
      {
        stockRepository: env.stockRepo,
        demandRepository: env.demandRepo,
        supplyRepository: env.supplyRepo,
        forecastRepository: env.forecastRepo,
        logger: silentLogger(),
      },
      { snapshotDate: "2026-04-17", horizonDays: 30, dryRun: true },
    );
    expect(r.dryRun).toBe(true);
    expect(r.forecastRows).toBe(1);
    expect(r.rowsInserted).toBe(0);
    expect(env.forecastRepo.countForKey("2026-04-17", 30)).toBe(0);
  });

  it("StockSnapshotRepository.getLatestSnapshotAtAsOf does not look ahead past asOfDate", () => {
    env.stockRepo.saveBatch([stock({ snapshotAt: "2026-04-17T08:00:00.000Z" })]);
    env.stockRepo.saveBatch([stock({ snapshotAt: "2026-04-18T08:00:00.000Z" })]);
    expect(env.stockRepo.getLatestSnapshotAtAsOf("2026-04-17")).toBe(
      "2026-04-17T08:00:00.000Z",
    );
    expect(env.stockRepo.getLatestSnapshotAtAsOf("2026-04-18")).toBe(
      "2026-04-18T08:00:00.000Z",
    );
    expect(env.stockRepo.getLatestSnapshotAtAsOf("2026-04-14")).toBeNull();
  });

  it("StockSnapshotRepository.getBySnapshotAt returns rows for that exact snapshot only", () => {
    env.stockRepo.saveBatch([
      stock({ snapshotAt: "2026-04-17T08:00:00.000Z", nmId: 1 }),
      stock({ snapshotAt: "2026-04-17T08:00:00.000Z", nmId: 2 }),
    ]);
    env.stockRepo.saveBatch([
      stock({ snapshotAt: "2026-04-18T08:00:00.000Z", nmId: 3 }),
    ]);
    const rows = env.stockRepo.getBySnapshotAt("2026-04-17T08:00:00.000Z");
    expect(rows.map((r) => r.nmId).sort()).toEqual([1, 2]);
  });

  it("treats status 6 supplies as incoming because they are unloaded but not yet accepted", async () => {
    env.stockRepo.saveBatch([stock({ quantity: 0 })]);
    env.demandRepo.replaceForDate("2026-04-17", [
      demand({ forecastDailyDemand: 5 }),
    ]);
    env.supplyRepo.upsertSupply(
      supply({
        statusId: 6,
        warehouseName: "Коледино",
        actualWarehouseName: "Коледино",
        supplyDate: "2026-04-17T00:00:00+03:00",
      }),
      "2026-04-17T07:00:00.000Z",
    );
    env.supplyRepo.replaceItemsForSupply(1001, [item({ quantity: 10 })]);

    const r = await buildForecastSnapshot(
      {
        stockRepository: env.stockRepo,
        demandRepository: env.demandRepo,
        supplyRepository: env.supplyRepo,
        forecastRepository: env.forecastRepo,
        logger: silentLogger(),
      },
      { snapshotDate: "2026-04-17", horizonDays: 5 },
    );

    expect(r.incomingSupplies).toBe(1);
    expect(env.forecastRepo.getForKey("2026-04-17", 5)[0]!.incomingUnits).toBe(10);
  });
});
