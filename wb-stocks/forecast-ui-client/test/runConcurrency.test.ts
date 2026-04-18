import { describe, expect, it } from "vitest";
import { runConcurrency } from "../src/utils/runConcurrency.js";

describe("runConcurrency", () => {
  it("runs all tasks with limited parallelism", async () => {
    const seen = new Set<number>();
    const results = await runConcurrency([1, 2, 3, 4, 5], 2, async (x) => {
      await new Promise((r) => setTimeout(r, 5));
      seen.add(x);
      return x * 2;
    });
    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(seen.size).toBe(5);
  });
});
