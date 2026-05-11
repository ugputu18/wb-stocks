import { describe, it, expect, beforeEach } from "vitest";
import { openDatabase } from "../src/infra/db.js";
import { WbWarehouseTariffRepository } from "../src/infra/wbWarehouseTariffRepository.js";
import type {
  WbAcceptanceCoefficientRecord,
  WbBoxTariffRecord,
  WbPalletTariffRecord,
} from "../src/domain/wbWarehouseTariff.js";

function box(o: Partial<WbBoxTariffRecord> = {}): WbBoxTariffRecord {
  return {
    tariffDate: "2026-05-11",
    fetchedAt: "2026-05-11T10:00:00.000Z",
    warehouseName: "Коледино",
    geoName: "Центральный федеральный округ",
    boxDeliveryBase: 48,
    boxDeliveryLiter: 11.2,
    boxDeliveryCoefExpr: 160,
    boxDeliveryMarketplaceBase: 40,
    boxDeliveryMarketplaceLiter: 11,
    boxDeliveryMarketplaceCoefExpr: 125,
    boxStorageBase: 0.14,
    boxStorageLiter: 0.07,
    boxStorageCoefExpr: 115,
    dtNextBox: "2026-06-01",
    dtTillMax: "2026-06-30",
    ...o,
  };
}

function pallet(o: Partial<WbPalletTariffRecord> = {}): WbPalletTariffRecord {
  return {
    tariffDate: "2026-05-11",
    fetchedAt: "2026-05-11T10:00:00.000Z",
    warehouseName: "Коледино",
    geoName: null,
    palletDeliveryValueBase: 51,
    palletDeliveryValueLiter: 11.9,
    palletDeliveryExpr: 170,
    palletStorageValueExpr: 35.65,
    palletStorageExpr: 155,
    dtNextPallet: "2026-06-01",
    dtTillMax: "2026-06-30",
    ...o,
  };
}

function acceptance(
  o: Partial<WbAcceptanceCoefficientRecord> = {},
): WbAcceptanceCoefficientRecord {
  return {
    fetchedAt: "2026-05-11T10:00:00.000Z",
    effectiveDate: "2026-05-12",
    warehouseId: 507,
    warehouseName: "Коледино",
    boxTypeId: 2,
    boxTypeName: "Короба",
    coefficient: 0,
    allowUnload: true,
    storageCoef: 1,
    deliveryCoef: 1,
    deliveryBaseLiter: 48,
    deliveryAdditionalLiter: 11.2,
    storageBaseLiter: 0.14,
    storageAdditionalLiter: 0.07,
    isSortingCenter: false,
    ...o,
  };
}

describe("WbWarehouseTariffRepository — box", () => {
  let repo: WbWarehouseTariffRepository;
  beforeEach(() => {
    repo = new WbWarehouseTariffRepository(openDatabase(":memory:"));
  });

  it("stores a batch and reads it back", () => {
    const r = repo.saveBoxBatch([
      box(),
      box({ warehouseName: "Электросталь", boxDeliveryBase: 55 }),
    ]);
    expect(r.inserted).toBe(2);
    const rows = repo.getBoxForDate("2026-05-11");
    expect(rows).toHaveLength(2);
    expect(rows.map((x) => x.warehouseName).sort()).toEqual([
      "Коледино",
      "Электросталь",
    ]);
  });

  it("upserts on conflict (re-run for same date overwrites)", () => {
    repo.saveBoxBatch([box({ boxDeliveryBase: 48 })]);
    repo.saveBoxBatch([
      box({ boxDeliveryBase: 60, fetchedAt: "2026-05-11T18:00:00.000Z" }),
    ]);
    const rows = repo.getBoxForDate("2026-05-11");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.boxDeliveryBase).toBe(60);
    expect(rows[0]!.fetchedAt).toBe("2026-05-11T18:00:00.000Z");
  });

  it("keeps separate rows for different dates", () => {
    repo.saveBoxBatch([
      box({ tariffDate: "2026-05-11" }),
      box({ tariffDate: "2026-05-12" }),
    ]);
    expect(repo.getBoxForDate("2026-05-11")).toHaveLength(1);
    expect(repo.getBoxForDate("2026-05-12")).toHaveLength(1);
  });

  it("preserves null fields end-to-end", () => {
    repo.saveBoxBatch([
      box({
        warehouseName: "X",
        geoName: null,
        boxDeliveryBase: null,
        boxDeliveryLiter: null,
        dtNextBox: null,
      }),
    ]);
    const [row] = repo.getBoxForDate("2026-05-11");
    expect(row).toBeDefined();
    expect(row!.geoName).toBeNull();
    expect(row!.boxDeliveryBase).toBeNull();
    expect(row!.dtNextBox).toBeNull();
  });
});

