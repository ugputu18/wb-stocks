import { describe, expect, it, vi } from "vitest";
import {
  sendXlsxAttachment,
  XLSX_CONTENT_TYPE,
} from "../src/server/forecast-ui/http/sendXlsxAttachment.js";

interface FakeResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer | null;
  writeHead: (status: number, headers: Record<string, string>) => void;
  end: (body: Buffer) => void;
}

function fakeResponse(): FakeResponse {
  const r: FakeResponse = {
    status: 0,
    headers: {},
    body: null,
    writeHead: vi.fn((status, headers) => {
      r.status = status;
      r.headers = { ...headers };
    }),
    end: vi.fn((body) => {
      r.body = body;
    }),
  };
  return r;
}

describe("sendXlsxAttachment Content-Disposition", () => {
  it("uses bare filename= for ASCII names (back-compat)", () => {
    const res = fakeResponse();
    sendXlsxAttachment(
      res as unknown as Parameters<typeof sendXlsxAttachment>[0],
      "wb-replenishment-2026-04-18-h30.xlsx",
      Buffer.from([0x50, 0x4b]),
    );
    expect(res.headers["Content-Disposition"]).toBe(
      'attachment; filename="wb-replenishment-2026-04-18-h30.xlsx"',
    );
  });

  it("ASCII-encodes Cyrillic file names and adds RFC 5987 filename*", () => {
    // Главный сценарий ради которого мы держим RFC 5987: имя содержит
    // кириллический регион → Node бы кинул ERR_INVALID_CHAR на голом
    // filename=. Не-ASCII заменяется на `_` в filename=, оригинал
    // уезжает в filename*=UTF-8''.
    const res = fakeResponse();
    sendXlsxAttachment(
      res as unknown as Parameters<typeof sendXlsxAttachment>[0],
      "regional-stocks-Центральный-2026-04-18-h10.xlsx",
      Buffer.from([0x50, 0x4b]),
    );
    const cd = res.headers["Content-Disposition"]!;
    expect(cd).toContain(
      'filename="regional-stocks-___________-2026-04-18-h10.xlsx"',
    );
    expect(cd).toContain(
      "filename*=UTF-8''regional-stocks-%D0%A6%D0%B5%D0%BD%D1%82%D1%80%D0%B0%D0%BB%D1%8C%D0%BD%D1%8B%D0%B9-2026-04-18-h10.xlsx",
    );
    expect(/^[\x20-\x7E]+$/.test(cd)).toBe(true);
  });

  it("falls back to 'download.xlsx' only when the sanitized fallback is empty", () => {
    const res2 = fakeResponse();
    sendXlsxAttachment(
      res2 as unknown as Parameters<typeof sendXlsxAttachment>[0],
      "  ",
      Buffer.from([0x50, 0x4b]),
    );
    expect(res2.headers["Content-Disposition"]).toContain(
      'filename="download.xlsx"',
    );
  });

  it("sets xlsx content-type, content-length and the body buffer", () => {
    const res = fakeResponse();
    const body = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    sendXlsxAttachment(
      res as unknown as Parameters<typeof sendXlsxAttachment>[0],
      "x.xlsx",
      body,
    );
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe(XLSX_CONTENT_TYPE);
    expect(res.headers["Content-Length"]).toBe(String(body.length));
    expect(res.body).toBe(body);
  });
});
