import { describe, expect, it, vi } from "vitest";
import { importOpticoreStock } from "../src/application/importOpticoreStock.js";
import { openDatabase } from "../src/infra/db.js";
import { OwnStockSnapshotRepository } from "../src/infra/ownStockSnapshotRepository.js";

function silentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Parameters<typeof importOpticoreStock>[0]["logger"];
}

describe("importOpticoreStock", () => {
  it("aggregates OptiCore stock rows into own_stock_snapshots", async () => {
    const db = openDatabase(":memory:");
    const repository = new OwnStockSnapshotRepository(db);
    const client = {
      getStockList: vi.fn(async () => ({
        actualAt: "2026-05-18T10:00:00",
        rows: [
          { warehouseId: "32", skuId: "SKU-1", unitId: "1", stockTypeId: "0", qty: 3 },
          { warehouseId: "32", skuId: "SKU-1", unitId: "1", stockTypeId: "0", qty: 4 },
          { warehouseId: "32", skuId: "SKU-2", unitId: "1", stockTypeId: "1", qty: 99 },
          { warehouseId: "33", skuId: "SKU-3", unitId: "1", stockTypeId: "0", qty: 11 },
        ],
      })),
    };

    const result = await importOpticoreStock(
      {
        client,
        repository,
        logger: silentLogger(),
        now: () => new Date("2026-05-18T12:00:00.000Z"),
      },
      {
        date: "2026-05-18",
        warehouseCode: "main",
        opticoreWarehouseIds: ["32"],
        stockTypeIds: ["0"],
      },
    );

    expect(result.fetched).toBe(4);
    expect(result.filteredOut).toBe(2);
    expect(result.inserted).toBe(1);
    expect(repository.quantitiesByVendor("2026-05-18").get("SKU-1")).toBe(7);

    db.close();
  });

  it("uses sku_id -> vendor_code mapping file when configured", async () => {
    const db = openDatabase(":memory:");
    const repository = new OwnStockSnapshotRepository(db);
    const client = {
      getStockList: vi.fn(async () => ({
        actualAt: "2026-05-18T10:00:00",
        rows: [
          { warehouseId: "32", skuId: "123455", unitId: "1", stockTypeId: "0", qty: 5 },
        ],
      })),
    };

    await importOpticoreStock(
      {
        client,
        repository,
        logger: silentLogger(),
        now: () => new Date("2026-05-18T12:00:00.000Z"),
        readFile: async () => Buffer.from('{ "123455": "35/272" }', "utf8"),
      },
      {
        date: "2026-05-18",
        skuVendorMapFile: "/tmp/opticore-map.json",
      },
    );

    expect(repository.quantitiesByVendor("2026-05-18").get("35/272")).toBe(5);
    expect(repository.quantitiesByVendor("2026-05-18").get("123455")).toBeUndefined();

    db.close();
  });

  it("does not replace an existing snapshot when returned rows cannot be mapped", async () => {
    const db = openDatabase(":memory:");
    const repository = new OwnStockSnapshotRepository(db);
    repository.replaceForDate("2026-05-18", "main", [
      {
        snapshotDate: "2026-05-18",
        warehouseCode: "main",
        vendorCode: "OLD",
        quantity: 9,
        sourceFile: "manual",
        importedAt: "2026-05-18T09:00:00.000Z",
      },
    ]);
    const client = {
      getStockList: vi.fn(async () => ({
        actualAt: "2026-05-18T10:00:00",
        rows: [
          { warehouseId: "32", skuId: "123455", unitId: "1", stockTypeId: "0", qty: 5 },
        ],
      })),
    };

    await expect(
      importOpticoreStock(
        {
          client,
          repository,
          logger: silentLogger(),
          now: () => new Date("2026-05-18T12:00:00.000Z"),
        },
        {
          date: "2026-05-18",
          vendorCodeSource: "article",
        },
      ),
    ).rejects.toThrow("none were importable");

    expect(repository.quantitiesByVendor("2026-05-18").get("OLD")).toBe(9);
    db.close();
  });
});
