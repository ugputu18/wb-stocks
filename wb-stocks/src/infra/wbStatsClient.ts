import type { Logger } from "pino";

export interface WbStatsClientOptions {
  baseUrl: string;
  token: string;
  logger: Logger;
  /** Request timeout in ms. */
  timeoutMs?: number;
  /** Retry count for transient failures (429, 5xx). */
  maxRetries?: number;
}

export interface GetSupplierStocksParams {
  /**
   * Earliest "last change" date to include.
   * Per WB docs, pass a far-past date (e.g. "2019-06-20") to get full current
   * stock state across all warehouses.
   */
  dateFrom: string;
}

export interface GetSupplierOrdersParams {
  /**
   * RFC3339 datetime in Moscow timezone (UTC+3) — that's what WB uses
   * internally. With `flag=0` (default) returns rows where
   * `lastChangeDate >= dateFrom`. With `flag=1` returns the full slice of
   * orders whose `date` equals the date part of `dateFrom` (time ignored).
   */
  dateFrom: string;
  /** 0 = incremental (default), 1 = full snapshot for the day. */
  flag?: 0 | 1;
}

export class WbApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "WbApiError";
  }
}

/**
 * Thin typed wrapper over the subset of WB Statistics API we use.
 * Intentionally minimal: expand only when a new use case actually needs it.
 */
export class WbStatsClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly logger: Logger;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(opts: WbStatsClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.logger = opts.logger;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  /**
   * GET /api/v1/supplier/stocks
   *
   * Returns the raw JSON array from WB. Parsing/validation happens one level
   * up so we can log and skip individual malformed rows without losing the
   * whole response.
   */
  async getSupplierStocks(params: GetSupplierStocksParams): Promise<unknown[]> {
    const url = new URL("/api/v1/supplier/stocks", this.baseUrl);
    url.searchParams.set("dateFrom", params.dateFrom);

    const body = await this.requestWithRetry(url);
    if (!Array.isArray(body)) {
      throw new WbApiError(
        `Unexpected WB response shape: expected array, got ${typeof body}`,
      );
    }
    return body;
  }

  /**
   * GET /api/v1/supplier/orders
   *
   * Returns the raw JSON array from WB. Each row = one ordered unit
   * (1 piece). WB itself has a strict throttle on this endpoint
   * (~1 request per minute on small accounts), so callers should pace
   * their loops; the in-class retry handles 429 but cannot magically
   * raise the limit.
   *
   * Caller is responsible for pagination by `lastChangeDate`: when a
   * single response is close to ~80k rows, re-call with
   * `dateFrom = lastRow.lastChangeDate`.
   */
  async getSupplierOrders(params: GetSupplierOrdersParams): Promise<unknown[]> {
    const url = new URL("/api/v1/supplier/orders", this.baseUrl);
    url.searchParams.set("dateFrom", params.dateFrom);
    if (params.flag !== undefined) {
      url.searchParams.set("flag", String(params.flag));
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
        const delayMs = backoffDelayMs(attempt);
        this.logger.warn(
          { attempt, delayMs, err: serializeError(err) },
          "WB API transient failure, retrying",
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

function backoffDelayMs(attempt: number): number {
  const base = 500 * Math.pow(2, attempt); // 500, 1000, 2000, 4000
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
