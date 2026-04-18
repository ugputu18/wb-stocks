import { readFileSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { isForecastUiSpaPath } from "../../../forecastUiRoutes.js";
import { json } from "../http/json.js";
import { STATIC_DIR, STATIC_DIR_NEXT } from "../staticPaths.js";
import type { ForecastRouteMatch } from "../routes/routeTypes.js";

/**
 * SPA entry, legacy `/legacy`, redirect `/next` → `/`, `/next/*` assets, `/static/*` legacy assets.
 * Order preserved vs original `forecastUiServer.ts`.
 */
export function createSpaStaticRoutes(): ForecastRouteMatch[] {
  return [
    {
      match: (req, url) =>
        req.method === "GET" && isForecastUiSpaPath(url.pathname),
      handle: (req, res, url) => {
        void url;
        const p = join(STATIC_DIR_NEXT, "index.html");
        if (!existsSync(p)) {
          json(res, 503, {
            ok: false,
            error:
              "Forecast UI not built: run pnpm build:forecast-ui-client in wb-stocks",
          });
          return;
        }
        const html = readFileSync(p, "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      },
    },
    {
      match: (req, url) =>
        req.method === "GET" && (url.pathname === "/legacy" || url.pathname === "/legacy/"),
      handle: (req, res, url) => {
        void req;
        void url;
        const p = join(STATIC_DIR, "index.html");
        if (!existsSync(p)) {
          json(res, 500, { ok: false, error: "Missing public/forecast-ui/index.html" });
          return;
        }
        const html = readFileSync(p, "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      },
    },
    {
      match: (req, url) =>
        req.method === "GET" && (url.pathname === "/next" || url.pathname === "/next/"),
      handle: (req, res, url) => {
        void req;
        const loc = `/${url.search}`;
        res.writeHead(302, { Location: loc });
        res.end();
      },
    },
    {
      match: (req, url) =>
        req.method === "GET" &&
        url.pathname.startsWith("/next/") &&
        url.pathname.length > "/next/".length,
      handle: (req, res, url) => {
        void req;
        const name = url.pathname.slice("/next/".length);
        if (!name || name.includes("..")) {
          json(res, 404, { ok: false, error: "Not found" });
          return;
        }
        const p = resolve(STATIC_DIR_NEXT, name);
        const rel = relative(STATIC_DIR_NEXT, p);
        if (rel.startsWith("..") || rel === "") {
          json(res, 404, { ok: false, error: "Not found" });
          return;
        }
        if (!existsSync(p)) {
          json(res, 404, { ok: false, error: "Not found" });
          return;
        }
        const ext = name.split(".").pop();
        const ct =
          ext === "js"
            ? "text/javascript; charset=utf-8"
            : ext === "css"
              ? "text/css; charset=utf-8"
              : "application/octet-stream";
        res.writeHead(200, { "Content-Type": ct });
        res.end(readFileSync(p));
      },
    },
    {
      match: (req, url) => req.method === "GET" && url.pathname.startsWith("/static/"),
      handle: (req, res, url) => {
        void req;
        const name = url.pathname.slice("/static/".length);
        if (!name || name.includes("..")) {
          json(res, 404, { ok: false, error: "Not found" });
          return;
        }
        const p = resolve(STATIC_DIR, name);
        const rel = relative(STATIC_DIR, p);
        if (rel.startsWith("..") || rel === "") {
          json(res, 404, { ok: false, error: "Not found" });
          return;
        }
        if (!existsSync(p)) {
          json(res, 404, { ok: false, error: "Not found" });
          return;
        }
        const ext = name.split(".").pop();
        const ct =
          ext === "js"
            ? "text/javascript; charset=utf-8"
            : ext === "css"
              ? "text/css; charset=utf-8"
              : "application/octet-stream";
        res.writeHead(200, { "Content-Type": ct });
        res.end(readFileSync(p));
      },
    },
  ];
}
