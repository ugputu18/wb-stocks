import { json } from "../http/json.js";
import type { ForecastRouteMatch } from "../routes/routeTypes.js";

export function createHealthRoute(): ForecastRouteMatch {
  return {
    match: (req, url) => req.method === "GET" && url.pathname === "/api/forecast/health",
    handle: (req, res, url) => {
      void req;
      void url;
      json(res, 200, { ok: true, service: "wb-stocks-forecast-ui" });
    },
  };
}
