import type { JSX } from "preact";
import { useCallback, useMemo, useState } from "preact/hooks";
import { downloadForecastFile } from "../api/client.js";
import { ForecastSystemNav } from "../components/ForecastSystemNav.js";
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

function safeFilenamePart(raw: string): string {
  return raw.trim().replace(/[\\/:*?"<>|\s]+/g, "_") || "donor";
}

export function RedistributionPage(): JSX.Element {
  const [form, setForm] = useState<ForecastUrlFormState>(initForm);
  const [donorKey, setDonorKey] = useState("");
  const [reserveDaysStr, setReserveDaysStr] = useState("14");
  const [minTransferableStr, setMinTransferableStr] = useState("1");
  const [maxSkuNetworksStr, setMaxSkuNetworksStr] = useState("100");
  const [rankingMode, setRankingMode] = useState(readRankingModeFromUrl);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

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
    dataDate,
  } = useRedistributionWarehouses(form, donorKey, setDonorKey);

  const {
    results,
    loading,
    error,
    meta,
    resultNote,
    runSearch,
  } = useRedistributionRun({
    form,
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
  } = useRedistributionSkuNetwork(form, donorKey);

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

  const exportXlsx = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      const params = new URLSearchParams({
        horizonDays: form.horizonDays,
        riskStockout: form.riskStockout,
        targetCoverageDays: form.targetCoverageDays,
        replenishmentMode: form.replenishmentMode,
        leadTimeDays: form.leadTimeDays,
        coverageDays: form.coverageDays,
        safetyDays: form.safetyDays,
        viewMode: "wbWarehouses",
        donorWarehouseKey: donorKey.trim(),
        reserveDays: reserveDaysStr,
        minTransferable: minTransferableStr,
        maxSkuNetworks: String(Math.floor(maxSkuNetworks)),
        rankingMode,
        limit: form.rowLimit,
      });
      if (form.ownWarehouseCode.trim()) {
        params.set("ownWarehouseCode", form.ownWarehouseCode.trim());
      }
      const qs = params.toString();
      await downloadForecastFile(
        `/api/forecast/export-redistribution${qs ? `?${qs}` : ""}`,
        `redistribution-${rankingMode}-${safeFilenamePart(donorKey)}-latest-h${form.horizonDays}.xlsx`,
      );
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }, [
    donorKey,
    form.coverageDays,
    form.horizonDays,
    form.leadTimeDays,
    form.ownWarehouseCode,
    form.replenishmentMode,
    form.riskStockout,
    form.rowLimit,
    form.safetyDays,
    form.targetCoverageDays,
    maxSkuNetworks,
    maxSkuNetworksStr,
    minTransferableStr,
    rankingMode,
    reserveDaysStr,
  ]);

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
      <ForecastSystemNav
        dataDate={dataDate}
        onRecalculate={refreshFromWb}
        recalculateBusy={refreshFromWbLoading}
        recalculateDisabled={statsLoading}
      />
      <header class="top">
        <h1>Перемещение между складами WB</h1>
        <p class="muted">
          <strong>Regional</strong> (по умолчанию) — цель перераспределения = <strong>регион</strong>{" "}
          (Σ buyer-region demand); склад внутри региона — операционная деталь.{" "}
          <strong>Fulfillment</strong> — цель = <strong>склад исполнения</strong>. Донор всегда
          складовой; эвристика, не оптимизация и не запись в БД.
        </p>
      </header>

      <RedistributionControlsSection
        form={form}
        patch={patch}
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

      {exportError ? (
        <p class="forecast-next-error" role="alert">
          Экспорт: {exportError}
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
        exporting={exporting}
        exportDisabled={
          exporting ||
          loading ||
          results.length === 0 ||
          !donorKey.trim() ||
          !reserveOk ||
          !minOk ||
          !maxSkuOk
        }
        onExport={exportXlsx}
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
