import { describe, expect, it } from "vitest";
import type { RegionalStocksReportRow } from "../src/application/buildRegionalStocksReport.js";
import {
  REGIONAL_STOCKS_EXPORT_COLUMNS,
  regionalStocksRowsForExport,
  regionalStocksRowsToExportObjects,
} from "../src/server/forecast-ui/export/forecastExportMappers.js";

function regionalRow(
  overrides: Partial<RegionalStocksReportRow> = {},
): RegionalStocksReportRow {
  return {
    nmId: 1,
    techSize: "0",
    vendorCode: "SKU-1",
    category: null,
    subject: null,
    brand: null,
    productName: null,
    risk: "critical",
    regionalStartStock: 0,
    regionalIncomingUnits: 0,
    regionalAvailable: 0,
    regionalForecastDailyDemand: 1,
    daysOfStockRegional: 0,
    stockoutDateEstimate: "2026-04-19",
    recommendedToRegion: 0,
    unitsPerBox: 6,
    ownWarehouseStock: 0,
    recommendedOrderQty: 0,
    salePrice: null,
    projectedRevenue: 0,
    stockSnapshotAtMin: null,
    ...overrides,
  };
}

describe("forecast export mappers", () => {
  it("exports regional stock columns with box before rounded need", () => {
    expect(REGIONAL_STOCKS_EXPORT_COLUMNS).toEqual([
      "Риск",
      "vendor",
      "nm_id",
      "Бренд",
      "Предмет",
      "Доступно",
      "Спрос/день",
      "Дней запаса",
      "OOS",
      "Короб",
      "Нужно",
      "Склад",
      "Заказ",
    ]);

    expect(
      regionalStocksRowsToExportObjects([
        regionalRow({
          brand: "Canpol Babies",
          productName: "Бутылочки для кормления",
          recommendedToRegion: 12,
          recommendedOrderQty: 0,
        }),
      ])[0],
    ).toMatchObject({
      "Бренд": "Canpol",
      "Предмет": "Бутылочки",
      "Короб": 6,
      "Нужно": 12,
    });
  });

  it("keeps regional export rows with nonzero need even when order is zero", () => {
    const needWithoutStock = regionalRow({
      nmId: 1,
      recommendedToRegion: 12,
      recommendedOrderQty: 0,
    });
    const orderWithoutNeed = regionalRow({
      nmId: 2,
      recommendedToRegion: 0,
      recommendedOrderQty: 6,
    });

    expect(regionalStocksRowsForExport([needWithoutStock, orderWithoutNeed])).toEqual([
      needWithoutStock,
    ]);
  });
});
