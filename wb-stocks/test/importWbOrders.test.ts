import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDatabase } from "../src/infra/db.js";
import { NO_REGION_KEY } from "../src/domain/regionName.js";
import { WbOrdersDailyRepository } from "../src/infra/wbOrdersDailyRepository.js";
import { WbOrdersDailyByRegionRepository } from "../src/infra/wbOrdersDailyByRegionRepository.js";
import {
  importWbOrders,
  aggregateByDay,
} from "../src/application/importWbOrders.js";
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
  } as unknown as Parameters<typeof importWbOrders>[0]["logger"];
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

function row(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-04-15T10:00:00",
    lastChangeDate: "2026-04-15T10:00:00",
    warehouseName: "Коледино",
    supplierArticle: "SKU-1",
    nmId: 100,
    barcode: "111",
    techSize: "0",
    isCancel: false,
    srid: "s-1",
    ...overrides,
  };
}

describe("aggregateByDay", () => {
  it("groups by (orderDate, warehouseKey, nmId, techSize) and counts cancellations separately", () => {
    const rows = [
      row(),
      row({ srid: "s-2" }),
      row({ srid: "s-3", isCancel: true }),
      row({ nmId: 200, srid: "s-4" }),
      row({ warehouseName: "Электросталь", srid: "s-5" }),
      row({ date: "2026-04-14T10:00:00", srid: "s-6" }),
    ].map((r) => {
      // Convert to internal unit shape via the production mapper.
      // Re-use mapWbOrderRow indirectly through importWbOrders below;
      // for this purity test we craft units manually instead.
      return {
        orderDate: String(r.date).slice(0, 10),
        lastChangeDate: r.lastChangeDate,
        warehouseNameRaw: r.warehouseName,
        warehouseKey: String(r.warehouseName).toLocaleLowerCase("ru-RU"),
        regionNameRaw: null,
        regionKey: NO_REGION_KEY,
        nmId: r.nmId,
        techSize: r.techSize,
        vendorCode: r.supplierArticle,
        barcode: r.barcode,
        isCancel: r.isCancel,
        srid: r.srid,
      };
    });

    const out = aggregateByDay(rows, "2026-04-17T00:00:00.000Z");
    const apr15 = out.get("2026-04-15")!;
    const apr14 = out.get("2026-04-14")!;
    expect(apr15).toHaveLength(3); // (kol, 100, 0), (kol, 200, 0), (электросталь, 100, 0)
    expect(apr14).toHaveLength(1);

    const main = apr15.find((r) => r.warehouseKey === "коледино" && r.nmId === 100)!;
    expect(main.units).toBe(2);
    expect(main.cancelledUnits).toBe(1);
    expect(main.grossUnits).toBe(3);
  });
});

