import type { IncomingMessage } from "node:http";
import type { AppConfig } from "../../../config/env.js";

/** All `GET/POST /api/*` require `Authorization: Bearer <FORECAST_UI_TOKEN>` when that env is set. */
export function authOk(
  cfg: AppConfig,
  req: IncomingMessage,
  pathname: string,
): boolean {
  const token = cfg.FORECAST_UI_TOKEN;
  if (!token) return true;
  if (!pathname.startsWith("/api/")) return true;
  const h = req.headers.authorization;
  return h === `Bearer ${token}`;
}
