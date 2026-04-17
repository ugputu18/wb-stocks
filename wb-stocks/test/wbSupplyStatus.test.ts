import { describe, expect, it } from "vitest";
import {
  SUPPLY_STATUS_INCOMING_FOR_FORECAST,
  describeSupplyStatus,
  isAlreadyInStock,
  isDraftSupply,
  isIncomingForForecast,
} from "../src/domain/wbSupplyStatus.js";

describe("wbSupplyStatus helpers", () => {
  it("classifies the WB FBW status table per the documented semantics", () => {
    expect(isDraftSupply(1)).toBe(true);
    expect(isIncomingForForecast(2)).toBe(true);
    expect(isIncomingForForecast(3)).toBe(true);
    expect(isIncomingForForecast(4)).toBe(true);
    expect(isAlreadyInStock(5)).toBe(true);
    expect(isIncomingForForecast(6)).toBe(true);
  });

  it("never confuses 'already in stock' with 'incoming'", () => {
    expect(isIncomingForForecast(5)).toBe(false);
    expect(isAlreadyInStock(2)).toBe(false);
    expect(isAlreadyInStock(6)).toBe(false);
  });

  it("incoming set matches the published constant exactly", () => {
    expect([...SUPPLY_STATUS_INCOMING_FOR_FORECAST].sort()).toEqual([2, 3, 4, 6]);
  });

  it("describeSupplyStatus returns labels and a fallback for unknown ids", () => {
    expect(describeSupplyStatus(2)).toBe("Planned");
    expect(describeSupplyStatus(5)).toBe("Accepted");
    expect(describeSupplyStatus(99)).toBe("unknown(99)");
  });
});