describe("importWbOrders use case", () => {
  let repo: WbOrdersDailyRepository;
  let repoRegion: WbOrdersDailyByRegionRepository;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    repo = new WbOrdersDailyRepository(db);
    repoRegion = new WbOrdersDailyByRegionRepository(db);
  });

  it("fetches, aggregates, and replaces days in DB", async () => {
    const client = fakeClient([
      [
        row({ srid: "a" }),
        row({ srid: "b" }),
        row({ srid: "c", isCancel: true }),
        row({ date: "2026-04-14T20:00:00", srid: "d" }),
      ],
    ]);

    const r = await importWbOrders(
      {
        wbClient: client,
        repository: repo,
        ordersByRegionRepository: repoRegion,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T10:00:00.000Z"),
      },
      { dateFrom: "2026-04-01" },
    );

    expect(r.fetchedRows).toBe(4);
    expect(r.validRows).toBe(4);
    expect(r.skippedRows).toBe(0);
    expect(r.daysReplaced).toBe(2);
    expect(r.rowsInserted).toBe(2); // one row per day after aggregation
    expect(r.regionDaysReplaced).toBe(2);
    expect(r.regionRowsInserted).toBe(2);

    expect(repo.countDay("2026-04-15")).toBe(1);
    const fetched = repo.getRange("2026-04-15", "2026-04-15")[0]!;
    expect(fetched.units).toBe(2);
    expect(fetched.cancelledUnits).toBe(1);
    expect(fetched.grossUnits).toBe(3);
    expect(fetched.warehouseKey).toBe("коледино");
  });

  it("is idempotent: re-running with the same input produces the same DB state", async () => {
    const data = [
      row({ srid: "a" }),
      row({ srid: "b" }),
      row({ srid: "c", isCancel: true }),
    ];
    const r1 = await importWbOrders(
      {
        wbClient: fakeClient([data]),
        repository: repo,
        ordersByRegionRepository: repoRegion,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T10:00:00.000Z"),
      },
      { dateFrom: "2026-04-01" },
    );
    const r2 = await importWbOrders(
      {
        wbClient: fakeClient([data]),
        repository: repo,
        ordersByRegionRepository: repoRegion,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T11:00:00.000Z"),
      },
      { dateFrom: "2026-04-01" },
    );

    expect(r1.rowsInserted).toBe(1);
    expect(r1.regionRowsInserted).toBe(1);
    expect(r2.rowsInserted).toBe(1);
    expect(r2.regionRowsInserted).toBe(1);
    expect(r2.rowsDeleted).toBe(1); // overwrote prior day
    expect(repo.countAll()).toBe(1);
  });

  it("re-import after cancellation overwrites yesterday's totals", async () => {
    await importWbOrders(
      {
        wbClient: fakeClient([
          [row({ srid: "a" }), row({ srid: "b" }), row({ srid: "c" })],
        ]),
        repository: repo,
        ordersByRegionRepository: repoRegion,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T10:00:00.000Z"),
      },
      { dateFrom: "2026-04-01" },
    );
    expect(repo.getRange("2026-04-15", "2026-04-15")[0]!.units).toBe(3);

    // WB now reports 1 of those 3 as cancelled.
    await importWbOrders(
      {
        wbClient: fakeClient([
          [
            row({ srid: "a" }),
            row({ srid: "b" }),
            row({ srid: "c", isCancel: true }),
          ],
        ]),
        repository: repo,
        ordersByRegionRepository: repoRegion,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T11:00:00.000Z"),
      },
      { dateFrom: "2026-04-01" },
    );

    const after = repo.getRange("2026-04-15", "2026-04-15")[0]!;
    expect(after.units).toBe(2);
    expect(after.cancelledUnits).toBe(1);
    expect(after.grossUnits).toBe(3);
  });

  it("never overwrites days outside the [dateFrom, dateTo] window", async () => {
    // Pre-seed a day that is BEFORE dateFrom.
    await importWbOrders(
      {
        wbClient: fakeClient([
          [row({ date: "2026-04-01T10:00:00", srid: "old" })],
        ]),
        repository: repo,
        ordersByRegionRepository: repoRegion,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T10:00:00.000Z"),
      },
      { dateFrom: "2026-04-01" },
    );
    expect(repo.countDay("2026-04-01")).toBe(1);

    // New import covers a later window only.
    await importWbOrders(
      {
        wbClient: fakeClient([[row({ srid: "x" })]]),
        repository: repo,
        ordersByRegionRepository: repoRegion,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T11:00:00.000Z"),
      },
      { dateFrom: "2026-04-10" },
    );

    expect(repo.countDay("2026-04-01")).toBe(1); // untouched
    expect(repo.countDay("2026-04-15")).toBe(1);
  });

  it("dryRun parses + aggregates but writes nothing", async () => {
    const r = await importWbOrders(
      {
        wbClient: fakeClient([[row(), row({ srid: "b" })]]),
        repository: repo,
        ordersByRegionRepository: repoRegion,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T10:00:00.000Z"),
      },
      { dateFrom: "2026-04-01", dryRun: true },
    );
    expect(r.validRows).toBe(2);
    expect(r.daysReplaced).toBe(0);
    expect(r.rowsInserted).toBe(0);
    expect(r.regionDaysReplaced).toBe(0);
    expect(r.regionRowsInserted).toBe(0);
    expect(repo.countAll()).toBe(0);
  });

  it("skips and counts malformed rows but keeps the rest", async () => {
    const r = await importWbOrders(
      {
        wbClient: fakeClient([
          [row(), { date: "??", nmId: 1 }, null, row({ srid: "b" })],
        ]),
        repository: repo,
        ordersByRegionRepository: repoRegion,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T10:00:00.000Z"),
      },
      { dateFrom: "2026-04-01" },
    );
    expect(r.fetchedRows).toBe(4);
    expect(r.validRows).toBe(2);
    expect(r.skippedRows).toBe(2);
  });
});
