import { describe, it, expect } from "vitest";
import {
  buildWarehouseTariffReport,
  type AcceptanceInputRow,
  type BoxTariffInputRow,
  type BuildWarehouseTariffReportInput,
} from "../src/application/buildWarehouseTariffReport.js";

function box(o: Partial<BoxTariffInputRow> = {}): BoxTariffInputRow {
  return {
    warehouseName: "Коледино",
    geoName: "Центральный федеральный округ",
    boxDeliveryBase: 48,
    boxDeliveryLiter: 11.2,
    boxStorageBase: 0.14,
    boxStorageLiter: 0.07,
    dtTillMax: "2026-06-30",
    ...o,
  };
}

function acc(o: Partial<AcceptanceInputRow> = {}): AcceptanceInputRow {
  return {
    warehouseName: "Коледино",
    warehouseId: 507,
    boxTypeId: 2,
    effectiveDate: "2026-05-12",
    coefficient: 0,
    allowUnload: true,
    isSortingCenter: false,
    ...o,
  };
}

const baseInput: BuildWarehouseTariffReportInput = {
  tariffDate: "2026-05-11",
  acceptanceFetchedAt: "2026-05-11T10:00:00.000Z",
  boxTypeId: 2,
  boxRows: [],
};

describe("buildWarehouseTariffReport — synthetic 10-litre metrics", () => {
  it("computes shipCostPer10L, storeCostPer10LPerMonth, and score", () => {
    const r = buildWarehouseTariffReport({
      ...baseInput,
      boxRows: [box()],
      acceptanceRows: [acc()],
    });
    const row = r.rows[0]!;
    // ship = 48 + 9*11.2 = 148.8
    expect(row.shipCostPer10L).toBeCloseTo(148.8, 5);
    // store/day = 0.14 + 9*0.07 = 0.77; × 30 = 23.1
    expect(row.storeCostPer10LPerMonth).toBeCloseTo(23.1, 5);
    expect(row.score).toBeCloseTo(148.8 + 23.1, 5);
  });

  it("treats partial null inputs as zero (score still defined)", () => {
    const r = buildWarehouseTariffReport({
      ...baseInput,
      boxRows: [
        box({
          warehouseName: "X",
          boxDeliveryBase: 48,
          boxDeliveryLiter: null,
          boxStorageBase: null,
          boxStorageLiter: 0.07,
        }),
      ],
      acceptanceRows: [acc({ warehouseName: "X" })],
    });
    const row = r.rows[0]!;
    expect(row.shipCostPer10L).toBe(48);
    expect(row.storeCostPer10LPerMonth).toBeCloseTo(30 * 9 * 0.07, 5);
    expect(row.score).toBeCloseTo(48 + 30 * 9 * 0.07, 5);
  });

  it("returns null score only when both ship and store inputs are entirely null", () => {
    const r = buildWarehouseTariffReport({
      ...baseInput,
      boxRows: [
        box({
          warehouseName: "X",
          boxDeliveryBase: null,
          boxDeliveryLiter: null,
          boxStorageBase: null,
          boxStorageLiter: null,
        }),
      ],
      acceptanceRows: [acc({ warehouseName: "X" })],
    });
    expect(r.rows[0]!.score).toBeNull();
    expect(r.rows[0]!.shipCostPer10L).toBeNull();
    expect(r.rows[0]!.storeCostPer10LPerMonth).toBeNull();
  });
});

