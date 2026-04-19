import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  fetchForecastRows,
  fetchRegionalDemand,
  ForecastApiError,
} from "../../api/client.js";
import type { ForecastUrlFormState } from "../../state/urlState.js";
import { toDonorWarehouseRowsParams, toWarehouseRowsForSkuParams } from "../../state/urlState.js";
import { buildRegionalDemandByMacroBySku } from "../../utils/regionalDemandByMacro.js";
import { runConcurrency } from "../../utils/runConcurrency.js";
import {
  computeDonorMacroRegionRecommendations,
  computeDonorWarehouseRecommendations,
  pickTopSurplusSkus,
  type RankingMode,
  type RedistributionRow,
} from "../../utils/wbRedistributionDonorModel.js";
import type { LastRedistributionRun } from "./redistributionTypes.js";

type Params = {
  form: ForecastUrlFormState;
  apiToken: string;
  donorKey: string;
  reserveDays: number;
  minTransferable: number;
  maxSkuNetworks: number;
  reserveOk: boolean;
  minOk: boolean;
  maxSkuOk: boolean;
  rankingMode: RankingMode;
  setRankingMode: (m: RankingMode) => void;
};

export function useRedistributionRun({
  form,
  apiToken,
  donorKey,
  reserveDays,
  minTransferable,
  maxSkuNetworks,
  reserveOk,
  minOk,
  maxSkuOk,
  rankingMode,
  setRankingMode,
}: Params): {
  results: RedistributionRow[];
  loading: boolean;
  error: string | null;
  meta: { donorRowsLoaded: number; skuNetworksFetched: number } | null;
  resultNote: string | null;
  runSearch: () => Promise<void>;
} {
  const [results, setResults] = useState<RedistributionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{
    donorRowsLoaded: number;
    skuNetworksFetched: number;
  } | null>(null);
  const [resultNote, setResultNote] = useState<string | null>(null);

  const lastRunRef = useRef<LastRedistributionRun | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (rankingMode === "regional") {
      url.searchParams.delete("rankingMode");
    } else {
      url.searchParams.set("rankingMode", "fulfillment");
    }
    window.history.replaceState(null, "", url.toString());
  }, [rankingMode]);

  useEffect(() => {
    const L = lastRunRef.current;
    if (!L) return;
    let cancelled = false;
    (async () => {
      let regional = L.regionalByMacroBySku;
      if (rankingMode === "regional" && !regional) {
        const top = pickTopSurplusSkus(
          L.donorRows,
          L.donorKey,
          L.donorReserveDays,
          L.minTransferableUnits,
          L.maxSkuNetworks,
        );
        try {
          const rd = await fetchRegionalDemand(
            {
              snapshotDate: L.snapshotDate,
              skus: top.map((s) => ({ nmId: s.nmId, techSize: s.techSize })),
            },
            apiToken,
          );
          if (cancelled) return;
          const rows = (rd.rows ?? []).map((r) => ({
            regionKey: r.regionKey,
            nmId: r.nmId,
            techSize: r.techSize,
            regionalForecastDailyDemand: r.regionalForecastDailyDemand,
          }));
          regional = buildRegionalDemandByMacroBySku(rows, rd.regionMacroMap ?? {});
          L.regionalByMacroBySku = regional;
        } catch {
          if (!cancelled) {
            setError(
              "Не удалось загрузить региональный снимок для ranking (POST /api/forecast/regional-demand). Режим возвращён на Fulfillment.",
            );
            setRankingMode("fulfillment");
          }
          return;
        }
      }
      if (cancelled) return;
      if (rankingMode === "regional" && regional) {
        setResults(
          computeDonorMacroRegionRecommendations(
            L.donorRows,
            L.networkBySku,
            L.donorKey,
            L.donorReserveDays,
            L.minTransferableUnits,
            regional,
            L.targetCoverageDays,
          ),
        );
      } else {
        setResults(
          computeDonorWarehouseRecommendations(
            L.donorRows,
            L.networkBySku,
            L.donorKey,
            L.donorReserveDays,
            L.minTransferableUnits,
          ),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rankingMode, apiToken, setRankingMode]);

  const runSearch = useCallback(async () => {
    setError(null);
    setResults([]);
    setMeta(null);
    setResultNote(null);
    if (!donorKey.trim()) {
      setError("Выберите склад-донор.");
      return;
    }
    if (!reserveOk || !minOk || !maxSkuOk) {
      setError("Проверьте числовые параметры (резерв, мин. шт., лимит SKU).");
      return;
    }
    setLoading(true);
    try {
      const sp = toDonorWarehouseRowsParams(form, donorKey);
      const donorRes = await fetchForecastRows(sp, apiToken);
      const donorRows = Array.isArray(donorRes.rows) ? donorRes.rows : [];
      if (donorRows.length === 0) {
        setError("Нет строк на выбранном складе — проверьте дату среза и лимит.");
        setLoading(false);
        return;
      }

      const top = pickTopSurplusSkus(
        donorRows,
        donorKey,
        reserveDays,
        minTransferable,
        Math.floor(maxSkuNetworks),
      );

      if (top.length === 0) {
        setResults([]);
        setMeta({
          donorRowsLoaded: donorRows.length,
          skuNetworksFetched: 0,
        });
        setResultNote(
          "Нет SKU с излишком после резерва при текущих параметрах. Попробуйте уменьшить «Резерв донора (дней)», снизить «Мин. передаваемых шт.» или проверьте, что localAvailable на доноре покрывает резерв (спрос/день × дни резерва).",
        );
        return;
      }

      const networkBySku = new Map<string, unknown[]>();
      await runConcurrency(top, 5, async (s) => {
        const spSku = toWarehouseRowsForSkuParams(form, String(s.nmId), s.techSize);
        const res = await fetchForecastRows(spSku, apiToken);
        const rows = Array.isArray(res.rows) ? res.rows : [];
        networkBySku.set(`${s.nmId}|${s.techSize}`, rows);
      });

      setMeta({
        donorRowsLoaded: donorRows.length,
        skuNetworksFetched: top.length,
      });

      let effectiveRankingMode: RankingMode = rankingMode;
      let regionalByMacroBySku: Map<string, Map<string, number>> | null = null;
      if (rankingMode === "regional") {
        try {
          const rd = await fetchRegionalDemand(
            {
              snapshotDate: form.snapshotDate,
              skus: top.map((s) => ({ nmId: s.nmId, techSize: s.techSize })),
            },
            apiToken,
          );
          const rows = (rd.rows ?? []).map((r) => ({
            regionKey: r.regionKey,
            nmId: r.nmId,
            techSize: r.techSize,
            regionalForecastDailyDemand: r.regionalForecastDailyDemand,
          }));
          regionalByMacroBySku = buildRegionalDemandByMacroBySku(rows, rd.regionMacroMap ?? {});
        } catch {
          effectiveRankingMode = "fulfillment";
          setRankingMode("fulfillment");
        }
      }

      const regionalFetchFailed = rankingMode === "regional" && effectiveRankingMode === "fulfillment";

      lastRunRef.current = {
        donorKey: donorKey.trim(),
        snapshotDate: form.snapshotDate,
        donorReserveDays: reserveDays,
        targetCoverageDays: Number(form.targetCoverageDays),
        minTransferableUnits: minTransferable,
        maxSkuNetworks: Math.floor(maxSkuNetworks),
        donorRows,
        networkBySku,
        regionalByMacroBySku:
          effectiveRankingMode === "regional" ? regionalByMacroBySku : null,
      };

      let recs: RedistributionRow[];
      if (effectiveRankingMode === "regional" && regionalByMacroBySku) {
        recs = computeDonorMacroRegionRecommendations(
          donorRows,
          networkBySku,
          donorKey,
          reserveDays,
          minTransferable,
          regionalByMacroBySku,
          Number(form.targetCoverageDays),
        );
      } else {
        recs = computeDonorWarehouseRecommendations(
          donorRows,
          networkBySku,
          donorKey,
          reserveDays,
          minTransferable,
        );
      }
      setResults(recs);
      if (recs.length === 0) {
        const emptyMsg =
          effectiveRankingMode === "regional"
            ? "Расчёт выполнен, но нет направлений: нет регионов с дефицитом до целевого покрытия (с учётом Σ local в регионе), цель совпадает с регионом донора, либо излишек донора меньше минимума после нехватки."
            : "Расчёт выполнен, но нет направлений: у других складов нет recommendedToWB > 0 для этих SKU, либо min(передача, на WB) обнулилось. Проверьте targetCoverageDays и срез.";
        setResultNote(
          regionalFetchFailed
            ? `Региональный снимок не загрузился — ranking на Fulfillment. ${emptyMsg}`
            : emptyMsg,
        );
      } else if (regionalFetchFailed) {
        setResultNote(
          "Региональный снимок не загрузился (POST /api/forecast/regional-demand). Ranking пересчитан на Fulfillment.",
        );
      }
    } catch (e) {
      const msg =
        e instanceof ForecastApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [
    form,
    apiToken,
    donorKey,
    reserveDays,
    minTransferable,
    maxSkuNetworks,
    reserveOk,
    minOk,
    maxSkuOk,
    rankingMode,
    setRankingMode,
  ]);

  return {
    results,
    loading,
    error,
    meta,
    resultNote,
    runSearch,
  };
}
