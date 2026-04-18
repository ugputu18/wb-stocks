import { describe, expect, it } from "vitest";
import {
  aggregateOrderFlowByRegion,
  aggregateOrderFlowMacroMatrix,
} from "../src/application/orderFlowDiagnostics.js";
import { buildRegionMacroLookup } from "../src/domain/wbRegionMacroRegion.js";
import type { WbOrderUnit } from "../src/domain/wbOrder.js";

function u(p: Partial<WbOrderUnit> & Pick<WbOrderUnit, "warehouseKey" | "regionKey">): WbOrderUnit {
  return {
    orderDate: "2026-04-01",
    lastChangeDate: null,
    warehouseNameRaw: "Коледино",
    nmId: 1,
    techSize: "0",
    vendorCode: "V",
    barcode: null,
    isCancel: false,
    srid: null,
    regionNameRaw: "Москва",
    ...p,
  };
}

describe("aggregateOrderFlowByRegion", () => {
  it("aggregates net units and share within region", () => {
    const rows = aggregateOrderFlowByRegion([
      u({ regionKey: "москва", warehouseKey: "коледино" }),
      u({ regionKey: "москва", warehouseKey: "коледино" }),
      u({ regionKey: "москва", warehouseKey: "электросталь" }),
      u({ regionKey: "спб", warehouseKey: "коледино" }),
    ]);
    const mskKol = rows.find((r) => r.regionKey === "москва" && r.warehouseKey === "коледино");
    expect(mskKol?.units).toBe(2);
    expect(mskKol?.shareWithinRegion).toBeCloseTo(2 / 3);
  });
});

describe("aggregateOrderFlowMacroMatrix", () => {
  it("maps buyer and fulfillment macros", () => {
    const lookup = buildRegionMacroLookup([]);
    const rows = aggregateOrderFlowMacroMatrix(
      [u({ regionKey: "москва", warehouseKey: "коледино" })],
      lookup,
    );
    expect(rows.some((r) => r.buyerMacroRegion === "Центральный")).toBe(true);
    expect(rows.some((r) => r.fulfillmentMacroRegion === "Центральный")).toBe(true);
  });
});
