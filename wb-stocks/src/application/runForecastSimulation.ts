import type { IncomingArrival } from "./selectIncomingSupplies.js";

export interface SimulationInput {
  /** First simulated day (YYYY-MM-DD); same as forecast `snapshotDate`. */
  snapshotDate: string;
  /** Number of simulated days, e.g. 30/60/90. Must be > 0. */
  horizonDays: number;
  /** Stock available at the very start of `snapshotDate`. */
  startStock: number;
  /** Smoothed daily demand from the demand snapshot (pieces/day). */
  forecastDailyDemand: number;
  /**
   * Arrivals already filtered to this `(warehouse, sku)`. The simulation
   * looks up by date; multiple arrivals on the same day are summed.
   * Order does not matter.
   */
  incoming: readonly IncomingArrival[];
}

export interface SimulationResult {
  /** Sum of `min(available, demand)` across all horizon days. */
  forecastUnits: number;
  /** Stock left after the last horizon day. */
  endStock: number;
  /**
   * Number of consecutive days at the START of the horizon for which
   * the simulation fully meets `forecastDailyDemand`. Once we hit a day
   * where demand cannot be met, this counter freezes — late arrivals
   * may still relieve later days but they do NOT roll this number
   * forward (see `stockoutDate` for the first-failure date).
   *
   * Examples:
   *   demand=5, stock=12, no incoming, horizon=30 → daysOfStock = 2
   *   demand=0                                    → daysOfStock = horizon
   *   demand=5, stock=0, incoming=15 on day 5     → daysOfStock = 0
   */
  daysOfStock: number;
  /**
   * First day on which `available < forecastDailyDemand` (strict).
   * `null` if demand is fully met every day of the horizon.
   * For zero demand this stays `null`.
   */
  stockoutDate: string | null;
  /** Total units arriving from supplies within the horizon. */
  incomingTotal: number;
}

/**
 * Pure forecast simulation. No I/O, no DB, no time. Same input → same
 * output. The orchestrator (`buildForecastSnapshot`) is responsible
 * for fetching demand/stock/supplies and for persistence.
 *
 * Per-day algorithm (matches the task spec):
 *   incoming_d  = sum(arrival.quantity for arrival in arrivals if arrival.date == d)
 *   available   = stock + incoming_d   // arrivals land at start of day
 *   sales       = min(available, forecastDailyDemand)
 *   stock_next  = available − sales
 *
 * MVP rule: a supply with `date == d` is consumable from the *start*
 * of day `d`. If your domain ever flips this (e.g. arrival counts
 * only for day d+1), add the shift in `selectIncomingSupplies` rather
 * than in this function — the simulation should stay agnostic.
 */
export function runForecastSimulation(input: SimulationInput): SimulationResult {
  if (input.horizonDays <= 0) {
    throw new Error(
      `runForecastSimulation: horizonDays must be > 0, got ${input.horizonDays}`,
    );
  }

  const incomingByDate = new Map<string, number>();
  for (const a of input.incoming) {
    incomingByDate.set(a.date, (incomingByDate.get(a.date) ?? 0) + a.quantity);
  }

  let stock = input.startStock;
  let forecastUnits = 0;
  let stockoutDate: string | null = null;
  let daysOfStock = 0;
  let incomingTotal = 0;

  for (let d = 0; d < input.horizonDays; d += 1) {
    const date = addDays(input.snapshotDate, d);
    const incomingToday = incomingByDate.get(date) ?? 0;
    incomingTotal += incomingToday;

    const available = stock + incomingToday;
    const sales = Math.min(available, input.forecastDailyDemand);
    forecastUnits += sales;

    if (sales < input.forecastDailyDemand && stockoutDate === null) {
      stockoutDate = date;
    }
    if (stockoutDate === null) {
      // Still in the "fully met every day so far" streak.
      daysOfStock = d + 1;
    }
    stock = available - sales;
  }

  return {
    forecastUnits,
    endStock: stock,
    daysOfStock,
    stockoutDate,
    incomingTotal,
  };
}

/**
 * UTC-arithmetic add. Same helper exists in `computeDemandSnapshot`;
 * duplicated locally to keep the simulation file self-contained
 * (no horizontal application-layer imports).
 */
function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000;
  const dt = new Date(t);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
