import { useCallback, useState } from "preact/hooks";
import {
  downloadForecastCsv,
  postForecastRecalculate,
  uploadOwnStocksCsv,
} from "../api/client.js";
import {
  toSummaryRowsSearchParams,
  toSupplierSearchParams,
  type ForecastUrlFormState,
} from "../state/urlState.js";
import { isStale, type LoadResult } from "../utils/forecastLoadMessage.js";
import { syncUrlReplace } from "../utils/forecastUrlSync.js";

export type ActionBusy =
  | null
  | "recalculate"
  | "export-wb"
  | "export-supplier"
  | "upload-own-stocks";

function fallbackWbCsvName(snapshotDate: string, horizonDays: string): string {
  return `wb-replenishment-${snapshotDate}-h${horizonDays}.csv`;
}

function fallbackSupplierCsvName(snapshotDate: string, horizonDays: string): string {
  return `supplier-replenishment-${snapshotDate}-h${horizonDays}.csv`;
}

interface UseForecastActionsParams {
  form: ForecastUrlFormState;
  apiToken: string;
  reload: (form: ForecastUrlFormState, token: string) => Promise<LoadResult>;
  clearQDebounce: () => void;
  setStatusLine: (s: string) => void;
  setStatusTone: (t: "default" | "error") => void;
}

export function useForecastActions(params: UseForecastActionsParams) {
  const { form, apiToken, reload, clearQDebounce, setStatusLine, setStatusTone } =
    params;

  const [actionBusy, setActionBusy] = useState<ActionBusy>(null);

  const runRecalculate = useCallback(async () => {
    setActionBusy("recalculate");
    setStatusTone("default");
    setStatusLine("Пересчёт…");
    try {
      const h = Number(form.horizonDays);
      clearQDebounce();
      await postForecastRecalculate(
        {
          snapshotDate: form.snapshotDate,
          horizons: [Number.isFinite(h) && h > 0 ? h : 30],
          dryRun: false,
        },
        apiToken,
      );
      const r = await reload(form, apiToken);
      if (r.ok && !isStale(r)) {
        syncUrlReplace(form);
      } else if (!r.ok && !isStale(r) && "message" in r) {
        setStatusTone("error");
        setStatusLine("Пересчёт: " + r.message);
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setStatusTone("error");
      setStatusLine("Пересчёт: " + m);
    } finally {
      setActionBusy(null);
    }
  }, [form, apiToken, reload, clearQDebounce, setStatusLine, setStatusTone]);

  const runExportWb = useCallback(async () => {
    setActionBusy("export-wb");
    clearQDebounce();
    setStatusTone("default");
    setStatusLine("Экспорт WB CSV…");
    try {
      const p = toSummaryRowsSearchParams(form).toString();
      await downloadForecastCsv(
        `/api/forecast/export-wb?${p}`,
        apiToken,
        fallbackWbCsvName(form.snapshotDate, form.horizonDays),
      );
      setStatusTone("default");
      setStatusLine("CSV скачан (WB).");
    } catch (e) {
      setStatusTone("error");
      setStatusLine("Ошибка: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setActionBusy(null);
    }
  }, [form, apiToken, clearQDebounce, setStatusLine, setStatusTone]);

  const runExportSupplier = useCallback(async () => {
    setActionBusy("export-supplier");
    clearQDebounce();
    setStatusTone("default");
    setStatusLine("Экспорт Supplier CSV…");
    try {
      const p = toSupplierSearchParams(form).toString();
      await downloadForecastCsv(
        `/api/forecast/export-supplier?${p}`,
        apiToken,
        fallbackSupplierCsvName(form.snapshotDate, form.horizonDays),
      );
      setStatusTone("default");
      setStatusLine("CSV скачан (supplier).");
    } catch (e) {
      setStatusTone("error");
      setStatusLine("Ошибка: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setActionBusy(null);
    }
  }, [form, apiToken, clearQDebounce, setStatusLine, setStatusTone]);

  const runUploadOwnStocks = useCallback(
    async (file: File) => {
      setActionBusy("upload-own-stocks");
      setStatusTone("default");
      setStatusLine(`Загрузка остатков из «${file.name}»…`);
      try {
        const warehouse = form.ownWarehouseCode.trim();
        const result = await uploadOwnStocksCsv(
          file,
          {
            date: form.snapshotDate,
            warehouse: warehouse ? warehouse : undefined,
          },
          apiToken,
        );
        const det = result.detection;
        const cols = [
          det.vendorColumn ? `vendor=«${det.vendorColumn}»` : null,
          det.wbColumn ? `WB=«${det.wbColumn}»` : null,
          det.quantityColumn ? `остаток=«${det.quantityColumn}»` : null,
        ]
          .filter(Boolean)
          .join(", ");
        const summary =
          `Остатки загружены: ${result.inserted} строк ` +
          `(пропущено ${result.skipped}, ${
            result.wasUpdate ? "обновлено" : "создано"
          } за ${result.snapshotDate}` +
          `${cols ? `; колонки: ${cols}` : ""}).`;
        setStatusTone("default");
        setStatusLine(summary);
        const r = await reload(form, apiToken);
        if (!r.ok && !isStale(r) && "message" in r) {
          setStatusTone("error");
          setStatusLine("Загрузка остатков: " + r.message);
        }
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        setStatusTone("error");
        setStatusLine("Загрузка остатков: " + m);
      } finally {
        setActionBusy(null);
      }
    },
    [form, apiToken, reload, setStatusLine, setStatusTone],
  );

  return {
    actionBusy,
    runRecalculate,
    runExportWb,
    runExportSupplier,
    runUploadOwnStocks,
  };
}
