import { describe, expect, it } from "vitest";
import { runForecastSimulation } from "../src/application/runForecastSimulation.js";
import type { IncomingArrival } from "../src/application/selectIncomingSupplies.js";

function arr(date: string, quantity: number): IncomingArrival {
  return { date, quantity, supplyId: 0, statusId: 2, warehouseSource: "planned" };
}

describe("runForecastSimulation", () => {
  it("flat demand, no incoming: stockout exactly when stock runs out", () => {
    const r = runForecastSimulation({
      snapshotDate: "2026-04-17",
      horizonDays: 30,
      startStock: 12,
      forecastDailyDemand: 5,
      incoming: [],
    });
    expect(r.daysOfStock).toBe(2);
    expect(r.stockoutDate).toBe("2026-04-19");
    expect(r.endStock).toBe(0);
    expect(r.forecastUnits).toBe(12);
    expect(r.incomingTotal).toBe(0);
  });

  it("zero demand: never stocks out, daysOfStock = horizon", () => {
    const r = runForecastSimulation({
      snapshotDate: "2026-04-17",
      horizonDays: 10,
      startStock: 0,
      forecastDailyDemand: 0,
      incoming: [],
    });
    expect(r.daysOfStock).toBe(10);
    expect(r.stockoutDate).toBeNull();
    expect(r.forecastUnits).toBe(0);
    expect(r.endStock).toBe(0);
  });

  it("zero stock with demand: stocks out on snapshotDate, daysOfStock = 0", () => {
    const r = runForecastSimulation({
      snapshotDate: "2026-04-17",
      horizonDays: 5,
      startStock: 0,
      forecastDailyDemand: 5,
      incoming: [],
    });
    expect(r.daysOfStock).toBe(0);
    expect(r.stockoutDate).toBe("2026-04-17");
    expect(r.forecastUnits).toBe(0);
  });

  it("supply lands at the start of its day (MVP rule)", () => {
    // demand=5, stock=5 → ok day 0; supply of 10 on day 1 → ok days 1..2
    const r = runForecastSimulation({
      snapshotDate: "2026-04-17",
      horizonDays: 5,
      startStock: 5,
      forecastDailyDemand: 5,
      incoming: [arr("2026-04-18", 10)],
    });
    // day 0: avail=5, sales=5, stock=0
    // day 1: avail=10 (supply), sales=5, stock=5
    // day 2: avail=5, sales=5, stock=0
    // day 3: avail=0, sales=0 → stockoutDate=2026-04-20
    expect(r.daysOfStock).toBe(3);
    expect(r.stockoutDate).toBe("2026-04-20");
    expect(r.endStock).toBe(0);
    expect(r.forecastUnits).toBe(15);
    expect(r.incomingTotal).toBe(10);
  });

  it("daysOfStock freezes after first stockout, even if a supply rescues later", () => {
    // demand=5, stock=0, supply=15 on day 5 → first stockout is day 0,
    // daysOfStock stays 0 even though days 5..7 are fully met later.
    const r = runForecastSimulation({
      snapshotDate: "2026-04-17",
      horizonDays: 10,
      startStock: 0,
      forecastDailyDemand: 5,
      incoming: [arr("2026-04-22", 15)],
    });
    expect(r.daysOfStock).toBe(0);
    expect(r.stockoutDate).toBe("2026-04-17");
    // day 5..7 fully met: 15 units of forecast, then dry again.
    expect(r.forecastUnits).toBe(15);
    expect(r.endStock).toBe(0);
  });

  it("multiple arrivals on the same date are summed", () => {
    const r = runForecastSimulation({
      snapshotDate: "2026-04-17",
      horizonDays: 5,
      startStock: 0,
      forecastDailyDemand: 5,
      incoming: [arr("2026-04-17", 3), arr("2026-04-17", 7)],
    });
    // day 0: avail=10, sales=5, stock=5; day 1: avail=5, sales=5, stock=0;
    // day 2: avail=0, sales=0 → stockout
    expect(r.daysOfStock).toBe(2);
    expect(r.stockoutDate).toBe("2026-04-19");
    expect(r.incomingTotal).toBe(10);
  });

  it("fractional forecastDailyDemand simulates fractional drawdown", () => {
    const r = runForecastSimulation({
      snapshotDate: "2026-04-17",
      horizonDays: 4,
      startStock: 4,
      forecastDailyDemand: 1.5,
      incoming: [],
    });
    // day 0: avail=4, sales=1.5, stock=2.5
    // day 1: avail=2.5, sales=1.5, stock=1.0
    // day 2: avail=1.0, sales=1.0 (< demand) → stockoutDate=2026-04-19
    // day 3: avail=0, sales=0
    expect(r.stockoutDate).toBe("2026-04-19");
    expect(r.daysOfStock).toBe(2);
    expect(r.endStock).toBeCloseTo(0, 10);
    expect(r.forecastUnits).toBeCloseTo(1.5 + 1.5 + 1.0, 10);
  });

  it("never stocks out across horizon → stockoutDate null, daysOfStock = horizon", () => {
    const r = runForecastSimulation({
      snapshotDate: "2026-04-17",
      horizonDays: 10,
      startStock: 1000,
      forecastDailyDemand: 1,
      incoming: [],
    });
    expect(r.stockoutDate).toBeNull();
    expect(r.daysOfStock).toBe(10);
    expect(r.endStock).toBe(990);
    expect(r.forecastUnits).toBe(10);
  });

  it("rejects horizonDays <= 0", () => {
    expect(() =>
      runForecastSimulation({
        snapshotDate: "2026-04-17",
        horizonDays: 0,
        startStock: 1,
        forecastDailyDemand: 1,
        incoming: [],
      }),
    ).toThrow(/horizonDays/);
  });
});
