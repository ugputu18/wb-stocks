import { createHash } from "node:crypto";
import type { Logger } from "../logger.js";

export interface OpticoreReportsClientOptions {
  reportsUrl: string;
  user: string;
  password: string;
  httpUser?: string;
  httpPassword?: string;
  timeoutMs?: number;
  logger?: Logger;
}

export interface OpticoreStockRow {
  warehouseId: string;
  skuId: string;
  unitId: string;
  stockTypeId: string;
  qty: number;
  /** Non-standard extensions sometimes present in project-specific APIs. */
  article?: string;
  code?: string;
}

export interface OpticoreStockResponse {
  actualAt: string;
  rows: OpticoreStockRow[];
  errorMessage?: string;
}

export function makeOpticoreDailyPass(rawPassword: string, date: string): string {
  return createHash("md5").update(`${rawPassword}|${date}`, "utf8").digest("hex");
}

export function buildOpticoreReportsUrl(args: {
  endpoint?: string;
  baseUrl?: string;
}): string {
  if (args.endpoint) return args.endpoint;
  if (!args.baseUrl) {
    throw new Error("OPTICORE_REPORTS_URL or OPTICORE_BASE_URL is required");
  }
  const baseUrl = args.baseUrl;
  return `${baseUrl.replace(/\/+$/, "")}/reports.asmx`;
}

export class OpticoreReportsClient {
  private readonly timeoutMs: number;

  constructor(private readonly options: OpticoreReportsClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async getStockList(passDate = todayLocalIsoDate()): Promise<OpticoreStockResponse> {
    const dailyPass = makeOpticoreDailyPass(this.options.password, passDate);
    const body = buildStockRequest(this.options.user, dailyPass);
    const xml = await this.postSoap(body);
    return parseStockResponse(xml);
  }

  private async postSoap(soapBody: string): Promise<string> {
    const headers: Record<string, string> = {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: '"http://cowms.ru/reports/Stock_GetList"',
    };

    if (this.options.httpUser && this.options.httpPassword) {
      const basic = Buffer.from(
        `${this.options.httpUser}:${this.options.httpPassword}`,
        "utf8",
      ).toString("base64");
      headers.Authorization = `Basic ${basic}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.options.reportsUrl, {
        method: "POST",
        headers,
        body: soapBody,
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          `OptiCore responded ${response.status} ${response.statusText}: ${text.slice(0, 500)}`,
        );
      }
      return text;
    } catch (err) {
      if (err instanceof Error) {
        const cause = err.cause;
        const causeMessage =
          cause && typeof cause === "object" && "message" in cause
            ? `: ${String(cause.message)}`
            : "";
        throw new Error(
          `OptiCore request failed for ${this.options.reportsUrl}: ${err.message}${causeMessage}`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function buildStockRequest(user: string, pass: string): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '               xmlns:xsd="http://www.w3.org/2001/XMLSchema"',
    '               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">',
    "  <soap:Body>",
    '    <Stock_GetList xmlns="http://cowms.ru/reports">',
    `      <User>${xmlEscape(user)}</User>`,
    `      <Pass>${xmlEscape(pass)}</Pass>`,
    "    </Stock_GetList>",
    "  </soap:Body>",
    "</soap:Envelope>",
  ].join("\n");
}

export function parseStockResponse(xml: string): OpticoreStockResponse {
  const actualAt = tagValue(xml, "Stock_GetListResult") ?? "";
  const errorMessage = tagValue(xml, "ErrorMessage");
  const rows: OpticoreStockRow[] = [];
  const blockPattern = /<(?:\w+:)?WarehouseStock>([\s\S]*?)<\/(?:\w+:)?WarehouseStock>/gi;

  for (const match of xml.matchAll(blockPattern)) {
    const block = match[1] ?? "";
    const warehouseId = tagValue(block, "Warehouse_id");
    const skuId = tagValue(block, "Sku_id");
    const unitId = tagValue(block, "Unit_id");
    const stockTypeId = tagValue(block, "StockType_id");
    const qtyRaw = tagValue(block, "Qty");
    const qty = Number(qtyRaw);

    if (
      !warehouseId ||
      !skuId ||
      !unitId ||
      !stockTypeId ||
      qtyRaw === undefined ||
      !Number.isFinite(qty)
    ) {
      continue;
    }

    rows.push({
      warehouseId,
      skuId,
      unitId,
      stockTypeId,
      qty,
      article: tagValue(block, "Article"),
      code: tagValue(block, "Code"),
    });
  }

  return { actualAt, rows, errorMessage };
}

function todayLocalIsoDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xmlDecode(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
    .trim();
}

function tagValue(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "i"));
  return match ? xmlDecode(match[1] ?? "") : undefined;
}
