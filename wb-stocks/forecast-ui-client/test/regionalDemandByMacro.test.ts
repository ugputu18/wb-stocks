import { describe, expect, it } from "vitest";
import { buildRegionalDemandByMacroBySku } from "../src/utils/regionalDemandByMacro.js";

describe("buildRegionalDemandByMacroBySku", () => {
  it("sums regionalForecastDailyDemand by macro for same sku", () => {
    const m = buildRegionalDemandByMacroBySku(
      [
        {
          regionKey: "Москва",
          nmId: 1,
          techSize: "0",
          regionalForecastDailyDemand: 2,
        },
        {
          regionKey: "Москва",
          nmId: 1,
          techSize: "0",
          regionalForecastDailyDemand: 3,
        },
      ],
      { Москва: "Центральный" },
    );
    expect(m.get("1|0")?.get("Центральный")).toBe(5);
  });
});
