import { z } from "zod";

/**
 * WB_TOKEN is only required for flows that actually talk to WB API
 * (i.e. the `import:stocks` CLI). The own-warehouse import doesn't need it,
 * so we make it optional here and let the WB client validate presence at
 * use time. Keeps one env schema for the whole module.
 */
const envSchema = z.object({
  WB_TOKEN: z.string().min(1).optional(),
  WB_STATS_BASE_URL: z
    .string()
    .url()
    .default("https://statistics-api.wildberries.ru"),
  WB_SUPPLIES_BASE_URL: z
    .string()
    .url()
    .default("https://supplies-api.wildberries.ru"),
  DATABASE_PATH: z.string().min(1).default("./data/wb-stocks.sqlite"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
    .default("info"),
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
