import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDatabase } from "../src/infra/db.js";
import { WbSupplyRepository } from "../src/infra/wbSupplyRepository.js";
import { importWbSupplies } from "../src/application/importWbSupplies.js";
import type { WbSuppliesClient } from "../src/infra/wbSuppliesClient.js";

function silentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Parameters<typeof importWbSupplies>[0]["logger"];
}

interface ClientStub {
  list?: unknown[][]; // pages
  details?: Record<number, unknown>;
  goods?: Record<number, unknown[]>;
  detailsErr?: Set<number>;
  goodsErr?: Set<number>;
}

function fakeClient(stub: ClientStub): WbSuppliesClient {
  let pageIdx = 0;
  return {
    listSupplies: vi.fn().mockImplementation(async () => {
      const pages = stub.list ?? [[]];
      const p = pages[pageIdx] ?? [];
      pageIdx += 1;
      return p;
    }),
    getSupplyDetails: vi.fn().mockImplementation(async (id: number) => {
      if (stub.detailsErr?.has(id)) throw new Error(`details err ${id}`);
      return stub.details?.[id] ?? null;
    }),
    getSupplyGoods: vi.fn().mockImplementation(async (id: number) => {
      if (stub.goodsErr?.has(id)) throw new Error(`goods err ${id}`);
      return stub.goods?.[id] ?? [];
    }),
  } as unknown as WbSuppliesClient;
}

const LIST_A = {
  phone: "+7 *** ** **",
  supplyID: 1001,
  preorderID: 5001,
  createDate: "2026-04-09T14:55:52+03:00",
  supplyDate: "2026-04-17T00:00:00+03:00",
  factDate: null,
  updatedDate: "2026-04-09T15:00:00+03:00",
  statusID: 2,
  boxTypeID: 2,
};
const DETAILS_A = {
  statusID: 2,
  warehouseID: 507,
  warehouseName: "Коледино",
  quantity: 10,
  acceptedQuantity: 0,
  readyForSaleQuantity: 0,
  unloadingQuantity: 0,
  depersonalizedQuantity: 0,
};
const GOODS_A = [
  {
    barcode: "111",
    vendorCode: "SKU-1",
    nmID: 42,
    techSize: "0",
    color: "red",
    quantity: 7,
    acceptedQuantity: 0,
    readyForSaleQuantity: 0,
    unloadingQuantity: 0,
  },
  {
    barcode: "222",
    vendorCode: "SKU-2",
    nmID: 43,
    techSize: "M",
    color: "blue",
    quantity: 3,
    acceptedQuantity: 0,
    readyForSaleQuantity: 0,
    unloadingQuantity: 0,
  },
];

const LIST_B = {
  phone: "",
  supplyID: 1002,
  preorderID: 0,
  createDate: "2026-04-10T00:54:05+03:00",
  supplyDate: "2026-04-10T00:00:00+03:00",
  factDate: "2026-04-10T00:54:05+03:00",
  updatedDate: "2026-04-10T02:23:42+03:00",
  statusID: 5,
  boxTypeID: 0,
};
const DETAILS_B = {
  statusID: 5,
  virtualTypeID: 5,
  warehouseID: 120762,
  warehouseName: "Электросталь",
  quantity: 1,
  acceptedQuantity: 1,
  readyForSaleQuantity: 1,
};

const LIST_PREORDER_ONLY = {
  supplyID: null,
  preorderID: 9999,
  createDate: "2026-04-12T00:00:00+03:00",
  statusID: 1,
  boxTypeID: 0,
};

