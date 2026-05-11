import { describe, expect, it } from "vitest";
import { parseRegionalStocksQuery } from "../src/server/forecast-ui/parse/forecastQuery.js";

function url(search: string): URL {
  return new URL(`http://127.0.0.1/api/forecast/regional-stocks?${search}`);
}

describe("parseRegionalStocksQuery", () => {
  it("accepts required regional stocks params and defaults target coverage to 42", () => {
    const q = parseRegionalStocksQuery(
      url("snapshotDate=2026-04-18&horizonDays=10&macroRegion=Центральный"),
    );
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    expect(q.snapshotDate).toBe("2026-04-18");
    expect(q.horizonDays).toBe(10);
    expect(q.targetCoverageDays).toBe(42);
    expect(q.riskStockout).toBe("all");
    expect(q.limit).toBe(500);
  });

  it("accepts 14/30/42/60 target coverage (and rejects 45 / non-integer)", () => {
    // 14 — для тактического планирования (страница «Запасы WB по региону»
    // должна позволять «нацелиться на ближайшие 2 недели»).
    for (const tc of [14, 30, 42, 60]) {
      const ok = parseRegionalStocksQuery(
        url(
          `snapshotDate=2026-04-18&horizonDays=5&macroRegion=Центральный&targetCoverageDays=${tc}`,
        ),
      );
      expect(ok.ok, `targetCoverageDays=${tc} must be accepted`).toBe(true);
      if (ok.ok) expect(ok.targetCoverageDays).toBe(tc);
    }
    const bad = parseRegionalStocksQuery(
      url(
        "snapshotDate=2026-04-18&horizonDays=20&macroRegion=Центральный&targetCoverageDays=45",
      ),
    );
    expect(bad.ok).toBe(false);
  });

  it("treats missing or empty snapshotDate as null (server resolves latest)", () => {
    // Страница "Запасы WB по региону" принципиально работает только со
    // свежим срезом — снапшот выбирается на сервере, поле в UI не показывается.
    const noParam = parseRegionalStocksQuery(
      url("horizonDays=10&macroRegion=Центральный"),
    );
    expect(noParam.ok).toBe(true);
    if (noParam.ok) expect(noParam.snapshotDate).toBeNull();

    const empty = parseRegionalStocksQuery(
      url("snapshotDate=&horizonDays=10&macroRegion=Центральный"),
    );
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.snapshotDate).toBeNull();
  });

  it("rejects malformed snapshotDate (but accepts missing)", () => {
    const bad = parseRegionalStocksQuery(
      url("snapshotDate=not-a-date&horizonDays=10&macroRegion=Центральный"),
    );
    expect(bad.ok).toBe(false);
  });

  it("validates horizon and macroRegion", () => {
    expect(
      parseRegionalStocksQuery(
        url("snapshotDate=2026-04-18&horizonDays=30&macroRegion=Центральный"),
      ).ok,
    ).toBe(false);
    expect(
      parseRegionalStocksQuery(url("snapshotDate=2026-04-18&horizonDays=10")).ok,
    ).toBe(false);
  });
});
