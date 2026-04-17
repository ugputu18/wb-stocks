import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDatabase } from "../src/infra/db.js";
import { StockSnapshotRepository } from "../src/infra/stockSnapshotRepository.js";
import { importWbStocks } from "../src/application/importWbStocks.js";
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
  } as unknown as Parameters<typeof importWbStocks>[0]["logger"];
}

function fakeWbClient(rows: unknown[]): WbStatsClient {
  return {
    getSupplierStocks: vi.fn().mockResolvedValue(rows),
  } as unknown as WbStatsClient;
}

describe("importWbStocks use case", () => {
  let repo: StockSnapshotRepository;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    repo = new StockSnapshotRepository(db);
  });

  it("maps and stores rows, reporting counts", async () => {
    const rows = [
      {
        lastChangeDate: "2026-04-17T09:00:00",
        warehouseName: "Коледино",
        supplierArticle: "SKU-1",
        nmId: 1,
        barcode: "111",
        quantity: 10,
        inWayToClient: 1,
        inWayFromClient: 0,
        quantityFull: 11,
        techSize: "0",
      },
      {
        warehouseName: "Электросталь",
        supplierArticle: "SKU-1",
        nmId: 1,
        barcode: "111",
        quantity: 5,
        techSize: "0",
      },
    ];

    const result = await importWbStocks(
      {
        wbClient: fakeWbClient(rows),
        repository: repo,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T10:00:00.000Z"),
      },
    );

    expect(result.fetched).toBe(2);
    expect(result.mapped).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.inserted).toBe(2);
    expect(result.snapshotAt).toBe("2026-04-17T10:00:00.000Z");
    expect(repo.countForSnapshot(result.snapshotAt)).toBe(2);
  });

  it("skips malformed rows but saves the rest", async () => {
    const rows = [
      { warehouseName: "A", nmId: 1, quantity: 10 },
      { warehouseName: "B", nmId: "oops", quantity: 10 }, // bad
      null, // bad
      { warehouseName: "C", nmId: 2, quantity: 5 },
    ];

    const result = await importWbStocks({
      wbClient: fakeWbClient(rows),
      repository: repo,
      logger: silentLogger(),
      now: () => new Date("2026-04-17T10:00:00.000Z"),
    });

    expect(result.fetched).toBe(4);
    expect(result.mapped).toBe(2);
    expect(result.skipped).toBe(2);
    expect(result.inserted).toBe(2);
  });

  it("is idempotent within the same snapshotAt", async () => {
    const rows = [
      { warehouseName: "A", nmId: 1, quantity: 10, barcode: "1" },
    ];
    const fixedNow = () => new Date("2026-04-17T10:00:00.000Z");

    const first = await importWbStocks({
      wbClient: fakeWbClient(rows),
      repository: repo,
      logger: silentLogger(),
      now: fixedNow,
    });
    const second = await importWbStocks({
      wbClient: fakeWbClient(rows),
      repository: repo,
      logger: silentLogger(),
      now: fixedNow,
    });

    expect(first.inserted).toBe(1);
    expect(second.inserted).toBe(0);
    expect(repo.countForSnapshot(first.snapshotAt)).toBe(1);
  });

  it("propagates WB client errors instead of swallowing them", async () => {
    const failingClient = {
      getSupplierStocks: vi.fn().mockRejectedValue(new Error("boom")),
    } as unknown as WbStatsClient;

    await expect(
      importWbStocks({
        wbClient: failingClient,
        repository: repo,
        logger: silentLogger(),
      }),
    ).rejects.toThrow("boom");
  });

  it("passes dateFrom down to the client", async () => {
    const client = fakeWbClient([]);
    await importWbStocks(
      { wbClient: client, repository: repo, logger: silentLogger() },
      { dateFrom: "2025-01-01" },
    );
    expect(client.getSupplierStocks).toHaveBeenCalledWith({
      dateFrom: "2025-01-01",
    });
  });
});
