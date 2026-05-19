import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { importProductQuants } from "../src/application/importProductQuants.js";
import { parseProductQuantsCsv } from "../src/application/parseProductQuantsCsv.js";
import { openDatabase } from "../src/infra/db.js";
import { ProductQuantRepository } from "../src/infra/productQuantRepository.js";

function silentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Parameters<typeof importProductQuants>[0]["logger"];
}

function fakeReader(byPath: Record<string, string>) {
  return vi.fn(async (path: string) => {
    const hit = byPath[path];
    if (hit === undefined) throw new Error(`ENOENT: no such file "${path}"`);
    return Buffer.from(hit);
  });
}

describe("parseProductQuantsCsv", () => {
  it("parses BOM CSV and defaults missing or zero quant to 1", () => {
    const result = parseProductQuantsCsv(
      "\uFEFFАртикул,квант\nA,6\nB,\nC,0\n,\n",
    );

    expect(result.rows).toEqual([
      { vendorCode: "A", unitsPerBox: 6 },
      { vendorCode: "B", unitsPerBox: 1 },
      { vendorCode: "C", unitsPerBox: 1 },
    ]);
    expect(result.defaulted).toBe(2);
    expect(result.skippedBlankVendor).toBe(1);
    expect(result.detection.vendorColumn).toBe("Артикул");
    expect(result.detection.quantColumn).toBe("квант");
  });
});

describe("importProductQuants", () => {
  let repo: ProductQuantRepository;

  beforeEach(() => {
    repo = new ProductQuantRepository(openDatabase(":memory:"));
  });

  it("replaces the quant reference table idempotently", async () => {
    const path = resolve("/tmp/kvants.csv");
    const firstReader = fakeReader({
      [path]: "\uFEFFАртикул,квант\nA,6\nB,\nC,0\n,\n",
    });
    const secondReader = fakeReader({
      [path]: "Артикул,квант\nA,10\n",
    });

    const first = await importProductQuants(
      {
        repository: repo,
        logger: silentLogger(),
        now: () => new Date("2026-05-19T12:00:00.000Z"),
        readFile: firstReader,
      },
      { file: path },
    );
    expect(first.wasUpdate).toBe(false);
    expect(first.inserted).toBe(3);
    expect(first.defaulted).toBe(2);
    expect(first.skippedBlankVendor).toBe(1);
    expect(repo.allByVendor()).toEqual(
      new Map<string, number>([
        ["A", 6],
        ["B", 1],
        ["C", 1],
      ]),
    );

    const second = await importProductQuants(
      {
        repository: repo,
        logger: silentLogger(),
        now: () => new Date("2026-05-19T12:01:00.000Z"),
        readFile: secondReader,
      },
      { file: path },
    );
    expect(second.wasUpdate).toBe(true);
    expect(second.inserted).toBe(1);
    expect(repo.allByVendor()).toEqual(new Map<string, number>([["A", 10]]));
  });
});