describe("buildWarehouseTariffReport — acceptance summary & availability verdict", () => {
  it("picks earliest available date, earliest free date, min coefficient, count", () => {
    const acceptanceRows: AcceptanceInputRow[] = [
      acc({ effectiveDate: "2026-05-13", coefficient: 3, allowUnload: true }),
      acc({ effectiveDate: "2026-05-12", coefficient: 1, allowUnload: true }),
      acc({ effectiveDate: "2026-05-14", coefficient: 0, allowUnload: true }),
      acc({ effectiveDate: "2026-05-11", coefficient: -1, allowUnload: false }),
    ];
    const r = buildWarehouseTariffReport({
      ...baseInput,
      boxRows: [box()],
      acceptanceRows,
    });
    const row = r.rows[0]!;
    expect(row.nearestAvailableDate).toBe("2026-05-12"); // coef=1 + allowUnload
    expect(row.nearestFreeDate).toBe("2026-05-14");      // coef=0 + allowUnload
    expect(row.minCoefficient14d).toBe(-1);
    expect(row.availableDays14d).toBe(2);                // only coef ∈ {0,1} + allowUnload
    expect(row.availability).toBe("available_free");
  });

  it("classifies blocked when all days are unavailable", () => {
    const acceptanceRows = [
      acc({ effectiveDate: "2026-05-12", coefficient: -1, allowUnload: false }),
      acc({ effectiveDate: "2026-05-13", coefficient: 5, allowUnload: true }),
    ];
    const r = buildWarehouseTariffReport({
      ...baseInput,
      boxRows: [box()],
      acceptanceRows,
    });
    const row = r.rows[0]!;
    expect(row.availability).toBe("blocked");
    expect(row.nearestAvailableDate).toBeNull();
    expect(row.nearestFreeDate).toBeNull();
  });

  it("classifies available_paid when only coef=1 days exist", () => {
    const r = buildWarehouseTariffReport({
      ...baseInput,
      boxRows: [box()],
      acceptanceRows: [
        acc({ effectiveDate: "2026-05-12", coefficient: 1, allowUnload: true }),
      ],
    });
    expect(r.rows[0]!.availability).toBe("available_paid");
  });

  it("classifies unknown when there is no acceptance data at all", () => {
    const r = buildWarehouseTariffReport({
      ...baseInput,
      acceptanceFetchedAt: null,
      boxRows: [box()],
      acceptanceRows: [],
    });
    expect(r.rows[0]!.availability).toBe("unknown");
  });

  it("classifies unknown for FBS-style warehouses absent from acceptance/coefficients", () => {
    const r = buildWarehouseTariffReport({
      ...baseInput,
      boxRows: [
        box({ warehouseName: "Маркетплейс: Сибирский ФО", geoName: null }),
      ],
      acceptanceRows: [acc({ warehouseName: "Коледино" })],
    });
    expect(r.rows[0]!.availability).toBe("unknown");
    expect(r.rows[0]!.nearestAvailableDate).toBeNull();
  });

  it("joins acceptance to box by case/space-insensitive warehouseName", () => {
    const r = buildWarehouseTariffReport({
      ...baseInput,
      boxRows: [box({ warehouseName: "  КОЛЕДИНО " })],
      acceptanceRows: [
        acc({ warehouseName: "коледино", coefficient: 0, allowUnload: true }),
      ],
    });
    expect(r.rows[0]!.availability).toBe("available_free");
    expect(r.rows[0]!.warehouseId).toBe(507);
  });
});

