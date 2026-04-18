import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wbStocksRoot = resolve(__dirname, "..");

export default defineConfig({
  plugins: [preact()],
  root: __dirname,
  base: "/next/",
  build: {
    outDir: resolve(wbStocksRoot, "public/forecast-ui-next"),
    /** outDir вне `root`; явно разрешаем очистку при сборке */
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: false,
    fs: {
      allow: [wbStocksRoot],
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3847",
      },
    },
  },
});