describe("WbWarehouseTariffRepository — pallet", () => {
  let repo: WbWarehouseTariffRepository;
  beforeEach(() => {
    repo = new WbWarehouseTariffRepository(openDatabase(":memory:"));
  });

  it("stores and reads pallet rows", () => {
    repo.savePalletBatch([pallet()]);
    const rows = repo.getPalletForDate("2026-05-11");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.palletStorageValueExpr).toBe(35.65);
  });

  it("upserts on (date, warehouse)", () => {
    repo.savePalletBatch([pallet({ palletDeliveryValueBase: 51 })]);
    repo.savePalletBatch([pallet({ palletDeliveryValueBase: 60 })]);
    const rows = repo.getPalletForDate("2026-05-11");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.palletDeliveryValueBase).toBe(60);
  });
});

describe("WbWarehouseTariffRepository — acceptance", () => {
  let repo: WbWarehouseTariffRepository;
  beforeEach(() => {
    repo = new WbWarehouseTariffRepository(openDatabase(":memory:"));
  });

  it("stores rows and round-trips booleans correctly", () => {
    const r = repo.saveAcceptanceBatch([
      acceptance(),
      acceptance({
        warehouseId: 117501,
        warehouseName: "Электросталь",
        boxTypeId: 5,
        boxTypeName: "Монопаллеты",
        coefficient: -1,
        allowUnload: false,
        isSortingCenter: false,
      }),
      acceptance({
        effectiveDate: "2026-05-13",
        coefficient: 2,
        allowUnload: true,
      }),
    ]);
    expect(r.inserted).toBe(3);
    const rows = repo.getLatestAcceptance();
    expect(rows).toHaveLength(3);
    const unavailable = rows.find((x) => x.warehouseId === 117501)!;
    expect(unavailable.coefficient).toBe(-1);
    expect(unavailable.allowUnload).toBe(false);
    expect(unavailable.isSortingCenter).toBe(false);
  });

  it("ignores duplicates within the same fetched_at batch", () => {
    const row = acceptance();
    const first = repo.saveAcceptanceBatch([row]);
    const second = repo.saveAcceptanceBatch([row]);
    expect(first.inserted).toBe(1);
    expect(second.inserted).toBe(0);
  });

  it("preserves history across different fetched_at runs and only returns the latest", () => {
    repo.saveAcceptanceBatch([
      acceptance({ fetchedAt: "2026-05-11T08:00:00.000Z", coefficient: 0 }),
    ]);
    repo.saveAcceptanceBatch([
      acceptance({ fetchedAt: "2026-05-11T20:00:00.000Z", coefficient: 5 }),
    ]);
    const latest = repo.getLatestAcceptance();
    expect(latest).toHaveLength(1);
    expect(latest[0]!.coefficient).toBe(5);
    expect(latest[0]!.fetchedAt).toBe("2026-05-11T20:00:00.000Z");
  });

  it("returns empty array when no rows are stored", () => {
    expect(repo.getLatestAcceptance()).toEqual([]);
  });

  it("treats null box_type_id as a distinct key value", () => {
    repo.saveAcceptanceBatch([
      acceptance({ warehouseId: 1, boxTypeId: null, coefficient: 0 }),
      acceptance({ warehouseId: 1, boxTypeId: 2, coefficient: 1 }),
    ]);
    const latest = repo.getLatestAcceptance();
    expect(latest).toHaveLength(2);
  });
});
