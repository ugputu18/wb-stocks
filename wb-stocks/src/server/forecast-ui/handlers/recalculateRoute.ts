import {
  runSalesForecastMvp,
  type RunSalesForecastMvpResult,
} from "../../../application/runSalesForecastMvp.js";
import { json } from "../http/json.js";
import { readBody } from "../http/readBody.js";
import { buildMvpDeps } from "../deps.js";
import type { ForecastUiServerCtx } from "../forecastUiServerCtx.js";
import type { ForecastRouteMatch } from "../routes/routeTypes.js";

function aggregateSkipped(
  result: RunSalesForecastMvpResult,
): { reason: string; count: number }[] {
  const m = new Map<string, number>();
  for (const f of result.forecasts) {
    for (const s of f.skipped) {
      m.set(s.reason, (m.get(s.reason) ?? 0) + s.count);
    }
  }
  return Array.from(m, ([reason, count]) => ({ reason, count }));
}

export function createRecalculateRoute(ctx: ForecastUiServerCtx): ForecastRouteMatch {
  return {
    match: (req, url) =>
      req.method === "POST" && url.pathname === "/api/forecast/recalculate",
    handle: async (req, res, url) => {
      void url;
      if (!ctx.cfg.WB_TOKEN) {
        json(res, 503, {
          ok: false,
          code: "WB_TOKEN_MISSING",
          error:
            "Не задан WB_TOKEN в окружении: без него нельзя вызвать WB Statistics API для импорта заказов и пересчёта.",
        });
        return;
      }
      const raw = await readBody(req);
      let body: Record<string, unknown> = {};
      if (raw.trim()) {
        try {
          body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          json(res, 400, { ok: false, error: "Invalid JSON body" });
          return;
        }
      }
      const snapshotDate =
        typeof body.snapshotDate === "string" ? body.snapshotDate : undefined;
      const horizons = Array.isArray(body.horizons)
        ? (body.horizons as unknown[]).filter(
            (x): x is number => typeof x === "number" && Number.isInteger(x) && x > 0,
          )
        : undefined;
      const dryRun = body.dryRun === true;
      const sku =
        typeof body.sku === "string" && body.sku.trim() !== ""
          ? body.sku.trim()
          : undefined;
      const warehouse =
        typeof body.warehouse === "string" && body.warehouse.trim() !== ""
          ? body.warehouse.trim()
          : undefined;
      const refreshStocks =
        typeof body.refreshStocks === "boolean" ? body.refreshStocks : true;

      const result = await runSalesForecastMvp(buildMvpDeps(ctx), {
        snapshotDate,
        horizons,
        dryRun,
        sku,
        warehouse,
        refreshStocks,
      });

      json(res, 200, {
        ok: true,
        result,
        skippedAggregate: aggregateSkipped(result),
      });
    },
  };
}
