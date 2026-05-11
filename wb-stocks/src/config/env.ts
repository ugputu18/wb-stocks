import { z } from "zod";

/**
 * Treat empty strings from `.env` (e.g. `FORECAST_UI_TOKEN=`) the same as an
 * unset variable. Without this, `z.string().min(1).optional()` would still see
 * the empty value as "present" and fail the min(1) check.
 */
const optionalNonEmptyString = z
  .preprocess(
    (value) => (typeof value === "string" && value.length === 0 ? undefined : value),
    z.string().min(1).optional(),
  );

/**
 * WB_TOKEN is only required for flows that actually talk to WB API
 * (i.e. the `import:stocks` CLI). The own-warehouse import doesn't need it,
 * so we make it optional here and let the WB client validate presence at
 * use time. Keeps one env schema for the whole module.
 */
const envSchema = z.object({
  WB_TOKEN: optionalNonEmptyString,
  WB_STATS_BASE_URL: z
    .string()
    .url()
    .default("https://statistics-api.wildberries.ru"),
  WB_SUPPLIES_BASE_URL: z
    .string()
    .url()
    .default("https://supplies-api.wildberries.ru"),
  WB_COMMON_BASE_URL: z
    .string()
    .url()
    .default("https://common-api.wildberries.ru"),
  DATABASE_PATH: z.string().min(1).default("./data/wb-stocks.sqlite"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
    .default("info"),
  /** Local-only forecast UI server (see `pnpm serve:forecast-ui`). */
  FORECAST_UI_HOST: z.string().min(1).default("127.0.0.1"),
  FORECAST_UI_PORT: z.coerce.number().int().positive().default(3847),
  /** If set, JSON API requires `Authorization: Bearer <FORECAST_UI_TOKEN>`. */
  FORECAST_UI_TOKEN: optionalNonEmptyString,
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}
