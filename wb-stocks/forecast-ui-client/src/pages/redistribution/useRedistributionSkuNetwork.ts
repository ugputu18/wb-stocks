import type { RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { fetchForecastRows, ForecastApiError } from "../../api/client.js";
import type { ForecastUrlFormState } from "../../state/urlState.js";
import { toWarehouseRowsForSkuParams } from "../../state/urlState.js";
import {
  parseWbWarehouseNetworkRows,
  sortNetworkRowsForDisplay,
  type WbWarehouseNetworkRow,
} from "../../utils/wbWarehouseNetworkRow.js";
import type { SkuNetworkSelection } from "./redistributionTypes.js";

export function useRedistributionSkuNetwork(
  form: ForecastUrlFormState,
  apiToken: string,
  donorKey: string,
): {
  skuNetworkSelection: SkuNetworkSelection | null;
  setSkuNetworkSelection: (v: SkuNetworkSelection | null) => void;
  skuNetworkRows: WbWarehouseNetworkRow[] | null;
  skuNetworkLoading: boolean;
  skuNetworkError: string | null;
  skuNetworkPanelRef: RefObject<HTMLDivElement>;
} {
  const [skuNetworkSelection, setSkuNetworkSelection] = useState<SkuNetworkSelection | null>(null);
  const [skuNetworkRows, setSkuNetworkRows] = useState<WbWarehouseNetworkRow[] | null>(null);
  const [skuNetworkLoading, setSkuNetworkLoading] = useState(false);
  const [skuNetworkError, setSkuNetworkError] = useState<string | null>(null);

  const skuNetworkCacheRef = useRef(new Map<string, unknown[]>());
  const skuNetworkPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    skuNetworkCacheRef.current.clear();
  }, [form.snapshotDate, form.horizonDays, form.targetCoverageDays, form.rowLimit]);

  useEffect(() => {
    setSkuNetworkSelection(null);
    setSkuNetworkRows(null);
    setSkuNetworkError(null);
  }, [donorKey]);

  useEffect(() => {
    if (!skuNetworkSelection) {
      setSkuNetworkRows(null);
      setSkuNetworkLoading(false);
      setSkuNetworkError(null);
      return;
    }
    const cacheKey = `${skuNetworkSelection.nmId}|${skuNetworkSelection.techSize}`;
    const cached = skuNetworkCacheRef.current.get(cacheKey);
    if (cached) {
      const parsed = parseWbWarehouseNetworkRows(cached);
      setSkuNetworkRows(
        sortNetworkRowsForDisplay(parsed, donorKey, skuNetworkSelection.targetWarehouseKey),
      );
      setSkuNetworkLoading(false);
      setSkuNetworkError(null);
      return;
    }
    let cancelled = false;
    setSkuNetworkLoading(true);
    setSkuNetworkError(null);
    setSkuNetworkRows(null);
    (async () => {
      try {
        const sp = toWarehouseRowsForSkuParams(
          form,
          String(skuNetworkSelection.nmId),
          skuNetworkSelection.techSize,
        );
        const res = await fetchForecastRows(sp, apiToken);
        if (cancelled) return;
        const rawRows = Array.isArray(res.rows) ? res.rows : [];
        skuNetworkCacheRef.current.set(cacheKey, rawRows);
        const parsed = parseWbWarehouseNetworkRows(rawRows);
        setSkuNetworkRows(
          sortNetworkRowsForDisplay(parsed, donorKey, skuNetworkSelection.targetWarehouseKey),
        );
      } catch (e) {
        if (!cancelled) {
          setSkuNetworkRows(null);
          setSkuNetworkError(
            e instanceof ForecastApiError
              ? e.message
              : e instanceof Error
                ? e.message
                : String(e),
          );
        }
      } finally {
        if (!cancelled) setSkuNetworkLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [skuNetworkSelection, form, apiToken, donorKey]);

  useLayoutEffect(() => {
    if (!skuNetworkSelection || !skuNetworkPanelRef.current) return;
    skuNetworkPanelRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [skuNetworkSelection]);

  return {
    skuNetworkSelection,
    setSkuNetworkSelection,
    skuNetworkRows,
    skuNetworkLoading,
    skuNetworkError,
    skuNetworkPanelRef,
  };
}
