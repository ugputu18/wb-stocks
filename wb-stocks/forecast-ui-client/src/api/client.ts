import type {
  ForecastRowsResponse,
  ForecastSummaryResponse,
  RegionalDemandResponse,
  RegionalStocksResponse,
  RegionalVsWarehouseSummaryResponse,
  SupplierReplenishmentResponse,
  WarehouseKeysResponse,
  WarehouseRegionAuditResponse,
} from "./types.js";

export interface ApiOptions extends RequestInit {
  /** Bearer token for FORECAST_UI_TOKEN (optional). */
  bearerToken?: string;
}

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
  options: ApiOptions = {},
): Promise<T> {
  const { bearerToken, headers: optHeaders, ...rest } = options;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(optHeaders as Record<string, string> | undefined),
  };
  if (bearerToken?.trim()) {
    headers.Authorization = `Bearer ${bearerToken.trim()}`;
  }

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
          ? "Нужен заголовок авторизации: введите Bearer-токен (FORECAST_UI_TOKEN)."
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
  token?: string,
): Promise<ForecastSummaryResponse> {
  return apiJson<ForecastSummaryResponse>(
    `/api/forecast/summary${buildApiSearchParams(sp)}`,
    { bearerToken: token },
  );
}

export async function fetchForecastRows(
  sp: URLSearchParams,
  token?: string,
): Promise<ForecastRowsResponse> {
  return apiJson<ForecastRowsResponse>(
    `/api/forecast/rows${buildApiSearchParams(sp)}`,
    { bearerToken: token },
  );
}

export async function fetchSupplierReplenishment(
  sp: URLSearchParams,
  token?: string,
): Promise<SupplierReplenishmentResponse> {
  return apiJson<SupplierReplenishmentResponse>(
    `/api/forecast/supplier-replenishment${buildApiSearchParams(sp)}`,
    { bearerToken: token },
  );
}

export async function fetchWarehouseKeys(
  sp: URLSearchParams,
  token?: string,
): Promise<WarehouseKeysResponse> {
  return apiJson<WarehouseKeysResponse>(
    `/api/forecast/warehouse-keys${buildApiSearchParams(sp)}`,
    { bearerToken: token },
  );
}

export async function fetchRegionalStocks(
  sp: URLSearchParams,
  token?: string,
): Promise<RegionalStocksResponse> {
  return apiJson<RegionalStocksResponse>(
    `/api/forecast/regional-stocks${buildApiSearchParams(sp)}`,
    { bearerToken: token },
  );
}

export interface FetchRegionalDemandBody {
  snapshotDate: string;
  skus: Array<{ nmId: number; techSize: string }>;
}

export async function fetchRegionalDemand(
  body: FetchRegionalDemandBody,
  token?: string,
): Promise<RegionalDemandResponse> {
  return apiJson<RegionalDemandResponse>("/api/forecast/regional-demand", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    bearerToken: token,
  });
}

export async function fetchWarehouseRegionAudit(
  sp: URLSearchParams,
  token?: string,
): Promise<WarehouseRegionAuditResponse> {
  return apiJson<WarehouseRegionAuditResponse>(
    `/api/forecast/warehouse-region-audit${buildApiSearchParams(sp)}`,
    { bearerToken: token },
  );
}

export async function fetchRegionalVsWarehouseSummary(
  sp: URLSearchParams,
  token?: string,
): Promise<RegionalVsWarehouseSummaryResponse> {
  return apiJson<RegionalVsWarehouseSummaryResponse>(
    `/api/forecast/regional-vs-warehouse-summary${buildApiSearchParams(sp)}`,
    { bearerToken: token },
  );
}

/** Скачивание CSV с теми же правилами, что legacy `downloadCsv` (Accept, Bearer, Content-Disposition). */
export async function downloadForecastCsv(
  path: string,
  token: string | undefined,
  fallbackFilename: string,
): Promise<void> {
  const headers: Record<string, string> = {
    Accept: "text/csv,*/*",
  };
  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  let res: Response;
  try {
    res = await fetch(path, { headers });
  } catch (err) {
    throw humanFetchError(err);
  }
  let filename = fallbackFilename;
  const cd = res.headers.get("Content-Disposition");
  if (cd) {
    const m = /filename="([^"]+)"/.exec(cd);
    if (m) filename = m[1];
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
        "Нужен заголовок авторизации: введите Bearer-токен (FORECAST_UI_TOKEN).";
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

export interface RecalculateBody {
  snapshotDate: string;
  horizons: number[];
  dryRun?: boolean;
}

export async function postForecastRecalculate(
  body: RecalculateBody,
  token?: string,
): Promise<unknown> {
  return apiJson<unknown>("/api/forecast/recalculate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    bearerToken: token,
  });
}
