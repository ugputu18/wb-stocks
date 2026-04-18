import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Legacy vanilla UI assets (`/static/*`). */
export const STATIC_DIR = resolve(__dirname, "../../../public/forecast-ui");

/** Preact/Vite build (`pnpm build:forecast-ui-client`); main UI at `/`, assets under `/next/*` (Vite `base: /next/`). */
export const STATIC_DIR_NEXT = resolve(__dirname, "../../../public/forecast-ui-next");
