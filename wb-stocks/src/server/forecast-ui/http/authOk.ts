import type { IncomingMessage } from "node:http";
import type { AppConfig } from "../../../config/env.js";

/**
 * All `GET/POST /api/*` require `Authorization: Bearer <FORECAST_UI_TOKEN>` when that env is set.
 *
 * `/api/forecast/health` is exempt: it's a no-PII liveness ping that returns a
 * constant JSON, and load balancers (e.g. GCP HTTPS LB backend health checks
 * — see deploy/gcp/) probe it without a way to inject a bearer header.
 */
const AUTH_EXEMPT_PATHS = new Set<string>(["/api/forecast/health"]);

export function authOk(
  cfg: AppConfig,
  req: IncomingMessage,
  pathname: string,
): boolean {
  const token = cfg.FORECAST_UI_TOKEN;
  if (!token) return true;
  if (!pathname.startsWith("/api/")) return true;
  if (AUTH_EXEMPT_PATHS.has(pathname)) return true;
  const h = req.headers.authorization;
  return h === `Bearer ${token}`;
}
