import { useEffect, useMemo, useState } from "preact/hooks";
import { fetchForecastRows, ForecastApiError } from "../../api/client.js";
import type { ForecastUrlFormState } from "../../state/urlState.js";
import { toDonorWarehouseRowsParams } from "../../state/urlState.js";
import {
  computeDonorWarehouseSummary,
  type DonorWarehouseSummary,
} from "../../utils/donorWarehouseSummary.js";
import {
  buildDonorSkuTableRows,
  type DonorSkuTableRow,
} from "../../utils/donorSkuTableRows.js";

export function useRedistributionDonorSummary(
  form: ForecastUrlFormState,
  apiToken: string,
  donorKey: string,
  reserveDays: number,
  minTransferable: number,
  reserveOk: boolean,
  minOk: boolean,
): {
  donorSummary: DonorWarehouseSummary | null;
  donorSummaryLoading: boolean;
  donorSummaryError: string | null;
  donorRowsRaw: unknown[] | null;
  donorSkuTableRows: DonorSkuTableRow[];
} {
  const [donorSummary, setDonorSummary] = useState<DonorWarehouseSummary | null>(null);
  const [donorSummaryLoading, setDonorSummaryLoading] = useState(false);
  const [donorSummaryError, setDonorSummaryError] = useState<string | null>(null);
  const [donorRowsRaw, setDonorRowsRaw] = useState<unknown[] | null>(null);

  useEffect(() => {
    if (!donorKey.trim()) {
      setDonorSummary(null);
      setDonorSummaryError(null);
      setDonorSummaryLoading(false);
      setDonorRowsRaw(null);
      return;
    }
    if (!reserveOk || !minOk) {
      setDonorSummary(null);
      setDonorSummaryError(null);
      setDonorRowsRaw(null);
      return;
    }
    let cancelled = false;
    setDonorSummaryLoading(true);
    setDonorSummaryError(null);
    setDonorRowsRaw(null);
    (async () => {
      try {
        const sp = toDonorWarehouseRowsParams(form, donorKey);
        const res = await fetchForecastRows(sp, apiToken);
        if (cancelled) return;
        const rows = Array.isArray(res.rows) ? res.rows : [];
        setDonorRowsRaw(rows);
        const sum = computeDonorWarehouseSummary(rows, donorKey, reserveDays, minTransferable);
        setDonorSummary(sum);
      } catch (e) {
        if (!cancelled) {
          setDonorSummary(null);
          setDonorRowsRaw(null);
          setDonorSummaryError(
            e instanceof ForecastApiError
              ? e.message
              : e instanceof Error
                ? e.message
                : String(e),
          );
        }
      } finally {
        if (!cancelled) setDonorSummaryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form, apiToken, donorKey, reserveDays, minTransferable, reserveOk, minOk]);

  const donorSkuTableRows = useMemo((): DonorSkuTableRow[] => {
    if (!donorRowsRaw || !donorKey.trim()) return [];
    return buildDonorSkuTableRows(donorRowsRaw, donorKey, reserveDays);
  }, [donorRowsRaw, donorKey, reserveDays]);

  return {
    donorSummary,
    donorSummaryLoading,
    donorSummaryError,
    donorRowsRaw,
    donorSkuTableRows,
  };
}
