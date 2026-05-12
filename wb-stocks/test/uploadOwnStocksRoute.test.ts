import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../src/infra/db.js";
import { OwnStockSnapshotRepository } from "../src/infra/ownStockSnapshotRepository.js";
import { createUploadOwnStocksRoute } from "../src/server/forecast-ui/handlers/uploadOwnStocksRoute.js";
import type { ForecastUiServerCtx } from "../src/server/forecast-ui/forecastUiServerCtx.js";

function makeReq(method: string, body: string): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  (req as { method: string }).method = method;
  queueMicrotask(() => {
    req.emit("data", Buffer.from(body, "utf8"));
    req.emit("end");
  });
  return req;
}

interface CapturedResponse {
  statusCode: number;
  body: unknown;
}

function makeRes(): { res: ServerResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 0, body: null };
  const chunks: Buffer[] = [];
  const res: Partial<ServerResponse> = {
    writeHead(status: number) {
      captured.statusCode = status;
      return res as ServerResponse;
    },
    end(chunk?: unknown) {
      if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
      else if (Buffer.isBuffer(chunk)) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString("utf8");
      captured.body = text ? JSON.parse(text) : null;
      return res as ServerResponse;
    },
  };
  return { res: res as ServerResponse, captured };
}

function silentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as ForecastUiServerCtx["logger"];
}

function makeCtx(): ForecastUiServerCtx {
  const db = openDatabase(":memory:");
  return {
    cfg: { FORECAST_UI_TOKEN: "" } as unknown as ForecastUiServerCtx["cfg"],
    db,
    logger: silentLogger(),
    wbClient: {} as unknown as ForecastUiServerCtx["wbClient"],
  };
}

describe("POST /api/forecast/upload-own-stocks", () => {
  it("ingests the demo CSV format (vendor + WB article + Остаток склад Канпол рус)", async () => {
    const ctx = makeCtx();
    const route = createUploadOwnStocksRoute(ctx);
    const url = new URL(
      "http://127.0.0.1/api/forecast/upload-own-stocks?date=2026-05-12&filename=order-form.csv",
    );
    expect(route.match({ method: "POST" } as IncomingMessage, url)).toBe(true);

    const csv = [
      "Артикул продавца,Артикул WB,Остаток склад Канпол рус",
      "35/368_gre,507833572,75",
      "23/222_blu_NEW,488894119,0",
      "35/368_blu,,0",
      "35/368_bei,507833580,459",
    ].join("\n");

    const { res, captured } = makeRes();
    await route.handle(makeReq("POST", csv), res, url);

    expect(captured.statusCode).toBe(200);
    const body = captured.body as {
      ok: boolean;
      snapshotDate: string;
      warehouseCode: string;
      inserted: number;
      skipped: number;
      detection: { vendorColumn: string; wbColumn: string; quantityColumn: string };
    };
    expect(body.ok).toBe(true);
    expect(body.snapshotDate).toBe("2026-05-12");
    expect(body.warehouseCode).toBe("main");
    expect(body.inserted).toBe(4);
    expect(body.skipped).toBe(0);
    expect(body.detection.vendorColumn).toBe("Артикул продавца");
    expect(body.detection.wbColumn).toBe("Артикул WB");
    expect(body.detection.quantityColumn).toBe("Остаток склад Канпол рус");

    const repo = new OwnStockSnapshotRepository(ctx.db);
    const map = repo.quantitiesByVendor("2026-05-12", "main");
    expect(map.get("35/368_gre")).toBe(75);
    expect(map.get("35/368_bei")).toBe(459);
    expect(map.size).toBe(4);
  });

  it("rejects empty body with 400", async () => {
    const ctx = makeCtx();
    const route = createUploadOwnStocksRoute(ctx);
    const url = new URL("http://127.0.0.1/api/forecast/upload-own-stocks");
    const { res, captured } = makeRes();
    await route.handle(makeReq("POST", ""), res, url);
    expect(captured.statusCode).toBe(400);
    expect((captured.body as { ok: boolean }).ok).toBe(false);
  });

  it("returns 400 on malformed date param", async () => {
    const ctx = makeCtx();
    const route = createUploadOwnStocksRoute(ctx);
    const url = new URL(
      "http://127.0.0.1/api/forecast/upload-own-stocks?date=18.04.2026",
    );
    const { res, captured } = makeRes();
    await route.handle(makeReq("POST", "Артикул,Остаток\nA,1\n"), res, url);
    expect(captured.statusCode).toBe(400);
    const body = captured.body as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/YYYY-MM-DD/);
  });
});
