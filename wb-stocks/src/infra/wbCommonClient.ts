import type { Logger } from "pino";
import { WbApiError } from "./wbStatsClient.js";

export interface WbCommonClientOptions {
  baseUrl: string;
  token: string;
  logger: Logger;
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * Thin typed wrapper over the subset of WB Common API
 * (`https://common-api.wildberries.ru`) that we use for warehouse tariffs:
 *
 *   GET /api/v1/tariffs/box?date=YYYY-MM-DD
 *   GET /api/v1/tariffs/pallet?date=YYYY-MM-DD
 *   GET /api/tariffs/v1/acceptance/coefficients[?warehouseIDs=...]
 *
 * All three return WB's standard envelope `{ response: { data: ... } }` for
 * box/pallet and a flat array for acceptance. We return the **raw body**
 * here so parsing/validation lives one level up (mapTariff layer) and we can
 * log/skip individual malformed rows without losing the whole response.
 *
 * Rate limits (from WB docs):
 *   - tariffs/box and tariffs/pallet:  60 req/min, plus a basic limit
 *     of 1 req/hour for unprivileged services. We call once per day per
 *     endpoint so we never hit it in practice.
 *   - acceptance/coefficients:         6 req/min (10 sec interval).
 *
 * Auth: same seller token as Statistics/Supplies; scope required is
 * **"Маркетплейс"** or **"Поставки"** (поставки достаточно). Sent as bare
 * `Authorization: <token>` header (no `Bearer ` prefix), per WB convention.
 */
export class WbCommonClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly logger: Logger;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(opts: WbCommonClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.logger = opts.logger;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  /** GET /api/v1/tariffs/box?date=YYYY-MM-DD — returns the parsed envelope. */
  async getBoxTariffs(params: { date: string }): Promise<unknown> {
    const url = new URL("/api/v1/tariffs/box", this.baseUrl);
    url.searchParams.set("date", params.date);
    return this.requestWithRetry(url);
  }

  /** GET /api/v1/tariffs/pallet?date=YYYY-MM-DD — returns the parsed envelope. */
  async getPalletTariffs(params: { date: string }): Promise<unknown> {
    const url = new URL("/api/v1/tariffs/pallet", this.baseUrl);
    url.searchParams.set("date", params.date);
    return this.requestWithRetry(url);
  }

  /**
   * GET /api/tariffs/v1/acceptance/coefficients[?warehouseIDs=507,117501]
   *
   * Returns a flat array of `AcceptanceCoefficient` objects (one row per
   * date × warehouse × boxType, 14 dates ahead).
   */
  async getAcceptanceCoefficients(
    params: { warehouseIds?: readonly number[] } = {},
  ): Promise<unknown[]> {
    const url = new URL("/api/tariffs/v1/acceptance/coefficients", this.baseUrl);
    if (params.warehouseIds && params.warehouseIds.length > 0) {
      url.searchParams.set("warehouseIDs", params.warehouseIds.join(","));
    }
    const body = await this.requestWithRetry(url);
    if (!Array.isArray(body)) {
      throw new WbApiError(
        `Unexpected WB response shape: expected array, got ${typeof body}`,
      );
    }
    return body;
  }

  private async requestWithRetry(url: URL): Promise<unknown> {
    let attempt = 0;
    let lastError: unknown;
    while (attempt <= this.maxRetries) {
      try {
        return await this.requestOnce(url);
      } catch (err) {
        lastError = err;
        const retriable = isRetriable(err);
        if (!retriable || attempt === this.maxRetries) {
          throw err;
        }
        const delayMs = backoffDelayMs(attempt, err);
        this.logger.warn(
          { attempt, delayMs, err: serializeError(err) },
          "WB common API transient failure, retrying",
        );
        await sleep(delayMs);
        attempt += 1;
      }
    }
    throw lastError;
  }

  private async requestOnce(url: URL): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: this.token,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new WbApiError(
          `WB API ${res.status} ${res.statusText} for ${url.pathname}`,
          res.status,
          text.slice(0, 500),
        );
      }
      try {
        return text.length === 0 ? [] : JSON.parse(text);
      } catch {
        throw new WbApiError(
          `WB API returned non-JSON body for ${url.pathname}`,
          res.status,
          text.slice(0, 500),
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

function isRetriable(err: unknown): boolean {
  if (err instanceof WbApiError) {
    if (err.status === undefined) return false;
    return err.status === 429 || err.status >= 500;
  }
  if (err instanceof Error && err.name === "AbortError") return true;
  return false;
}

function backoffDelayMs(attempt: number, err: unknown): number {
  // Acceptance has a tight 6 req/min limit (= 10s window); the box/pallet
  // have 60/min. We're called once a day so spurious 429s are unlikely.
  // Use a moderate backoff matching the supplies client (2s, 4s, 6s); if
  // we still hit the limit after 3 attempts the CLI exits and the daily
  // cron retries later.
  if (err instanceof WbApiError && err.status === 429) {
    return 2_000 * (attempt + 1) + Math.floor(Math.random() * 500);
  }
  const base = 500 * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof WbApiError) {
    return { name: err.name, message: err.message, status: err.status };
  }
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return { value: String(err) };
}
