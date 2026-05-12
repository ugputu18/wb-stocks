import { basename } from "node:path";
import { importOwnWarehouseState } from "../../../application/importOwnWarehouseState.js";
import { OwnStockSnapshotRepository } from "../../../infra/ownStockSnapshotRepository.js";
import { json } from "../http/json.js";
import { readBody } from "../http/readBody.js";
import type { ForecastUiServerCtx } from "../forecastUiServerCtx.js";
import type { ForecastRouteMatch } from "../routes/routeTypes.js";

/**
 * Upload "our warehouse" stock snapshot from a CSV uploaded via the forecast UI.
 *
 * Contract:
 *   POST /api/forecast/upload-own-stocks
 *     ?filename=<basename>     — informational; stored in `source_file`
 *     ?date=YYYY-MM-DD         — snapshot date (defaults to today, local)
 *     ?warehouse=<code>        — warehouse code (defaults to `main`)
 *   Content-Type: text/csv;charset=utf-8
 *   Body: raw CSV bytes
 *
 * The CSV layout is flexible — column meanings are auto-detected by
 * `parseOwnStockCsv` (header keyword + content of first rows). See
 * `docs/ai-tasks/own-stocks-csv-upload.md`.
 *
 * Response: same shape as `ImportOwnWarehouseStateResult`, plus `ok: true`.
 */
export function createUploadOwnStocksRoute(
  ctx: ForecastUiServerCtx,
): ForecastRouteMatch {
  return {
    match: (req, url) =>
      req.method === "POST" &&
      url.pathname === "/api/forecast/upload-own-stocks",
    handle: async (req, res, url) => {
      const body = await readBody(req);
      if (!body.trim()) {
        json(res, 400, { ok: false, error: "Empty CSV body" });
        return;
      }
      const dateParam = url.searchParams.get("date");
      const warehouseParam = url.searchParams.get("warehouse");
      const filenameParam = url.searchParams.get("filename");
      const filename = sanitizeFilename(filenameParam);
      const repo = new OwnStockSnapshotRepository(ctx.db);
      try {
        const result = await importOwnWarehouseState(
          {
            repository: repo,
            logger: ctx.logger,
            readFile: async () => Buffer.from(body, "utf8"),
          },
          {
            date: dateParam ?? undefined,
            warehouseCode: warehouseParam?.trim() || undefined,
            file: filename,
          },
        );
        json(res, 200, { ok: true, ...result });
      } catch (err) {
        ctx.logger.error({ err }, "upload own stocks failed");
        json(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : "upload failed",
        });
      }
    },
  };
}

function sanitizeFilename(raw: string | null): string {
  if (!raw) return "upload.csv";
  const trimmed = raw.trim();
  if (!trimmed) return "upload.csv";
  const base = basename(trimmed);
  return base || "upload.csv";
}
