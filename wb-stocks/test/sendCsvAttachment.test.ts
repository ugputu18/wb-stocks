import { describe, expect, it, vi } from "vitest";
import { sendCsvAttachment } from "../src/server/forecast-ui/http/sendCsvAttachment.js";

interface FakeResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  writeHead: (status: number, headers: Record<string, string>) => void;
  end: (body: string, enc: string) => void;
}

function fakeResponse(): FakeResponse {
  const r: FakeResponse = {
    status: 0,
    headers: {},
    body: "",
    writeHead: vi.fn((status, headers) => {
      r.status = status;
      r.headers = { ...headers };
    }),
    end: vi.fn((body, _enc) => {
      r.body = body;
    }),
  };
  return r;
}

describe("sendCsvAttachment Content-Disposition", () => {
  it("uses bare filename= for ASCII names (back-compat)", () => {
    const res = fakeResponse();
    sendCsvAttachment(
      res as unknown as Parameters<typeof sendCsvAttachment>[0],
      "wb-replenishment-2026-04-18-h30.csv",
      "a,b\n1,2",
    );
    expect(res.headers["Content-Disposition"]).toBe(
      'attachment; filename="wb-replenishment-2026-04-18-h30.csv"',
    );
  });

  it("ASCII-encodes Cyrillic file names and adds RFC 5987 filename*", () => {
    // Сценарий из бага: имя содержит кириллический регион → Node бы кинул
    // ERR_INVALID_CHAR на голом filename=. Здесь не-ASCII заменяется на `_`
    // в filename=, а оригинал уезжает в filename*=UTF-8''.
    const res = fakeResponse();
    sendCsvAttachment(
      res as unknown as Parameters<typeof sendCsvAttachment>[0],
      "regional-stocks-Центральный-2026-04-18-h10.csv",
      "a,b\n1,2",
    );
    const cd = res.headers["Content-Disposition"]!;
    expect(cd).toContain('filename="regional-stocks-___________-2026-04-18-h10.csv"');
    expect(cd).toContain(
      "filename*=UTF-8''regional-stocks-%D0%A6%D0%B5%D0%BD%D1%82%D1%80%D0%B0%D0%BB%D1%8C%D0%BD%D1%8B%D0%B9-2026-04-18-h10.csv",
    );
    // Главный инвариант: весь header — валидные ASCII-символы (именно
    // этот контракт ловит исходный баг с ERR_INVALID_CHAR в Node).
    expect(/^[\x20-\x7E]+$/.test(cd)).toBe(true);
  });

  it("falls back to 'download.csv' only when the sanitized fallback is empty", () => {
    // Имя из не-ASCII символов превращается в `_____` (не пусто), значит
    // `download.csv` не нужен — клиенты, поддерживающие RFC 5987, всё равно
    // увидят оригинал в filename*.
    const res = fakeResponse();
    sendCsvAttachment(
      res as unknown as Parameters<typeof sendCsvAttachment>[0],
      "приволжский",
      "x",
    );
    const cd = res.headers["Content-Disposition"];
    expect(cd).toContain('filename="___________"');
    expect(cd).toContain(
      "filename*=UTF-8''%D0%BF%D1%80%D0%B8%D0%B2%D0%BE%D0%BB%D0%B6%D1%81%D0%BA%D0%B8%D0%B9",
    );

    // Whitespace-only / пустое имя — fallback `filename="download.csv"`,
    // защищающий от пустого `filename=""` в заголовке (Node его принимает,
    // но клиент скачает файл без имени).
    const res2 = fakeResponse();
    sendCsvAttachment(
      res2 as unknown as Parameters<typeof sendCsvAttachment>[0],
      "  ",
      "x",
    );
    expect(res2.headers["Content-Disposition"]).toContain(
      'filename="download.csv"',
    );
  });

  it("emits UTF-8 BOM + body and sets text/csv content-type", () => {
    const res = fakeResponse();
    sendCsvAttachment(
      res as unknown as Parameters<typeof sendCsvAttachment>[0],
      "x.csv",
      "h\nv",
    );
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/csv; charset=utf-8");
    expect(res.body.startsWith("\uFEFF")).toBe(true);
    expect(res.body.slice(1)).toBe("h\nv");
  });
});
