import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WbStatsClient, WbApiError } from "../src/infra/wbStatsClient.js";

function silentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as ConstructorParameters<typeof WbStatsClient>[0]["logger"];
}

describe("WbStatsClient.getSupplierStocks", () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("calls the correct URL with Authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ nmId: 1, warehouseName: "A", quantity: 1 }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new WbStatsClient({
      baseUrl: "https://statistics-api.wildberries.ru/",
      token: "test-token",
      logger: silentLogger(),
    });

    const rows = await client.getSupplierStocks({ dateFrom: "2019-06-20" });
    expect(rows).toHaveLength(1);

    const callArgs = fetchMock.mock.calls[0]!;
    const urlArg = callArgs[0] as URL;
    expect(urlArg.toString()).toBe(
      "https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=2019-06-20",
    );
    const init = callArgs[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "test-token",
    );
  });

  it("throws WbApiError with status on 4xx", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("unauthorized", { status: 401 }),
    ) as unknown as typeof fetch;

    const client = new WbStatsClient({
      baseUrl: "https://statistics-api.wildberries.ru",
      token: "bad",
      logger: silentLogger(),
      maxRetries: 0,
    });

    await expect(
      client.getSupplierStocks({ dateFrom: "2019-06-20" }),
    ).rejects.toMatchObject({ name: "WbApiError", status: 401 });
  });

  it("retries on 429 and eventually succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new WbStatsClient({
      baseUrl: "https://statistics-api.wildberries.ru",
      token: "t",
      logger: silentLogger(),
      maxRetries: 2,
    });

    const rows = await client.getSupplierStocks({ dateFrom: "2019-06-20" });
    expect(rows).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("getSupplierOrders calls the right URL with flag param", async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new WbStatsClient({
      baseUrl: "https://statistics-api.wildberries.ru",
      token: "t",
      logger: silentLogger(),
    });

    await client.getSupplierOrders({ dateFrom: "2026-04-01", flag: 0 });
    const url = fetchMock.mock.calls[0]![0] as URL;
    expect(url.toString()).toBe(
      "https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=2026-04-01&flag=0",
    );

    await client.getSupplierOrders({ dateFrom: "2026-04-15" });
    const url2 = fetchMock.mock.calls[1]![0] as URL;
    expect(url2.searchParams.get("flag")).toBeNull();
  });

  it("getSupplierOrders throws WbApiError when the body is not an array", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "x" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const client = new WbStatsClient({
      baseUrl: "https://statistics-api.wildberries.ru",
      token: "t",
      logger: silentLogger(),
      maxRetries: 0,
    });

    await expect(
      client.getSupplierOrders({ dateFrom: "2026-04-01" }),
    ).rejects.toBeInstanceOf(WbApiError);
  });

  it("throws when response is not an array", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "nope" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const client = new WbStatsClient({
      baseUrl: "https://statistics-api.wildberries.ru",
      token: "t",
      logger: silentLogger(),
      maxRetries: 0,
    });

    await expect(
      client.getSupplierStocks({ dateFrom: "2019-06-20" }),
    ).rejects.toBeInstanceOf(WbApiError);
  });
});
