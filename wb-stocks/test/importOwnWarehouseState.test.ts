import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDatabase } from "../src/infra/db.js";
import { OwnStockSnapshotRepository } from "../src/infra/ownStockSnapshotRepository.js";
import { importOwnWarehouseState } from "../src/application/importOwnWarehouseState.js";

function silentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Parameters<typeof importOwnWarehouseState>[0]["logger"];
}

function fakeReader(byPath: Record<string, string>) {
  return vi.fn(async (path: string) => {
    const hit = byPath[path];
    if (hit === undefined) throw new Error(`ENOENT: no such file "${path}"`);
    return Buffer.from(hit);
  });
}

describe("importOwnWarehouseState", () => {
  let repo: OwnStockSnapshotRepository;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    repo = new OwnStockSnapshotRepository(db);
  });

  it("defaults date to today (local YMD) when not provided", async () => {
    const today = new Date(2026, 3, 18, 14, 30, 0); // April 18, 2026 local
    const csv = "Артикул,Остаток\nA,1\nB,2\n";
    const readFile = fakeReader({
      [require("node:path").resolve("./store/our0418.csv")]: csv,
    });

    const result = await importOwnWarehouseState(
      { repository: repo, logger: silentLogger(), now: () => today, readFile },
      {},
    );

    expect(result.snapshotDate).toBe("2026-04-18");
    expect(result.warehouseCode).toBe("main");
    expect(result.fetched).toBe(2);
    expect(result.inserted).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.wasUpdate).toBe(false);
    expect(readFile).toHaveBeenCalledWith(
      require("node:path").resolve("./store/our0418.csv"),
    );
  });

  it("uses --date to resolve the conventional filename", async () => {
    const csv = "Артикул,Остаток\nX,42\n";
    const readFile = fakeReader({
      [require("node:path").resolve("./store/our0402.csv")]: csv,
    });

    const result = await importOwnWarehouseState(
      { repository: repo, logger: silentLogger(), readFile },
      { date: "2025-04-02" },
    );

    expect(result.snapshotDate).toBe("2025-04-02");
    expect(result.sourceFile).toBe(
      require("node:path").resolve("./store/our0402.csv"),
    );
    expect(result.inserted).toBe(1);
  });

  it("honours explicit --file override regardless of --date", async () => {
    const csv = "Артикул,Остаток\nA,3\n";
    const readFile = fakeReader({
      [require("node:path").resolve("/tmp/custom.csv")]: csv,
    });

    const result = await importOwnWarehouseState(
      { repository: repo, logger: silentLogger(), readFile },
      { date: "2026-04-18", file: "/tmp/custom.csv" },
    );

    expect(result.sourceFile).toBe("/tmp/custom.csv");
    expect(result.inserted).toBe(1);
  });

  it("reports wasUpdate=true when re-importing for the same date", async () => {
    const csv1 = "Артикул,Остаток\nA,1\nB,2\n";
    const csv2 = "Артикул,Остаток\nA,99\nC,7\n";

    const path = require("node:path").resolve("/tmp/x.csv");
    const reader1 = fakeReader({ [path]: csv1 });
    const reader2 = fakeReader({ [path]: csv2 });

    const first = await importOwnWarehouseState(
      { repository: repo, logger: silentLogger(), readFile: reader1 },
      { date: "2026-04-18", file: "/tmp/x.csv" },
    );
    const second = await importOwnWarehouseState(
      { repository: repo, logger: silentLogger(), readFile: reader2 },
      { date: "2026-04-18", file: "/tmp/x.csv" },
    );

    expect(first.wasUpdate).toBe(false);
    expect(second.wasUpdate).toBe(true);
    expect(second.inserted).toBe(2); // A and C, B gone
    expect(repo.countForDate("2026-04-18", "main")).toBe(2);
  });

  it("passes warehouseCode down into persisted rows", async () => {
    const csv = "Артикул,Остаток\nA,1\n";
    const readFile = fakeReader({
      [require("node:path").resolve("/tmp/r.csv")]: csv,
    });
    await importOwnWarehouseState(
      { repository: repo, logger: silentLogger(), readFile },
      { date: "2026-04-18", warehouseCode: "reserve", file: "/tmp/r.csv" },
    );
    expect(repo.countForDate("2026-04-18", "reserve")).toBe(1);
    expect(repo.countForDate("2026-04-18", "main")).toBe(0);
  });

  it("skips malformed rows but keeps importing the rest", async () => {
    const csv = "Артикул,Остаток\n,10\nA,xxx\nB,5\n";
    const readFile = fakeReader({
      [require("node:path").resolve("/tmp/b.csv")]: csv,
    });
    const result = await importOwnWarehouseState(
      { repository: repo, logger: silentLogger(), readFile },
      { date: "2026-04-18", file: "/tmp/b.csv" },
    );
    expect(result.fetched).toBe(3);
    expect(result.skipped).toBe(2);
    expect(result.inserted).toBe(1);
  });

  it("rejects malformed --date argument", async () => {
    await expect(
      importOwnWarehouseState(
        { repository: repo, logger: silentLogger(), readFile: fakeReader({}) },
        { date: "18.04.2026" },
      ),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("surfaces filesystem errors instead of swallowing them", async () => {
    const readFile = fakeReader({});
    await expect(
      importOwnWarehouseState(
        { repository: repo, logger: silentLogger(), readFile },
        { date: "2026-04-18", file: "/tmp/missing.csv" },
      ),
    ).rejects.toThrow(/ENOENT/);
  });
});
