import { describe, it, expect } from "vitest";
import {
  parseTariffDecimal,
  toEffectiveDate,
} from "../src/domain/wbWarehouseTariff.js";
import {
  mapAcceptanceCoefficient,
  mapBoxTariffEnvelope,
  mapPalletTariffEnvelope,
} from "../src/application/mapWbWarehouseTariff.js";

describe("parseTariffDecimal", () => {
  it("parses Russian decimal strings (comma separator)", () => {
    expect(parseTariffDecimal("0,14")).toBe(0.14);
    expect(parseTariffDecimal("11,2")).toBeCloseTo(11.2, 10);
    expect(parseTariffDecimal("48")).toBe(48);
  });

  it("strips thousand separators (non-breaking space included)", () => {
    expect(parseTariffDecimal("1 039")).toBe(1039);
    expect(parseTariffDecimal("1\u00A0039")).toBe(1039);
    expect(parseTariffDecimal("1 039,5")).toBe(1039.5);
  });

  it("returns null for empty / missing / unparseable input", () => {
    expect(parseTariffDecimal("")).toBeNull();
    expect(parseTariffDecimal("   ")).toBeNull();
    expect(parseTariffDecimal("-")).toBeNull();
    expect(parseTariffDecimal(null)).toBeNull();
    expect(parseTariffDecimal(undefined)).toBeNull();
    expect(parseTariffDecimal("abc")).toBeNull();
  });

  it("passes through finite numbers, rejects non-finite", () => {
    expect(parseTariffDecimal(42)).toBe(42);
    expect(parseTariffDecimal(35.65)).toBe(35.65);
    expect(parseTariffDecimal(Number.NaN)).toBeNull();
    expect(parseTariffDecimal(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("toEffectiveDate", () => {
  it("truncates RFC3339 to YYYY-MM-DD", () => {
    expect(toEffectiveDate("2024-09-04T00:00:00Z")).toBe("2024-09-04");
    expect(toEffectiveDate("2026-05-11T03:00:00+03:00")).toBe("2026-05-11");
  });
  it("returns short strings as-is", () => {
    expect(toEffectiveDate("2024-09-04")).toBe("2024-09-04");
    expect(toEffectiveDate("")).toBe("");
  });
});

describe("mapBoxTariffEnvelope", () => {
  const fetchedAt = "2026-05-11T10:00:00.000Z";
  const tariffDate = "2026-05-11";

  it("maps a full warehouse row, parsing decimals and trimming names", () => {
    const body = {
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
              boxDeliveryMarketplaceBase: "40",
              boxDeliveryMarketplaceLiter: "11",
              boxDeliveryMarketplaceCoefExpr: "125",
              boxStorageBase: "0,14",
              boxStorageLiter: "0,07",
              boxStorageCoefExpr: "115",
            },
          ],
        },
      },
    };
    const r = mapBoxTariffEnvelope(body, { tariffDate, fetchedAt });
    expect(r.records).toHaveLength(1);
    expect(r.skipped).toHaveLength(0);
    expect(r.dtNextBox).toBe("2026-06-01");
    expect(r.dtTillMax).toBe("2026-06-30");
    expect(r.records[0]).toEqual({
      tariffDate,
      fetchedAt,
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
    });
  });

  it("skips a row missing warehouseName but keeps siblings", () => {
    const body = {
      response: {
        data: {
          dtNextBox: null,
          dtTillMax: null,
          warehouseList: [
            { boxDeliveryBase: "1" }, // no warehouseName
            { warehouseName: "Электросталь", boxDeliveryBase: "55" },
          ],
        },
      },
    };
    const r = mapBoxTariffEnvelope(body, { tariffDate, fetchedAt });
    expect(r.records).toHaveLength(1);
    expect(r.skipped).toHaveLength(1);
    expect(r.records[0]!.warehouseName).toBe("Электросталь");
  });

  it("throws on a structurally invalid envelope", () => {
    expect(() =>
      mapBoxTariffEnvelope({ data: { warehouseList: [] } }, {
        tariffDate,
        fetchedAt,
      }),
    ).toThrow(/unexpected/i);
  });

  it("returns nulls for empty / missing numeric fields", () => {
    const body = {
      response: {
        data: {
          warehouseList: [
            {
              warehouseName: "Алматы",
              geoName: "",
              boxDeliveryBase: "",
              boxDeliveryLiter: null,
            },
          ],
        },
      },
    };
    const r = mapBoxTariffEnvelope(body, { tariffDate, fetchedAt });
    expect(r.records[0]).toMatchObject({
      warehouseName: "Алматы",
      geoName: null,
      boxDeliveryBase: null,
      boxDeliveryLiter: null,
      boxStorageBase: null,
    });
  });
});

describe("mapPalletTariffEnvelope", () => {
  const fetchedAt = "2026-05-11T10:00:00.000Z";
  const tariffDate = "2026-05-11";

  it("maps a pallet row", () => {
    const body = {
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
    const r = mapPalletTariffEnvelope(body, { tariffDate, fetchedAt });
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({
      tariffDate,
      fetchedAt,
      warehouseName: "Коледино",
      palletDeliveryValueBase: 51,
      palletDeliveryValueLiter: 11.9,
      palletDeliveryExpr: 170,
      palletStorageValueExpr: 35.65,
      palletStorageExpr: 155,
      dtNextPallet: "2026-06-01",
    });
  });
});

describe("mapAcceptanceCoefficient", () => {
  const fetchedAt = "2026-05-11T10:00:00.000Z";

  it("maps a free-acceptance row (coefficient 0)", () => {
    const raw = {
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
    };
    const r = mapAcceptanceCoefficient(raw, { fetchedAt });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.record).toEqual({
      fetchedAt,
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
    });
  });

  it("maps an unavailable row (coefficient -1, blanks → null)", () => {
    const raw = {
      date: "2026-05-13T00:00:00Z",
      coefficient: -1,
      warehouseID: 117501,
      warehouseName: "Электросталь",
      allowUnload: false,
      boxTypeID: 5,
      boxTypeName: "Монопаллеты",
      storageCoef: "",
      deliveryCoef: "",
      deliveryBaseLiter: "",
      deliveryAdditionalLiter: "",
      storageBaseLiter: "",
      storageAdditionalLiter: "",
      isSortingCenter: false,
    };
    const r = mapAcceptanceCoefficient(raw, { fetchedAt });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.record).toMatchObject({
      coefficient: -1,
      allowUnload: false,
      storageCoef: null,
      deliveryCoef: null,
      storageBaseLiter: null,
    });
  });

  it("rejects rows missing required ids", () => {
    const r = mapAcceptanceCoefficient(
      { date: "2026-05-12", coefficient: 0 },
      { fetchedAt },
    );
    expect(r.ok).toBe(false);
  });
});
