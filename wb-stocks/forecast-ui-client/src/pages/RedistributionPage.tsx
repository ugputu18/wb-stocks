import type { JSX } from "preact";
import { useCallback, useMemo, useState } from "preact/hooks";
import { FORECAST_UI_SPA_ROUTES } from "../routes.js";
import {
  defaultFormState,
  formStateFromSearchParams,
  type ForecastUrlFormState,
} from "../state/urlState.js";
import { formatInt } from "../utils/forecastFormat.js";
import {
  formatWarehouseRegionFirst,
} from "../utils/wbWarehouseRegion.js";
import type { DonorSkuTableRow } from "../utils/donorSkuTableRows.js";
import type { RedistributionRow } from "../utils/wbRedistributionDonorModel.js";
import "./redistribution/redistribution-page.css";
import { RedistributionControlsSection } from "./redistribution/RedistributionControlsSection.js";
import { RedistributionDonorSkuTableSection } from "./redistribution/RedistributionDonorSkuTableSection.js";
import { RedistributionDonorSummarySection } from "./redistribution/RedistributionDonorSummarySection.js";
import { RedistributionMvpLimitsSection } from "./redistribution/RedistributionMvpLimitsSection.js";
import { RedistributionResultsSection } from "./redistribution/RedistributionResultsSection.js";
import { RedistributionSkuNetworkSection } from "./redistribution/RedistributionSkuNetworkSection.js";
import { readRankingModeFromUrl } from "./redistribution/redistributionTypes.js";
import { useRedistributionDonorSummary } from "./redistribution/useRedistributionDonorSummary.js";
import { useRedistributionRun } from "./redistribution/useRedistributionRun.js";
import { useRedistributionSkuNetwork } from "./redistribution/useRedistributionSkuNetwork.js";
import { useRedistributionWarehouses } from "./redistribution/useRedistributionWarehouses.js";

function initForm(): ForecastUrlFormState {
  if (typeof window === "undefined") return defaultFormState();
  return formStateFromSearchParams(new URLSearchParams(window.location.search));
}

