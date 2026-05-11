import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WbCommonClient } from "../src/infra/wbCommonClient.js";
import { WbApiError } from "../src/infra/wbStatsClient.js";

function silentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as ConstructorParameters<typeof WbCommonClient>[0]["logger"];
}

describe("WbCommonClient", () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("getBoxTariffs calls /api/v1/tariffs/box with date and Authorization", async () => {
    const body = {
      response: { data: { warehouseList: [{ warehouseName: "Коледино" }] } },
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new WbCommonClient({
      baseUrl: "https://common-api.wildberries.ru/",
      token: "tok",
      logger: silentLogger(),
    });
    const resp = await client.getBoxTariffs({ date: "2026-05-11" });
    expect(resp).toEqual(body);

    const url = fetchMock.mock.calls[0]![0] as URL;
    expect(url.toString()).toBe(
      "https://common-api.wildberries.ru/api/v1/tariffs/box?date=2026-05-11",
    );
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("tok");
  });

  it("getPalletTariffs targets the pallet endpoint", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ response: { data: { warehouseList: [] } } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ) as unknown as typeof fetch;

    const client = new WbCommonClient({
      baseUrl: "https://common-api.wildberries.ru",
      token: "tok",
      logger: silentLogger(),
    });
    await client.getPalletTariffs({ date: "2026-05-11" });
    const url = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as URL;
    expect(url.pathname).toBe("/api/v1/tariffs/pallet");
    expect(url.searchParams.get("date")).toBe("2026-05-11");
  });

  it("getAcceptanceCoefficients joins warehouseIDs and returns an array", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ date: "x", coefficient: 0, warehouseID: 507 }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new WbCommonClient({
      baseUrl: "https://common-api.wildberries.ru",
      token: "tok",
      logger: silentLogger(),
    });
    const rows = await client.getAcceptanceCoefficients({
      warehouseIds: [507, 117501],
    });
    expect(Array.isArray(rows)).toBe(true);
    const url = fetchMock.mock.calls[0]![0] as URL;
    expect(url.pathname).toBe("/api/tariffs/v1/acceptance/coefficients");
    expect(url.searchParams.get("warehouseIDs")).toBe("507,117501");
  });

  it("omits warehouseIDs param when list is empty/undefined", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new WbCommonClient({
      baseUrl: "https://common-api.wildberries.ru",
      token: "tok",
      logger: silentLogger(),
    });
    await client.getAcceptanceCoefficients({});
    const url = fetchMock.mock.calls[0]![0] as URL;
    expect(url.searchParams.has("warehouseIDs")).toBe(false);
  });

  it("acceptance throws WbApiError when body is not an array", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "nope" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ) as unknown as typeof fetch;
    const client = new WbCommonClient({
      baseUrl: "https://common-api.wildberries.ru",
      token: "tok",
      logger: silentLogger(),
      maxRetries: 0,
    });
    await expect(
      client.getAcceptanceCoefficients(),
    ).rejects.toBeInstanceOf(WbApiError);
  });

  it("throws WbApiError with status on 401 (no retry)", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;

    const client = new WbCommonClient({
      baseUrl: "https://common-api.wildberries.ru",
      token: "bad",
      logger: silentLogger(),
      maxRetries: 0,
    });
    await expect(
      client.getBoxTariffs({ date: "2026-05-11" }),
    ).rejects.toMatchObject({ name: "WbApiError", status: 401 });
  });

  it("retries on 429 then succeeds", async () => {
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

    const client = new WbCommonClient({
      baseUrl: "https://common-api.wildberries.ru",
      token: "t",
      logger: silentLogger(),
      maxRetries: 2,
    });
    const rows = await client.getAcceptanceCoefficients();
    expect(rows).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
