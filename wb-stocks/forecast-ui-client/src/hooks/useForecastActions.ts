import { useCallback, useState } from "preact/hooks";
import {
  downloadForecastFile,
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

function fallbackWbXlsxName(snapshotDate: string, horizonDays: string): string {
  return `wb-replenishment-${snapshotDate}-h${horizonDays}.xlsx`;
}

function fallbackSupplierXlsxName(
  snapshotDate: string,
  horizonDays: string,
): string {
  return `supplier-replenishment-${snapshotDate}-h${horizonDays}.xlsx`;
}

interface UseForecastActionsParams {
  form: ForecastUrlFormState;
  reload: (form: ForecastUrlFormState) => Promise<LoadResult>;
  clearQDebounce: () => void;
  setStatusLine: (s: string) => void;
  setStatusTone: (t: "default" | "error") => void;
}

export function useForecastActions(params: UseForecastActionsParams) {
  const { form, reload, clearQDebounce, setStatusLine, setStatusTone } = params;

  const [actionBusy, setActionBusy] = useState<ActionBusy>(null);

  const runRecalculate = useCallback(async () => {
    setActionBusy("recalculate");
    setStatusTone("default");
    setStatusLine("Пересчёт…");
    try {
      const h = Number(form.horizonDays);
      clearQDebounce();
      const recalc = await postForecastRecalculate({
        horizons: [Number.isFinite(h) && h > 0 ? h : 30],
        dryRun: false,
      });
      const r = await reload(form);
      if (r.ok && !isStale(r)) {
        syncUrlReplace(form);
        const own = recalc.result.ownStockImport;
        const ownError = recalc.result.ownStockImportError;
        if (ownError) {
          setStatusTone("error");
          setStatusLine(
            `Пересчёт выполнен, склад OptiCore не обновился: ${ownError}`,
          );
        } else if (own) {
          setStatusTone("default");
          setStatusLine(
            `Пересчёт выполнен · склад ${own.warehouseCode}: ${own.inserted} строк ` +
              `(пропущено ${own.skipped}, отфильтровано ${own.filteredOut}).`,
          );
        }
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
  }, [form, reload, clearQDebounce, setStatusLine, setStatusTone]);

  const runExportWb = useCallback(async () => {
    setActionBusy("export-wb");
    clearQDebounce();
    setStatusTone("default");
    setStatusLine("Экспорт WB Excel…");
    try {
      const p = toSummaryRowsSearchParams(form).toString();
      await downloadForecastFile(
        `/api/forecast/export-wb?${p}`,
        fallbackWbXlsxName("latest", form.horizonDays),
      );
      setStatusTone("default");
      setStatusLine("Excel скачан (WB).");
    } catch (e) {
      setStatusTone("error");
      setStatusLine("Ошибка: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setActionBusy(null);
    }
  }, [form, clearQDebounce, setStatusLine, setStatusTone]);

  const runExportSupplier = useCallback(async () => {
    setActionBusy("export-supplier");
    clearQDebounce();
    setStatusTone("default");
    setStatusLine("Экспорт Supplier Excel…");
    try {
      const p = toSupplierSearchParams(form).toString();
      await downloadForecastFile(
        `/api/forecast/export-supplier?${p}`,
        fallbackSupplierXlsxName("latest", form.horizonDays),
      );
      setStatusTone("default");
      setStatusLine("Excel скачан (supplier).");
    } catch (e) {
      setStatusTone("error");
      setStatusLine("Ошибка: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setActionBusy(null);
    }
  }, [form, clearQDebounce, setStatusLine, setStatusTone]);

  const runUploadOwnStocks = useCallback(
    async (file: File) => {
      setActionBusy("upload-own-stocks");
      setStatusTone("default");
      setStatusLine(`Загрузка остатков из «${file.name}»…`);
      try {
        const warehouse = form.ownWarehouseCode.trim();
        const result = await uploadOwnStocksCsv(file, {
          warehouse: warehouse ? warehouse : undefined,
        });
        const det = result.detection;
        const cols = [
          det.vendorColumn ? `vendor=«${det.vendorColumn}»` : null,
          det.wbColumn ? `WB=«${det.wbColumn}»` : null,
          det.quantityColumn ? `остаток=«${det.quantityColumn}»` : null,
          det.unitColumn ? `ед.=«${det.unitColumn}»` : null,
        ]
          .filter(Boolean)
          .join(", ");
        const summary =
          `Остатки загружены: ${result.inserted} строк ` +
          `(пропущено ${result.skipped}, отфильтровано ${result.filteredOut}, ${
            result.wasUpdate ? "обновлено" : "создано"
          } за ${result.snapshotDate}` +
          `${cols ? `; колонки: ${cols}` : ""}).`;
        setStatusTone("default");
        setStatusLine(summary);
        const r = await reload(form);
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
    [form, reload, setStatusLine, setStatusTone],
  );

  return {
    actionBusy,
    runRecalculate,
    runExportWb,
    runExportSupplier,
    runUploadOwnStocks,
  };
}
