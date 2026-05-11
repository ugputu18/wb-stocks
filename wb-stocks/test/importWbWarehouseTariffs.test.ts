import { describe, it, expect, beforeEach, vi } from "vitest";
import { openDatabase } from "../src/infra/db.js";
import { WbWarehouseTariffRepository } from "../src/infra/wbWarehouseTariffRepository.js";
import { importWbWarehouseTariffs } from "../src/application/importWbWarehouseTariffs.js";
import type { WbCommonClient } from "../src/infra/wbCommonClient.js";

function silentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Parameters<typeof importWbWarehouseTariffs>[0]["logger"];
}

const BOX_BODY = {
  response: {
    data: {
      dtNextBox: "2026-06-01",
      dtTillMax: "2026-06-30",
      warehouseList: [
        {
          warehouseName: "Коледино",
          geoName: "Центральный федеральный округ",
          boxDeliveryBase: "48",
          boxDeliveryLiter: "11,2",
          boxDeliveryCoefExpr: "160",
          boxStorageBase: "0,14",
          boxStorageLiter: "0,07",
          boxStorageCoefExpr: "115",
        },
        {
          warehouseName: "Хабаровск",
          geoName: "Сибирский и Дальневосточный",
          boxDeliveryBase: "62,5",
          boxDeliveryLiter: "13",
          boxDeliveryCoefExpr: "180",
          boxStorageBase: "0,2",
          boxStorageLiter: "0,1",
          boxStorageCoefExpr: "120",
        },
      ],
    },
  },
};

const PALLET_BODY = {
  response: {
    data: {
      dtNextPallet: "2026-06-01",
      dtTillMax: "2026-06-30",
      warehouseList: [
        {
          warehouseName: "Коледино",
          palletDeliveryValueBase: "51",
          palletDeliveryValueLiter: "11,9",
          palletDeliveryExpr: "170",
          palletStorageValueExpr: "35.65",
          palletStorageExpr: "155",
        },
      ],
    },
  },
};

const ACCEPTANCE_BODY = [
  {
    date: "2026-05-12T00:00:00Z",
    coefficient: 0,
    warehouseID: 507,
    warehouseName: "Коледино",
    allowUnload: true,
    boxTypeID: 2,
    boxTypeName: "Короба",
    storageCoef: "1",
    deliveryCoef: "1",
    deliveryBaseLiter: "48",
    deliveryAdditionalLiter: "11,2",
    storageBaseLiter: "0,14",
    storageAdditionalLiter: "0,07",
    isSortingCenter: false,
  },
  { malformed: true }, // skipped
];

function fakeClient(opts: {
  box?: unknown;
  pallet?: unknown;
  acceptance?: unknown[];
}): WbCommonClient {
  return {
    getBoxTariffs: vi.fn().mockResolvedValue(opts.box ?? BOX_BODY),
    getPalletTariffs: vi.fn().mockResolvedValue(opts.pallet ?? PALLET_BODY),
    getAcceptanceCoefficients: vi
      .fn()
      .mockResolvedValue(opts.acceptance ?? ACCEPTANCE_BODY),
  } as unknown as WbCommonClient;
}

describe("importWbWarehouseTariffs", () => {
  let repo: WbWarehouseTariffRepository;
  beforeEach(() => {
    repo = new WbWarehouseTariffRepository(openDatabase(":memory:"));
  });

  it("imports box, pallet, and acceptance into DB and reports counts", async () => {
    const result = await importWbWarehouseTariffs(
      {
        wbClient: fakeClient({}),
        repository: repo,
        logger: silentLogger(),
        now: () => new Date("2026-05-11T10:00:00.000Z"),
      },
      { tariffDate: "2026-05-11" },
    );

    expect(result.tariffDate).toBe("2026-05-11");
    expect(result.fetchedAt).toBe("2026-05-11T10:00:00.000Z");
    expect(result.box).toEqual({
      fetched: 2,
      inserted: 2,
      skipped: 0,
      dtNextBox: "2026-06-01",
      dtTillMax: "2026-06-30",
    });
    expect(result.pallet).toEqual({
      fetched: 1,
      inserted: 1,
      skipped: 0,
      dtNextPallet: "2026-06-01",
      dtTillMax: "2026-06-30",
    });
    expect(result.acceptance).toEqual({ fetched: 2, inserted: 1, skipped: 1 });

    expect(repo.getBoxForDate("2026-05-11")).toHaveLength(2);
    expect(repo.getPalletForDate("2026-05-11")).toHaveLength(1);
    expect(repo.getLatestAcceptance()).toHaveLength(1);
  });

  it("defaults tariffDate to today's UTC date when not provided", async () => {
    const client = fakeClient({});
    await importWbWarehouseTariffs(
      {
        wbClient: client,
        repository: repo,
        logger: silentLogger(),
        now: () => new Date("2026-05-11T23:45:00.000Z"),
      },
    );
    expect(client.getBoxTariffs).toHaveBeenCalledWith({ date: "2026-05-11" });
    expect(client.getPalletTariffs).toHaveBeenCalledWith({
      date: "2026-05-11",
    });
  });

  it("dry-run does not write to DB but reports fetched counts", async () => {
    const result = await importWbWarehouseTariffs(
      {
        wbClient: fakeClient({}),
        repository: repo,
        logger: silentLogger(),
        now: () => new Date("2026-05-11T10:00:00.000Z"),
      },
      { tariffDate: "2026-05-11", dryRun: true },
    );
    expect(result.box!.inserted).toBe(0);
    expect(result.pallet!.inserted).toBe(0);
    expect(result.acceptance!.inserted).toBe(0);
    expect(result.box!.fetched).toBe(2);
    expect(repo.getBoxForDate("2026-05-11")).toHaveLength(0);
    expect(repo.getLatestAcceptance()).toHaveLength(0);
  });

  it("skip flags short-circuit individual endpoints", async () => {
    const client = fakeClient({});
    const result = await importWbWarehouseTariffs(
      {
        wbClient: client,
        repository: repo,
        logger: silentLogger(),
        now: () => new Date("2026-05-11T10:00:00.000Z"),
      },
      {
        tariffDate: "2026-05-11",
        skipBox: true,
        skipPallet: true,
      },
    );
    expect(result.box).toBeNull();
    expect(result.pallet).toBeNull();
    expect(result.acceptance).not.toBeNull();
    expect(client.getBoxTariffs).not.toHaveBeenCalled();
    expect(client.getPalletTariffs).not.toHaveBeenCalled();
    expect(client.getAcceptanceCoefficients).toHaveBeenCalled();
  });

  it("passes warehouseIds through to the acceptance endpoint", async () => {
    const client = fakeClient({});
    await importWbWarehouseTariffs(
      {
        wbClient: client,
        repository: repo,
        logger: silentLogger(),
        now: () => new Date("2026-05-11T10:00:00.000Z"),
      },
      {
        tariffDate: "2026-05-11",
        skipBox: true,
        skipPallet: true,
        warehouseIds: [507, 117501],
      },
    );
    expect(client.getAcceptanceCoefficients).toHaveBeenCalledWith({
      warehouseIds: [507, 117501],
    });
  });

  it("propagates errors from the client (no swallow)", async () => {
    const failing: WbCommonClient = {
      getBoxTariffs: vi.fn().mockRejectedValue(new Error("boom")),
      getPalletTariffs: vi.fn(),
      getAcceptanceCoefficients: vi.fn(),
    } as unknown as WbCommonClient;
    await expect(
      importWbWarehouseTariffs({
        wbClient: failing,
        repository: repo,
        logger: silentLogger(),
      }),
    ).rejects.toThrow("boom");
  });
});
