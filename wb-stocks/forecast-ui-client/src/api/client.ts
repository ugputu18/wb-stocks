import type {
  ForecastRowsResponse,
  ForecastSummaryResponse,
  RegionalDemandResponse,
  RegionalStocksResponse,
  RegionalVsWarehouseSummaryResponse,
  SupplierReplenishmentResponse,
  WarehouseKeysResponse,
  WarehouseRegionAuditResponse,
  WarehouseTariffsResponse,
} from "./types.js";

function humanFetchError(err: unknown): Error {
  const m =
    err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
  if (
    m === "Failed to fetch" ||
    m === "NetworkError when attempting to fetch resource."
  ) {
    return new Error(
      "Не удалось связаться с сервером (сеть, другой порт или процесс остановлен).",
    );
  }
  return err instanceof Error ? err : new Error(m);
}

export class ForecastApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ForecastApiError";
    this.status = status;
    this.code = code;
  }
}

export async function apiJson<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const { headers: optHeaders, ...rest } = options;
  const headers = new Headers(optHeaders);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  let res: Response;
  try {
    res = await fetch(path, { ...rest, headers });
  } catch (err) {
    throw humanFetchError(err);
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `Ответ сервера не JSON (код ${res.status}). Проверьте URL и что поднят forecast UI.`,
    );
  }

  if (!res.ok) {
    const d = data as { error?: string; code?: string } | null;
    let msg =
      d && typeof d.error === "string"
        ? d.error
        : res.status === 401
          ? "Сервер отклонил запрос (401). Проверьте настройки доступа к forecast UI."
          : res.statusText || "Ошибка запроса";
    if (res.status === 503 && d?.code === "WB_TOKEN_MISSING") {
      msg =
        (typeof d.error === "string" && d.error) ||
        "Не задан WB_TOKEN на сервере: пересчёт без него недоступен.";
    }
    throw new ForecastApiError(msg, res.status, d?.code);
  }

  return data as T;
}

