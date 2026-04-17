import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/infra/db.js";
import { WbOrdersDailyRepository } from "../src/infra/wbOrdersDailyRepository.js";
import { WbDemandSnapshotRepository } from "../src/infra/wbDemandSnapshotRepository.js";
import { StockSnapshotRepository } from "../src/infra/stockSnapshotRepository.js";
import { WbSupplyRepository } from "../src/infra/wbSupplyRepository.js";
import { WbForecastSnapshotRepository } from "../src/infra/wbForecastSnapshotRepository.js";
import { runSalesForecastMvp } from "../src/application/runSalesForecastMvp.js";
import type { StockSnapshotRecord } from "../src/domain/stockSnapshot.js";
import type { WbStatsClient } from "../src/infra/wbStatsClient.js";

function silentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Parameters<typeof runSalesForecastMvp>[0]["logger"];
}

function fakeClient(pages: unknown[][]): WbStatsClient {
  const calls: unknown[] = [];
  const fn = vi.fn(async (params: unknown) => {
    calls.push(params);
    return pages[Math.min(calls.length - 1, pages.length - 1)] ?? [];
  });
  return {
    getSupplierOrders: fn,
  } as unknown as WbStatsClient;
}

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-04-16T10:00:00",
    lastChangeDate: "2026-04-16T10:00:00",
    warehouseName: "Коледино",
    supplierArticle: "SKU-1",
    nmId: 42,
    barcode: "111",
    techSize: "0",
    isCancel: false,
    srid: "s-1",
    ...overrides,
  };
}

function stock(overrides: Partial<StockSnapshotRecord> = {}): StockSnapshotRecord {
  return {
    snapshotAt: "2026-04-17T08:00:00.000Z",
    nmId: 42,
    vendorCode: "SKU-1",
    barcode: "111",
    techSize: "0",
    warehouseName: "Коледино",
    quantity: 10,
    inWayToClient: 0,
    inWayFromClient: 0,
    quantityFull: 10,
    lastChangeDate: null,
    ...overrides,
  };
}

describe("runSalesForecastMvp", () => {
  const logger = silentLogger();
  let db: ReturnType<typeof openDatabase>;
  let ordersRepository: WbOrdersDailyRepository;
  let demandRepository: WbDemandSnapshotRepository;
  let stockRepository: StockSnapshotRepository;
  let supplyRepository: WbSupplyRepository;
  let forecastRepository: WbForecastSnapshotRepository;

  beforeEach(() => {
    db = openDatabase(":memory:");
    ordersRepository = new WbOrdersDailyRepository(db);
    demandRepository = new WbDemandSnapshotRepository(db);
    stockRepository = new StockSnapshotRepository(db);
    supplyRepository = new WbSupplyRepository(db);
    forecastRepository = new WbForecastSnapshotRepository(db);
    stockRepository.saveBatch([stock()]);
  });

  it("pulls the required orders window and persists demand + multiple forecast horizons", async () => {
    const wbClient = fakeClient([[orderRow({ srid: "a" }), orderRow({ srid: "b" })]]);

    const result = await runSalesForecastMvp(
      {
        db,
        wbClient,
        ordersRepository,
        demandRepository,
        stockRepository,
        supplyRepository,
        forecastRepository,
        logger,
        now: () => new Date("2026-04-17T12:00:00.000Z"),
      },
      {
        snapshotDate: "2026-04-17",
        horizons: [60, 30],
      },
    );

    expect(result.ordersWindowFrom).toBe("2026-03-18");
    expect(result.ordersWindowTo).toBe("2026-04-16");
    expect(result.horizons).toEqual([30, 60]);
    expect(result.ordersImport.rowsInserted).toBe(1);
    expect(result.demandSnapshot.rowsInserted).toBe(1);
    expect(result.forecasts.map((f) => f.horizonDays)).toEqual([30, 60]);
    expect(result.forecasts.every((f) => f.rowsInserted === 1)).toBe(true);
    expect(ordersRepository.countAll()).toBe(1);
    expect(demandRepository.countForDate("2026-04-17")).toBe(1);
    expect(forecastRepository.countForKey("2026-04-17", 30)).toBe(1);
    expect(forecastRepository.countForKey("2026-04-17", 60)).toBe(1);
  });

  it("implements dry-run via rollback: returns real counts but leaves DB unchanged", async () => {
    const wbClient = fakeClient([[orderRow({ srid: "a" }), orderRow({ srid: "b" })]]);

    const result = await runSalesForecastMvp(
      {
        db,
        wbClient,
        ordersRepository,
        demandRepository,
        stockRepository,
        supplyRepository,
        forecastRepository,
        logger,
        now: () => new Date("2026-04-17T12:00:00.000Z"),
      },
      {
        snapshotDate: "2026-04-17",
        horizons: [30],
        dryRun: true,
      },
    );

    expect(result.dryRun).toBe(true);
    expect(result.ordersImport.dryRun).toBe(true);
    expect(result.demandSnapshot.dryRun).toBe(true);
    expect(result.forecasts[0]!.dryRun).toBe(true);
    expect(result.ordersImport.rowsInserted).toBe(1);
    expect(result.demandSnapshot.rowsInserted).toBe(1);
    expect(result.forecasts[0]!.rowsInserted).toBe(1);
    expect(ordersRepository.countAll()).toBe(0);
    expect(demandRepository.countForDate("2026-04-17")).toBe(0);
    expect(forecastRepository.countForKey("2026-04-17", 30)).toBe(0);
  });

  it("dry-run does not roll back wb_stock_snapshots written before the command", async () => {
    const preCount = stockRepository.countForSnapshot("2026-04-17T08:00:00.000Z");
    expect(preCount).toBe(1);

    const wbClient = fakeClient([[orderRow({ srid: "a" }), orderRow({ srid: "b" })]]);

    await runSalesForecastMvp(
      {
        db,
        wbClient,
        ordersRepository,
        demandRepository,
        stockRepository,
        supplyRepository,
        forecastRepository,
        logger,
        now: () => new Date("2026-04-17T12:00:00.000Z"),
      },
      {
        snapshotDate: "2026-04-17",
        horizons: [30],
        dryRun: true,
      },
    );

    expect(stockRepository.countForSnapshot("2026-04-17T08:00:00.000Z")).toBe(preCount);
    expect(ordersRepository.countAll()).toBe(0);
  });
});
