import { describe, expect, it } from "vitest";
import {
  getWarehouseMacroRegion,
  getWarehouseRegistryEntry,
  isWarehouseRedistributionDonorEligible,
  isWarehouseRedistributionExecutionTarget,
  passesRegisteredWarehouseExecutionHardFilters,
  warehouseContributesToRegionalAvailabilityStock,
  WB_WAREHOUSE_REGISTRY,
  type WbWarehouseRegistryEntry,
} from "../src/domain/wbWarehouseMacroRegion.js";

describe("WB_WAREHOUSE_REGISTRY", () => {
  it("содержит макрорегион и флаги для известного ключа", () => {
    const e = getWarehouseRegistryEntry("коледино");
    expect(e).not.toBeNull();
    expect(e!.macroRegion).toBe("Центральный");
    expect(e!.country).toBe("RU");
    expect(e!.isVirtual).toBe(false);
    expect(e!.isSortingCenter).toBe(false);
    expect(e!.canBeRedistributionDonor).toBe(true);
    expect(e!.canBeRedistributionTarget).toBe(true);
    expect(e!.wbAcceptsInboundForRedistribution).toBe(true);
  });

  it("виртуальный склад: не донор, не цель исполнения, не в остатках региона", () => {
    const e = getWarehouseRegistryEntry("виртуальный новосибирск");
    expect(e?.isVirtual).toBe(true);
    expect(e?.canBeRedistributionDonor).toBe(false);
    expect(e?.canBeRedistributionTarget).toBe(false);
    expect(isWarehouseRedistributionExecutionTarget(e, "macro")).toBe(false);
    expect(isWarehouseRedistributionExecutionTarget(e, "warehouse")).toBe(false);
    expect(isWarehouseRedistributionDonorEligible(e)).toBe(false);
    expect(warehouseContributesToRegionalAvailabilityStock(e, e!.warehouseKey)).toBe(false);
  });

  it("сортировочный центр (префикс «сц »): не цель исполнения, но участвует в остатках региона", () => {
    const e = getWarehouseRegistryEntry("сц барнаул");
    expect(e?.isSortingCenter).toBe(true);
    expect(e?.canBeRedistributionTarget).toBe(false);
    expect(isWarehouseRedistributionExecutionTarget(e, "macro")).toBe(false);
    expect(warehouseContributesToRegionalAvailabilityStock(e, e!.warehouseKey)).toBe(true);
  });

  it("getWarehouseMacroRegion читает из реестра", () => {
    expect(getWarehouseMacroRegion("минск")).toBe("Беларусь");
    expect(getWarehouseRegistryEntry("минск")?.country).toBe("BY");
  });

  it("ключи реестра совпадают с покрытием макро-картой", () => {
    expect(Object.keys(WB_WAREHOUSE_REGISTRY).length).toBeGreaterThan(100);
  });

  it("static alias спб резолвится в санкт-петербург", () => {
    expect(getWarehouseRegistryEntry("спб")?.warehouseKey).toBe("санкт-петербург");
    expect(getWarehouseMacroRegion("СПБ")).toBe("Северо-Западный");
  });

  it("подтверждённые aliases резолвятся в канонический ключ", () => {
    expect(getWarehouseRegistryEntry("атакент")?.warehouseKey).toBe("алматы атакент");
    expect(getWarehouseRegistryEntry("ск ереван")?.warehouseKey).toBe("ереван");
    expect(getWarehouseRegistryEntry("сц ереван")?.warehouseKey).toBe("ереван");
    expect(getWarehouseRegistryEntry("ташкент 2")?.warehouseKey).toBe("ташкент");
    expect(getWarehouseRegistryEntry("сц шушары")?.warehouseKey).toBe("шушары");
    expect(getWarehouseMacroRegion("санкт-петербург уткина заводь")).toBe("Северо-Западный");
    expect(getWarehouseRegistryEntry("екатеринбург - испытателей 14г")?.warehouseKey).toBe(
      "екатеринбург - испытателей 14г",
    );
  });

  it("isWarehouseRedistributionExecutionTarget: неизвестный склад не цель ни в warehouse, ни в macro", () => {
    expect(isWarehouseRedistributionExecutionTarget(null, "warehouse")).toBe(false);
    expect(isWarehouseRedistributionExecutionTarget(null, "macro")).toBe(false);
  });

  it("passesRegisteredWarehouseExecutionHardFilters требует wbAcceptsInboundForRedistribution", () => {
    const e: WbWarehouseRegistryEntry = {
      warehouseKey: "x",
      displayName: "X",
      macroRegion: "Центральный",
      country: "RU",
      isVirtual: false,
      isSortingCenter: false,
      canBeRedistributionTarget: true,
      canBeRedistributionDonor: true,
      wbAcceptsInboundForRedistribution: false,
    };
    expect(passesRegisteredWarehouseExecutionHardFilters(e)).toBe(false);
  });
});