export function buildApiSearchParams(sp: URLSearchParams): string {
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export async function fetchForecastSummary(
  sp: URLSearchParams,
): Promise<ForecastSummaryResponse> {
  return apiJson<ForecastSummaryResponse>(
    `/api/forecast/summary${buildApiSearchParams(sp)}`,
  );
}

export async function fetchForecastRows(
  sp: URLSearchParams,
): Promise<ForecastRowsResponse> {
  return apiJson<ForecastRowsResponse>(
    `/api/forecast/rows${buildApiSearchParams(sp)}`,
  );
}

export async function fetchSupplierReplenishment(
  sp: URLSearchParams,
): Promise<SupplierReplenishmentResponse> {
  return apiJson<SupplierReplenishmentResponse>(
    `/api/forecast/supplier-replenishment${buildApiSearchParams(sp)}`,
  );
}

export async function fetchWarehouseKeys(
  sp: URLSearchParams,
): Promise<WarehouseKeysResponse> {
  return apiJson<WarehouseKeysResponse>(
    `/api/forecast/warehouse-keys${buildApiSearchParams(sp)}`,
  );
}

export async function fetchRegionalStocks(
  sp: URLSearchParams,
): Promise<RegionalStocksResponse> {
  return apiJson<RegionalStocksResponse>(
    `/api/forecast/regional-stocks${buildApiSearchParams(sp)}`,
  );
}

/**
 * Справочные тарифы по складам WB (последний срез в БД). Не зависит от
 * фильтров регионального отчёта — UI грузит их один раз при монтировании
 * страницы.
 */
export async function fetchWarehouseTariffs(): Promise<WarehouseTariffsResponse> {
  return apiJson<WarehouseTariffsResponse>("/api/forecast/warehouse-tariffs");
}

export interface FetchRegionalDemandBody {
  snapshotDate?: string;
  skus: Array<{ nmId: number; techSize: string }>;
}

export async function fetchRegionalDemand(
  body: FetchRegionalDemandBody,
): Promise<RegionalDemandResponse> {
  return apiJson<RegionalDemandResponse>("/api/forecast/regional-demand", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function fetchWarehouseRegionAudit(
  sp: URLSearchParams,
): Promise<WarehouseRegionAuditResponse> {
  return apiJson<WarehouseRegionAuditResponse>(
    `/api/forecast/warehouse-region-audit${buildApiSearchParams(sp)}`,
  );
}

export async function fetchRegionalVsWarehouseSummary(
  sp: URLSearchParams,
): Promise<RegionalVsWarehouseSummaryResponse> {
  return apiJson<RegionalVsWarehouseSummaryResponse>(
    `/api/forecast/regional-vs-warehouse-summary${buildApiSearchParams(sp)}`,
  );
}

/**
 * Скачивание файла-выгрузки с сервера прогноза (xlsx). Корректно достаёт имя
 * из `Content-Disposition` (включая RFC 5987 `filename*=UTF-8''…` для
 * кириллических регионов) и красиво сообщает об ошибках.
 *
 * Изначально функция называлась `downloadForecastCsv` и слала `Accept: text/csv`;
 * после миграции выгрузок на XLSX оставили универсальное имя
 * `downloadForecastFile`, чтобы не плодить два дублирующих хелпера.
 */
export async function downloadForecastFile(
  path: string,
  fallbackFilename: string,
): Promise<void> {
  const headers: Record<string, string> = {
    Accept:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*",
  };
  let res: Response;
  try {
    res = await fetch(path, { headers });
  } catch (err) {
    throw humanFetchError(err);
  }
  let filename = fallbackFilename;
  const cd = res.headers.get("Content-Disposition");
  if (cd) {
    // Prefer RFC 5987 `filename*=UTF-8''...` (carries non-ASCII names like
    // кириллический регион), fall back to legacy `filename="..."`.
    const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cd);
    if (star) {
      try {
        filename = decodeURIComponent(star[1].trim());
      } catch {
        // ignore; fall through to legacy parse
      }
    }
    if (filename === fallbackFilename) {
      const m = /filename="([^"]+)"/.exec(cd);
      if (m) filename = m[1];
    }
  }
  if (!res.ok) {
    const text = await res.text();
    let msg = res.statusText || "Ошибка экспорта";
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j && typeof j.error === "string") msg = j.error;
    } catch {
      if (text && text.trim()) msg = text.trim().slice(0, 300);
    }
    if (res.status === 401) {
      msg =
        "Сервер отклонил экспорт (401). Проверьте настройки доступа к forecast UI.";
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

export interface UploadOwnStocksResponse {
  ok: true;
  snapshotDate: string;
  warehouseCode: string;
  sourceFile: string;
  fetched: number;
  skipped: number;
  inserted: number;
  filteredOut: number;
  wasUpdate: boolean;
  durationMs: number;
  detection: {
    vendorColumn: string | null;
    wbColumn: string | null;
    quantityColumn: string | null;
    unitColumn: string | null;
    delimiter: string;
    format: "csv" | "spreadsheet";
    sheetName: string | null;
  };
  issues: Array<{ lineNumber: number; reason: string; raw: unknown }>;
}

export interface UploadOwnStocksParams {
  /** Snapshot date `YYYY-MM-DD`; defaults to today (server-local) on the backend. */
  date?: string;
  /** Warehouse code; defaults to `main` on the backend. */
  warehouse?: string;
}

/**
 * Upload an "our warehouse" stocks file to the forecast UI server. CSV, XLS,
 * and XLSX are accepted; column meanings are auto-detected on the server.
 */
export async function uploadOwnStocksCsv(
  file: File,
  params: UploadOwnStocksParams,
): Promise<UploadOwnStocksResponse> {
  const sp = new URLSearchParams();
  sp.set("filename", file.name);
  if (params.date) sp.set("date", params.date);
  if (params.warehouse) sp.set("warehouse", params.warehouse);
  const headers: Record<string, string> = {
    "Content-Type": file.type || contentTypeForOwnStocksFile(file.name),
    Accept: "application/json",
  };
  let res: Response;
  try {
    res = await fetch(`/api/forecast/upload-own-stocks?${sp.toString()}`, {
      method: "POST",
      headers,
      body: file,
    });
  } catch (err) {
    throw humanFetchError(err);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `Ответ сервера не JSON (код ${res.status}). Проверьте URL и что поднят forecast UI.`,
    );
  }
  if (!res.ok) {
    const d = data as { error?: string } | null;
    const msg =
      (d && typeof d.error === "string" && d.error) ||
      (res.status === 401
        ? "Сервер отклонил загрузку (401). Проверьте настройки доступа к forecast UI."
        : res.statusText || "Ошибка загрузки");
    throw new ForecastApiError(msg, res.status);
  }
  return data as UploadOwnStocksResponse;
}

function contentTypeForOwnStocksFile(filename: string): string {
  if (/\.xlsx$/iu.test(filename)) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (/\.xls$/iu.test(filename)) return "application/vnd.ms-excel";
  return "text/csv; charset=utf-8";
}

export interface RecalculateBody {
  snapshotDate?: string;
  horizons?: number[];
  dryRun?: boolean;
  refreshOwnStock?: boolean;
}

export interface RecalculateResponse {
  ok: true;
  result: {
    ownStockImport?: {
      snapshotDate: string;
      warehouseCode: string;
      inserted: number;
      skipped: number;
      filteredOut: number;
    } | null;
    ownStockImportError?: string | null;
  };
}

export async function postForecastRecalculate(
  body: RecalculateBody,
): Promise<RecalculateResponse> {
  return apiJson<RecalculateResponse>("/api/forecast/recalculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
