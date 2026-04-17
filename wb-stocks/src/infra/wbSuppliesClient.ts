import type { Logger } from "pino";
import { WbApiError } from "./wbStatsClient.js";

export interface WbSuppliesClientOptions {
  baseUrl: string;
  token: string;
  logger: Logger;
  timeoutMs?: number;
  maxRetries?: number;
}

export type WbSupplyDateType =
  | "createDate"
  | "supplyDate"
  | "factDate"
  | "updatedDate";

export interface ListSuppliesParams {
  limit?: number;
  offset?: number;
  dates?: ReadonlyArray<{ from: string; till: string; type: WbSupplyDateType }>;
  statusIDs?: readonly number[];
}

/**
 * Thin typed wrapper over the subset of WB FBW Supplies API we use.
 * Endpoints:
 *   POST /api/v1/supplies               — Supplies List (returns headers)
 *   GET  /api/v1/supplies/{ID}          — Supply Details (warehouse + qty)
 *   GET  /api/v1/supplies/{ID}/goods    — Supply Products (line items)
 *
 * Rate limit: 30 req/min per seller account per method.
 */
export class WbSuppliesClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly logger: Logger;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(opts: WbSuppliesClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.logger = opts.logger;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  async listSupplies(params: ListSuppliesParams = {}): Promise<unknown[]> {
    const url = new URL("/api/v1/supplies", this.baseUrl);
    url.searchParams.set("limit", String(params.limit ?? 1000));
    url.searchParams.set("offset", String(params.offset ?? 0));

    const body: Record<string, unknown> = {};
    if (params.dates && params.dates.length > 0) body["dates"] = params.dates;
    if (params.statusIDs && params.statusIDs.length > 0)
      body["statusIDs"] = params.statusIDs;

    const resp = await this.requestWithRetry(url, {
      method: "POST",
      jsonBody: body,
    });
    if (!Array.isArray(resp)) {
      throw new WbApiError(
        `Unexpected WB response shape: expected array, got ${typeof resp}`,
      );
    }
    return resp;
  }

  async getSupplyDetails(supplyId: number): Promise<unknown> {
    const url = new URL(
      `/api/v1/supplies/${encodeURIComponent(String(supplyId))}`,
      this.baseUrl,
    );
    url.searchParams.set("isPreorderID", "false");
    return this.requestWithRetry(url, { method: "GET" });
  }

  async getSupplyGoods(
    supplyId: number,
    params: { limit?: number; offset?: number } = {},
  ): Promise<unknown[]> {
    const url = new URL(
      `/api/v1/supplies/${encodeURIComponent(String(supplyId))}/goods`,
      this.baseUrl,
    );
    url.searchParams.set("limit", String(params.limit ?? 1000));
    url.searchParams.set("offset", String(params.offset ?? 0));
    url.searchParams.set("isPreorderID", "false");

    const resp = await this.requestWithRetry(url, { method: "GET" });
    if (!Array.isArray(resp)) {
      throw new WbApiError(
        `Unexpected WB response shape: expected array, got ${typeof resp}`,
      );
    }
    return resp;
  }

  private async requestWithRetry(
    url: URL,
    options: { method: "GET" | "POST"; jsonBody?: unknown },
  ): Promise<unknown> {
    let attempt = 0;
    let lastError: unknown;
    while (attempt <= this.maxRetries) {
      try {
        return await this.requestOnce(url, options);
      } catch (err) {
        lastError = err;
        const retriable = isRetriable(err);
        if (!retriable || attempt === this.maxRetries) {
          throw err;
        }
        const delayMs = backoffDelayMs(attempt, err);
        this.logger.warn(
          { attempt, delayMs, err: serializeError(err) },
          "WB supplies API transient failure, retrying",
        );
        await sleep(delayMs);
        attempt += 1;
      }
    }
    throw lastError;
  }

  private async requestOnce(
    url: URL,
    options: { method: "GET" | "POST"; jsonBody?: unknown },
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        Authorization: this.token,
        Accept: "application/json",
      };
      let body: string | undefined;
      if (options.method === "POST") {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(options.jsonBody ?? {});
      }
      const res = await fetch(url, {
        method: options.method,
        headers,
        body,
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
  // 429 is WB's rate-limit: start with a longer backoff so we respect the
  // 30 req/min limit instead of hammering.
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
