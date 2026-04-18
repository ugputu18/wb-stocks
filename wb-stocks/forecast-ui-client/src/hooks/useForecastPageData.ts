import { useCallback, useReducer, useRef, useState } from "preact/hooks";
import {
  fetchForecastRows,
  fetchForecastSummary,
  fetchSupplierReplenishment,
  fetchWarehouseKeys,
  ForecastApiError,
} from "../api/client.js";
import {
  toSummaryRowsSearchParams,
  toRowsSearchParams,
  toSupplierSearchParams,
  toWarehouseKeysSearchParams,
  type ForecastUrlFormState,
} from "../state/urlState.js";
import {
  forecastPageDataReducer,
  initialForecastPageDataState,
} from "../state/forecastPageState.js";
import { formatLoadOkMessage, type LoadResult } from "../utils/forecastLoadMessage.js";

export interface UseForecastPageDataOptions {
  /** Вызывается после успешного применения ответа (сброс selection в App). */
  onLoadSuccess?: () => void;
}

export function useForecastPageData(options: UseForecastPageDataOptions = {}) {
  const { onLoadSuccess } = options;
  const [state, dispatch] = useReducer(
    forecastPageDataReducer,
    undefined,
    initialForecastPageDataState,
  );
  const [statusLine, setStatusLine] = useState("");
  const [statusTone, setStatusTone] = useState<"default" | "error">("default");

  const loadSeqRef = useRef(0);

  const loadAll = useCallback(
    async (form: ForecastUrlFormState, token: string): Promise<LoadResult> => {
      const seq = ++loadSeqRef.current;
      dispatch({ type: "loadStart" });
      setStatusTone("default");
      setStatusLine("Загрузка…");
      try {
        const wkSp = toWarehouseKeysSearchParams(form);
        const sumSp = toSummaryRowsSearchParams(form);
        const rowSp = toRowsSearchParams(form);
        const supSp = toSupplierSearchParams(form);

        const [summary, rows, supplier, wh] = await Promise.all([
          fetchForecastSummary(sumSp, token),
          fetchForecastRows(rowSp, token),
          fetchSupplierReplenishment(supSp, token),
          fetchWarehouseKeys(wkSp, token),
        ]);

        if (seq !== loadSeqRef.current) {
          return { ok: false, stale: true };
        }

        dispatch({
          type: "loadOk",
          summary,
          rows,
          supplier,
          warehouseKeys: wh.warehouseKeys ?? [],
        });
        onLoadSuccess?.();

        const list = Array.isArray(rows.rows) ? rows.rows : [];
        const shown = list.length;
        const total = summary.totalRows ?? 0;
        const limit = rows.limit ?? shown;
        const supRows = Array.isArray(supplier.rows) ? supplier.rows.length : 0;
        setStatusTone("default");
        setStatusLine(formatLoadOkMessage(shown, total, limit, supRows));

        return { ok: true };
      } catch (e) {
        const msg =
          e instanceof ForecastApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : String(e);
        if (seq !== loadSeqRef.current) {
          return { ok: false, stale: true };
        }
        dispatch({ type: "loadErr", message: msg });
        setStatusTone("error");
        setStatusLine("Ошибка: " + msg);
        return { ok: false, message: msg };
      }
    },
    [onLoadSuccess],
  );

  return {
    summary: state.summary,
    rows: state.rows,
    supplier: state.supplier,
    warehouseKeys: state.warehouseKeys,
    loadStatus: state.loadStatus,
    errorMessage: state.errorMessage,
    statusLine,
    setStatusLine,
    statusTone,
    setStatusTone,
    loadAll,
  };
}
