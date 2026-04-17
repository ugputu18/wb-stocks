import { pino } from "pino";

const level = process.env.LOG_LEVEL ?? "info";

export const logger = pino({
  level,
  base: { service: "wb-stocks" },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