describe("buildWarehouseTariffReport — sort & filter", () => {
  const input: BuildWarehouseTariffReportInput = {
    ...baseInput,
    boxRows: [
      box({ warehouseName: "Коледино", boxDeliveryLiter: 11.2 }),
      box({
        warehouseName: "Хабаровск",
        geoName: "Дальневосточный федеральный округ",
        boxDeliveryBase: 200,
        boxDeliveryLiter: 60,
        boxStorageBase: 0.4,
        boxStorageLiter: 0.2,
      }),
      box({
        warehouseName: "Электросталь",
        boxDeliveryBase: 55,
        boxDeliveryLiter: 12,
      }),
    ],
    acceptanceRows: [
      acc({ warehouseName: "Коледино", coefficient: 0, allowUnload: true }),
      acc({
        warehouseName: "Хабаровск",
        coefficient: -1,
        allowUnload: false,
      }),
      acc({ warehouseName: "Электросталь", coefficient: 1, allowUnload: true }),
    ],
    stockTotals: [
      { warehouseName: "Коледино", currentStockUnits: 1000 },
      { warehouseName: "Хабаровск", currentStockUnits: 50 },
    ],
  };

  it("default sort (score) ranks by availability first, then by cost — blocked warehouses sink", () => {
    const r = buildWarehouseTariffReport(input);
    // Коледино: available_free + cheapest; Электросталь: available_paid;
    // Хабаровск: blocked even though its tariff is the most expensive anyway.
    expect(r.rows.map((x) => x.warehouseName)).toEqual([
      "Коледино",
      "Электросталь",
      "Хабаровск",
    ]);
  });

  it("default sort prefers a usable warehouse over a cheaper-but-blocked one", () => {
    const r = buildWarehouseTariffReport({
      ...baseInput,
      boxRows: [
        // "Cheap blocked" warehouse: SGT-style, cheapest tariff, no acceptance.
        box({
          warehouseName: "Голицыно СГТ",
          boxDeliveryBase: 30,
          boxDeliveryLiter: 11,
          boxStorageBase: 0.05,
          boxStorageLiter: 0.05,
        }),
        // Normal regional warehouse: more expensive but usable.
        box({
          warehouseName: "Коледино",
          boxDeliveryBase: 48,
          boxDeliveryLiter: 11.2,
        }),
      ],
      acceptanceRows: [
        acc({
          warehouseName: "Голицыно СГТ",
          coefficient: -1,
          allowUnload: false,
        }),
        acc({
          warehouseName: "Коледино",
          coefficient: 0,
          allowUnload: true,
        }),
      ],
    });
    expect(r.rows.map((x) => x.warehouseName)).toEqual([
      "Коледино",
      "Голицыно СГТ",
    ]);
  });

  it("--sort=stock orders by current stock units descending", () => {
    const r = buildWarehouseTariffReport({ ...input, sortBy: "stock" });
    // Электросталь has no stock entry → null → goes to bottom
    expect(r.rows.map((x) => x.warehouseName)).toEqual([
      "Коледино",
      "Хабаровск",
      "Электросталь",
    ]);
  });

  it("--sort=acceptance puts earliest available dates first; missing last", () => {
    // Override one warehouse to have a later date than the other
    const r = buildWarehouseTariffReport({
      ...input,
      acceptanceRows: [
        acc({ warehouseName: "Коледино", effectiveDate: "2026-05-15" }),
        acc({ warehouseName: "Электросталь", effectiveDate: "2026-05-12", coefficient: 1 }),
      ],
      sortBy: "acceptance",
    });
    // Электросталь = 05-12 first, Коледино = 05-15 second, Хабаровск = null last
    expect(r.rows.map((x) => x.warehouseName)).toEqual([
      "Электросталь",
      "Коледино",
      "Хабаровск",
    ]);
  });

  it("--available-only drops blocked and unknown rows", () => {
    const r = buildWarehouseTariffReport({ ...input, availableOnly: true });
    expect(r.rows.map((x) => x.warehouseName)).toEqual([
      "Коледино",
      "Электросталь",
    ]);
  });

  it("--geo filters by substring (RU-case-insensitive) on geoName", () => {
    const r = buildWarehouseTariffReport({
      ...input,
      geoFilter: "дальневост",
    });
    expect(r.rows.map((x) => x.warehouseName)).toEqual(["Хабаровск"]);
  });

  it("--limit truncates after sorting", () => {
    const r = buildWarehouseTariffReport({ ...input, limit: 2 });
    expect(r.rows).toHaveLength(2);
    expect(r.summary.totalWarehouses).toBe(3); // summary counts pre-limit
  });
});

describe("buildWarehouseTariffReport — summary", () => {
  it("counts availability buckets and macroRegion breakdown", () => {
    const r = buildWarehouseTariffReport({
      ...baseInput,
      boxRows: [
        box({ warehouseName: "Коледино" }),
        box({ warehouseName: "Электросталь" }),
        box({ warehouseName: "Хабаровск" }),
      ],
      acceptanceRows: [
        acc({ warehouseName: "Коледино", coefficient: 0, allowUnload: true }),
        acc({
          warehouseName: "Электросталь",
          coefficient: 1,
          allowUnload: true,
        }),
        acc({
          warehouseName: "Хабаровск",
          coefficient: -1,
          allowUnload: false,
        }),
      ],
    });
    expect(r.summary.totalWarehouses).toBe(3);
    expect(r.summary.byAvailability).toEqual({
      available_free: 1,
      available_paid: 1,
      blocked: 1,
      unknown: 0,
    });
    expect(r.summary.byMacroRegion.length).toBeGreaterThan(0);
  });
});
