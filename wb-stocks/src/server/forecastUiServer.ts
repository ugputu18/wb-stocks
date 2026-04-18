import { createServer } from "node:http";
import { authOk } from "./forecast-ui/http/authOk.js";
import { json } from "./forecast-ui/http/json.js";
import { buildForecastUiHandlerDeps } from "./forecast-ui/deps.js";
import {
  buildForecastUiApiRoutes,
  buildForecastUiSpaHealthRoutes,
} from "./forecast-ui/routes/buildForecastUiRoutes.js";
import { STATIC_DIR, STATIC_DIR_NEXT } from "./forecast-ui/staticPaths.js";
import type { ForecastUiServerCtx } from "./forecast-ui/forecastUiServerCtx.js";

export type { ForecastUiServerCtx } from "./forecast-ui/forecastUiServerCtx.js";
export type { ForecastUiHandlerDeps } from "./forecast-ui/types.js";

const SPA_HEALTH_ROUTES = buildForecastUiSpaHealthRoutes();

/**
 * Minimal static + JSON server for the internal forecast UI.
 * Bind `FORECAST_UI_HOST` (default 127.0.0.1) only unless you know what you're doing.
 */
export function startForecastUiServer(ctx: ForecastUiServerCtx): ReturnType<
  typeof createServer
> {
  const { cfg, logger } = ctx;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const pathname = url.pathname;
      if (!authOk(cfg, req, pathname)) {
        json(res, 401, { ok: false, error: "Unauthorized" });
        return;
      }

      for (const route of SPA_HEALTH_ROUTES) {
        if (route.match(req, url)) {
          await route.handle(req, res, url);
          return;
        }
      }

      const apiDeps = buildForecastUiHandlerDeps(ctx);
      for (const route of buildForecastUiApiRoutes(ctx, apiDeps)) {
        if (route.match(req, url)) {
          await route.handle(req, res, url);
          return;
        }
      }

      json(res, 404, { ok: false, error: "Not found" });
    } catch (err) {
      /* Do not log req.headers / body — may contain bearer tokens. */
      logger.error({ err }, "forecast UI server error");
      json(res, 500, {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Внутренняя ошибка сервера прогноза",
      });
    }
  });

  server.listen(cfg.FORECAST_UI_PORT, cfg.FORECAST_UI_HOST, () => {
    logger.info(
      {
        host: cfg.FORECAST_UI_HOST,
        port: cfg.FORECAST_UI_PORT,
        static: STATIC_DIR,
        staticNext: STATIC_DIR_NEXT,
      },
      "Forecast UI server listening",
    );
  });

  return server;
}