describe("importWbSupplies", () => {
  let repo: WbSupplyRepository;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    repo = new WbSupplyRepository(db);
  });

  it("end-to-end: list + details + goods → DB", async () => {
    const client = fakeClient({
      list: [[LIST_A, LIST_B, LIST_PREORDER_ONLY]],
      details: { 1001: DETAILS_A, 1002: DETAILS_B },
      goods: { 1001: GOODS_A, 1002: [] },
    });

    const r = await importWbSupplies(
      {
        wbClient: client,
        repository: repo,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T10:00:00.000Z"),
      },
      { dateFrom: "2026-04-01" },
    );

    expect(r.fetchedRows).toBe(3);
    expect(r.validRows).toBe(2);
    expect(r.preorderOnly).toBe(1);
    expect(r.created).toBe(2);
    expect(r.updated).toBe(0);
    expect(r.unchanged).toBe(0);
    expect(r.statusChanged).toBe(2);
    expect(r.detailsFetched).toBe(2);
    expect(r.itemsFetched).toBe(2);
    expect(r.itemsTotal).toBe(2);
    expect(repo.countSupplies()).toBe(2);
    expect(repo.countItemsForSupply(1001)).toBe(2);
    expect(repo.countItemsForSupply(1002)).toBe(0);

    const a = repo.getBySupplyId(1001);
    expect(a?.warehouseName).toBe("Коледино");
    expect(a?.quantity).toBe(10);
  });

  it("upsert by supplyID: rerun does not duplicate anything", async () => {
    const client = fakeClient({
      list: [[LIST_A]],
      details: { 1001: DETAILS_A },
      goods: { 1001: GOODS_A },
    });

    const first = await importWbSupplies(
      {
        wbClient: client,
        repository: repo,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T10:00:00.000Z"),
      },
      { dateFrom: "2026-04-01" },
    );
    expect(first.created).toBe(1);

    // rerun with the SAME data → must not create / update anything
    const client2 = fakeClient({
      list: [[LIST_A]],
      details: { 1001: DETAILS_A },
      goods: { 1001: GOODS_A },
    });
    const second = await importWbSupplies(
      {
        wbClient: client2,
        repository: repo,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T10:05:00.000Z"),
      },
      { dateFrom: "2026-04-01" },
    );
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(1);
    expect(second.statusChanged).toBe(0);
    expect(repo.countSupplies()).toBe(1);
    expect(repo.countItemsForSupply(1001)).toBe(2);
    expect(repo.countStatusHistory(1001)).toBe(1);
  });

  it("status change → 'updated' + a new history row", async () => {
    const client = fakeClient({
      list: [[LIST_A]],
      details: { 1001: DETAILS_A },
      goods: { 1001: GOODS_A },
    });
    await importWbSupplies(
      {
        wbClient: client,
        repository: repo,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T10:00:00.000Z"),
      },
      { dateFrom: "2026-04-01" },
    );

    const movedList = {
      ...LIST_A,
      statusID: 5,
      factDate: "2026-04-17T11:00:00+03:00",
    };
    const movedDetails = {
      ...DETAILS_A,
      statusID: 5,
      acceptedQuantity: 10,
      readyForSaleQuantity: 8,
    };
    const client2 = fakeClient({
      list: [[movedList]],
      details: { 1001: movedDetails },
      goods: { 1001: GOODS_A },
    });
    const second = await importWbSupplies(
      {
        wbClient: client2,
        repository: repo,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T11:00:00.000Z"),
      },
      { dateFrom: "2026-04-01" },
    );
    expect(second.updated).toBe(1);
    expect(second.statusChanged).toBe(1);
    expect(repo.countStatusHistory(1001)).toBe(2);
    expect(repo.getBySupplyId(1001)?.statusId).toBe(5);
    expect(repo.getBySupplyId(1001)?.acceptedQuantity).toBe(10);
  });

  it("paginates list responses until short page", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      supplyID: 10_000 + i,
      preorderID: 0,
      statusID: 5,
    }));
    const page2 = [{ supplyID: 11_000, preorderID: 0, statusID: 5 }];
    const client = fakeClient({
      list: [page1, page2],
      details: {},
      goods: {},
    });
    const r = await importWbSupplies(
      {
        wbClient: client,
        repository: repo,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T10:00:00.000Z"),
      },
      { dateFrom: "2026-04-01", withDetails: false, withItems: false },
    );
    expect(r.fetchedRows).toBe(1001);
    expect(r.created).toBe(1001);
    expect(client.listSupplies).toHaveBeenCalledTimes(2);
  });

  it("dry-run: nothing is persisted", async () => {
    const client = fakeClient({
      list: [[LIST_A, LIST_B]],
      details: { 1001: DETAILS_A, 1002: DETAILS_B },
      goods: { 1001: GOODS_A, 1002: [] },
    });
    const r = await importWbSupplies(
      { wbClient: client, repository: repo, logger: silentLogger() },
      { dateFrom: "2026-04-01", dryRun: true },
    );
    expect(r.dryRun).toBe(true);
    expect(r.validRows).toBe(2);
    expect(r.created + r.updated + r.unchanged).toBe(0);
    expect(repo.countSupplies()).toBe(0);
  });

  it("does not blow up on per-supply details/goods errors", async () => {
    const client = fakeClient({
      list: [[LIST_A, LIST_B]],
      details: { 1001: DETAILS_A },
      goods: { 1001: GOODS_A },
      detailsErr: new Set([1002]),
      goodsErr: new Set([1002]),
    });
    const r = await importWbSupplies(
      {
        wbClient: client,
        repository: repo,
        logger: silentLogger(),
        now: () => new Date("2026-04-17T10:00:00.000Z"),
      },
      { dateFrom: "2026-04-01" },
    );
    expect(r.created).toBe(2);
    expect(r.detailsFailed).toBe(1);
    expect(r.itemsFailed).toBe(1);
    expect(repo.getBySupplyId(1002)?.warehouseName).toBeNull();
  });

  it("propagates list errors (fail-loud on the primary endpoint)", async () => {
    const failing = {
      listSupplies: vi.fn().mockRejectedValue(new Error("boom")),
      getSupplyDetails: vi.fn(),
      getSupplyGoods: vi.fn(),
    } as unknown as WbSuppliesClient;
    await expect(
      importWbSupplies(
        { wbClient: failing, repository: repo, logger: silentLogger() },
        { dateFrom: "2026-04-01" },
      ),
    ).rejects.toThrow("boom");
  });

  it("default dateFrom is today − 30 days when not provided", async () => {
    const client = fakeClient({ list: [[]], details: {}, goods: {} });
    await importWbSupplies({
      wbClient: client,
      repository: repo,
      logger: silentLogger(),
      now: () => new Date("2026-04-17T10:00:00.000Z"),
    });
    expect(client.listSupplies).toHaveBeenCalledWith(
      expect.objectContaining({
        dates: [
          expect.objectContaining({
            from: "2026-03-18",
            till: "2026-04-17",
            type: "createDate",
          }),
        ],
      }),
    );
  });
});
