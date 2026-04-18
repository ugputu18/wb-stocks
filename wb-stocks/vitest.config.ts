import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "forecast-ui-client/test/**/*.test.ts"],
  },
});
