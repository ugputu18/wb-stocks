import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { fetchForecastRows, fetchWarehouseKeys } from "../../api/client.js";
import type { ForecastUrlFormState } from "../../state/urlState.js";
import {
  toDonorWarehouseRowsParams,
  toWarehouseKeysSearchParams,
} from "../../state/urlState.js";
import { parseWbWarehouseRow } from "../../utils/wbRedistributionModel.js";
import { runConcurrency } from "../../utils/runConcurrency.js";
import {
  formatWarehouseStatsAgeRu,
  MIN_DONOR_WAREHOUSE_LOCAL_UNITS,
} from "./redistributionConstants.js";
import type { WarehouseOptionStats } from "./redistributionTypes.js";

export function useRedistributionWarehouses(
  form: ForecastUrlFormState,
  apiToken: string,
  donorKey: string,
  setDonorKey: (v: string) => void,
): {
  warehouseKeys: string[];
  warehouseStats: Map<string, WarehouseOptionStats>;
  statsLoading: boolean;
  loadWarehouseStats: () => Promise<void>;
  donorSelectKeys: string[];
  warehouseStatsAgeLabel: string | null;
} {
  const [warehouseKeys, setWarehouseKeys] = useState<string[]>([]);
  const [warehouseStats, setWarehouseStats] = useState<Map<string, WarehouseOptionStats>>(
    () => new Map(),
  );
  const [statsLoading, setStatsLoading] = useState(false);
  const [warehouseStatsFetchedAt, setWarehouseStatsFetchedAt] = useState<number | null>(null);
  const [warehouseStatsAgeTick, setWarehouseStatsAgeTick] = useState(0);

  const donorSelectKeys = useMemo(() => {
    if (warehouseKeys.length === 0) return [];
    const haveStatsForAll =
      !statsLoading && warehouseKeys.every((k) => warehouseStats.has(k));
    if (!haveStatsForAll) return warehouseKeys;
    return warehouseKeys.filter(
      (k) => warehouseStats.get(k)!.totalLocal >= MIN_DONOR_WAREHOUSE_LOCAL_UNITS,
    );
  }, [warehouseKeys, warehouseStats, statsLoading]);

  useEffect(() => {
    if (!donorKey.trim()) return;
    if (!donorSelectKeys.includes(donorKey)) setDonorKey("");
  }, [donorKey, donorSelectKeys, setDonorKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sp = toWarehouseKeysSearchParams(form);
        const res = await fetchWarehouseKeys(sp, apiToken);
        if (cancelled) return;
        setWarehouseKeys(Array.isArray(res.warehouseKeys) ? res.warehouseKeys : []);
      } catch {
        if (!cancelled) setWarehouseKeys([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form.snapshotDate, form.horizonDays, apiToken]);

  const loadWarehouseStats = useCallback(async () => {
    if (warehouseKeys.length === 0) return;
    setStatsLoading(true);
    const next = new Map<string, WarehouseOptionStats>();
    try {
      await runConcurrency(warehouseKeys, 5, async (key) => {
        const sp = toDonorWarehouseRowsParams(form, key);
        const res = await fetchForecastRows(sp, apiToken);
        const rows = Array.isArray(res.rows) ? res.rows : [];
        let totalLocal = 0;
        let displayName = key;
        for (const r of rows) {
          const p = parseWbWarehouseRow(r);
          if (p) {
            totalLocal += p.localAvailable;
            displayName = p.warehouseNameRaw;
          }
        }
        next.set(key, {
          key,
          displayName,
          totalLocal,
          skuCount: rows.length,
        });
      });
      setWarehouseStats(next);
      setWarehouseStatsFetchedAt(Date.now());
    } catch {
      setWarehouseStats(new Map());
    } finally {
      setStatsLoading(false);
    }
  }, [form, apiToken, warehouseKeys]);

  useEffect(() => {
    if (warehouseKeys.length === 0) return;
    void loadWarehouseStats();
  }, [warehouseKeys, loadWarehouseStats]);

  useEffect(() => {
    if (warehouseKeys.length === 0) setWarehouseStatsFetchedAt(null);
  }, [warehouseKeys.length]);

  useEffect(() => {
    if (warehouseStatsFetchedAt == null) return;
    const id = window.setInterval(() => {
      setWarehouseStatsAgeTick((n) => n + 1);
    }, 60_000);
    return () => window.clearInterval(id);
  }, [warehouseStatsFetchedAt]);

  const warehouseStatsAgeLabel = useMemo(() => {
    void warehouseStatsAgeTick;
    if (warehouseStatsFetchedAt == null) return null;
    return formatWarehouseStatsAgeRu(warehouseStatsFetchedAt);
  }, [warehouseStatsFetchedAt, warehouseStatsAgeTick]);

  return {
    warehouseKeys,
    warehouseStats,
    statsLoading,
    loadWarehouseStats,
    donorSelectKeys,
    warehouseStatsAgeLabel,
  };
}