export function RedistributionPage(): JSX.Element {
  const [form, setForm] = useState<ForecastUrlFormState>(initForm);
  const [apiToken, setApiToken] = useState("");
  const [donorKey, setDonorKey] = useState("");
  const [reserveDaysStr, setReserveDaysStr] = useState("14");
  const [minTransferableStr, setMinTransferableStr] = useState("1");
  const [maxSkuNetworksStr, setMaxSkuNetworksStr] = useState("100");
  const [rankingMode, setRankingMode] = useState(readRankingModeFromUrl);

  const reserveDays = Number(reserveDaysStr);
  const minTransferable = Number(minTransferableStr);
  const maxSkuNetworks = Number(maxSkuNetworksStr);

  const reserveOk = Number.isFinite(reserveDays) && reserveDays >= 0;
  const minOk = Number.isFinite(minTransferable) && minTransferable >= 0;
  const maxSkuOk = Number.isFinite(maxSkuNetworks) && maxSkuNetworks >= 1;

  const {
    warehouseKeys,
    warehouseStats,
    statsLoading,
    loadWarehouseStats,
    refreshFromWb,
    refreshFromWbLoading,
    refreshFromWbError,
    donorSelectKeys,
    warehouseStatsAgeLabel,
  } = useRedistributionWarehouses(form, apiToken, donorKey, setDonorKey);

  const {
    results,
    loading,
    error,
    meta,
    resultNote,
    runSearch,
  } = useRedistributionRun({
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
  });

  const {
    donorSummary,
    donorSummaryLoading,
    donorSummaryError,
    donorRowsRaw,
    donorSkuTableRows,
  } = useRedistributionDonorSummary(
    form,
    apiToken,
    donorKey,
    reserveDays,
    minTransferable,
    reserveOk,
    minOk,
  );

  const {
    skuNetworkSelection,
    setSkuNetworkSelection,
    skuNetworkRows,
    skuNetworkLoading,
    skuNetworkError,
    skuNetworkPanelRef,
  } = useRedistributionSkuNetwork(form, apiToken, donorKey);

  const donorLabel = useMemo(() => {
    if (!donorKey) return "";
    const s = warehouseStats.get(donorKey);
    if (s) {
      return `${formatWarehouseRegionFirst(s.displayName, donorKey)} · Σ ${formatInt(s.totalLocal)} · ${s.skuCount} SKU`;
    }
    return formatWarehouseRegionFirst(donorKey, donorKey);
  }, [donorKey, warehouseStats]);

  const patch = (p: Partial<ForecastUrlFormState>) => {
    setForm((f) => ({ ...f, ...p }));
  };

  const openSkuRow = useCallback((r: RedistributionRow) => {
    if (r.kind === "macro") {
      setSkuNetworkSelection({
        nmId: r.nmId,
        techSize: r.techSize,
        vendorCode: r.vendorCode,
        targetWarehouseKey: r.preferredWarehouseKey ?? "",
        targetMacroRegion: r.targetMacroRegion,
        rowKey: `${r.nmId}-${r.techSize}-macro-${r.targetMacroRegion}-${r.priorityRank}`,
      });
    } else {
      setSkuNetworkSelection({
        nmId: r.nmId,
        techSize: r.techSize,
        vendorCode: r.vendorCode,
        targetWarehouseKey: r.targetWarehouseKey,
        targetMacroRegion: null,
        rowKey: `${r.nmId}-${r.techSize}-${r.targetWarehouseKey}-${r.priorityRank}`,
      });
    }
  }, [setSkuNetworkSelection]);

  const openSkuFromDonorTable = useCallback(
    (row: DonorSkuTableRow) => {
      const firstRec = results.find((r) => r.nmId === row.nmId && r.techSize === row.techSize);
      if (firstRec?.kind === "macro") {
        setSkuNetworkSelection({
          nmId: row.nmId,
          techSize: row.techSize,
          vendorCode: row.vendorCode,
          targetWarehouseKey: firstRec.preferredWarehouseKey ?? "",
          targetMacroRegion: firstRec.targetMacroRegion,
          rowKey: `${firstRec.nmId}-${firstRec.techSize}-macro-${firstRec.targetMacroRegion}-${firstRec.priorityRank}`,
        });
      } else if (firstRec?.kind === "warehouse") {
        setSkuNetworkSelection({
          nmId: row.nmId,
          techSize: row.techSize,
          vendorCode: row.vendorCode,
          targetWarehouseKey: firstRec.targetWarehouseKey,
          targetMacroRegion: null,
          rowKey: `${firstRec.nmId}-${firstRec.techSize}-${firstRec.targetWarehouseKey}-${firstRec.priorityRank}`,
        });
      } else {
        setSkuNetworkSelection({
          nmId: row.nmId,
          techSize: row.techSize,
          vendorCode: row.vendorCode,
          targetWarehouseKey: "",
          targetMacroRegion: null,
          rowKey: `donor-${row.nmId}-${row.techSize}`,
        });
      }
    },
    [results, setSkuNetworkSelection],
  );

  return (
    <div class="forecast-next-root redistribution-page">
      <header class="top">
        <h1>Перемещение между складами WB</h1>
        <p class="muted">
          <a href={FORECAST_UI_SPA_ROUTES.home}>← К прогнозу</a>
          {" · "}
          <a href={FORECAST_UI_SPA_ROUTES.warehouseRegionAudit}>Аудит маппинга складов → регион</a>
          {" · "}
          <a href={FORECAST_UI_SPA_ROUTES.regionalDemandDiagnostics}>Регион vs fulfillment</a>
          {" · "}
          <strong>Regional</strong> (по умолчанию) — цель перераспределения = <strong>регион</strong>{" "}
          (Σ buyer-region demand); склад внутри региона — операционная деталь.{" "}
          <strong>Fulfillment</strong> — цель = <strong>склад исполнения</strong>. Донор всегда
          складовой; эвристика, не оптимизация и не запись в БД.
        </p>
      </header>

      <RedistributionControlsSection
        form={form}
        patch={patch}
        apiToken={apiToken}
        setApiToken={setApiToken}
        donorKey={donorKey}
        setDonorKey={setDonorKey}
        loading={loading}
        donorSelectKeys={donorSelectKeys}
        warehouseStats={warehouseStats}
        statsLoading={statsLoading}
        loadWarehouseStats={loadWarehouseStats}
        refreshFromWb={refreshFromWb}
        refreshFromWbLoading={refreshFromWbLoading}
        refreshFromWbError={refreshFromWbError}
        warehouseStatsAgeLabel={warehouseStatsAgeLabel}
        warehouseKeys={warehouseKeys}
        reserveDaysStr={reserveDaysStr}
        setReserveDaysStr={setReserveDaysStr}
        minTransferableStr={minTransferableStr}
        setMinTransferableStr={setMinTransferableStr}
        maxSkuNetworksStr={maxSkuNetworksStr}
        setMaxSkuNetworksStr={setMaxSkuNetworksStr}
        rankingMode={rankingMode}
        setRankingMode={setRankingMode}
        runSearch={runSearch}
      />

      {error ? (
        <p class="forecast-next-error" role="alert">
          {error}
        </p>
      ) : null}

      {meta ? (
        <p class="muted redistribution-meta">
          Загружено строк донора: <strong>{meta.donorRowsLoaded}</strong>, запросов сети по SKU:{" "}
          <strong>{meta.skuNetworksFetched}</strong>
          {donorLabel ? (
            <>
              {" "}
              · донор: <strong>{donorLabel}</strong>
            </>
          ) : null}
        </p>
      ) : null}

      {resultNote && !error ? (
        <p class="redistribution-result-note" role="status">
          {resultNote}
        </p>
      ) : null}

      <RedistributionResultsSection
        loading={loading}
        error={error}
        resultNote={resultNote}
        meta={meta}
        results={results}
        rankingMode={rankingMode}
        skuNetworkSelection={skuNetworkSelection}
        openSkuRow={openSkuRow}
      />

      <RedistributionSkuNetworkSection
        donorKey={donorKey}
        skuNetworkSelection={skuNetworkSelection}
        onClose={() => setSkuNetworkSelection(null)}
        skuNetworkRows={skuNetworkRows}
        skuNetworkLoading={skuNetworkLoading}
        skuNetworkError={skuNetworkError}
        skuNetworkPanelRef={skuNetworkPanelRef}
      />

      {donorKey.trim() ? (
        <>
          <RedistributionDonorSummarySection
            donorSummaryLoading={donorSummaryLoading}
            donorSummaryError={donorSummaryError}
            donorSummary={donorSummary}
          />
          <RedistributionDonorSkuTableSection
            donorSummaryLoading={donorSummaryLoading}
            donorSummaryError={donorSummaryError}
            donorRowsRaw={donorRowsRaw}
            donorSkuTableRows={donorSkuTableRows}
            skuNetworkSelection={skuNetworkSelection}
            openSkuFromDonorTable={openSkuFromDonorTable}
          />
        </>
      ) : null}

      <RedistributionMvpLimitsSection />
    </div>
  );
}

export type { WarehouseOptionStats } from "./redistribution/redistributionTypes.js";
