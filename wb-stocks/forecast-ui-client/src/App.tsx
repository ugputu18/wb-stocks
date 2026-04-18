import { useCallback, useMemo, useRef } from "preact/hooks";
import { ActionsBar } from "./components/ActionsBar.js";
import { DetailPanel } from "./components/DetailPanel.js";
import { FiltersForm } from "./components/FiltersForm.js";
import { MainTable } from "./components/MainTable.js";
import { StatusBar } from "./components/StatusBar.js";
import { SupplierTable } from "./components/SupplierTable.js";
import { SummaryGrid } from "./components/SummaryGrid.js";
import { useForecastActions } from "./hooks/useForecastActions.js";
import { useForecastFormState } from "./hooks/useForecastFormState.js";
import { useForecastPageData } from "./hooks/useForecastPageData.js";
import { useForecastSelection } from "./hooks/useForecastSelection.js";
import {
  findMainRowIndexBySku,
  supplierRowKey,
} from "./utils/supplierLookup.js";
import { mainTableHintHtml } from "./utils/mainTableHintHtml.js";
import { normalizeRowsViewMode } from "./utils/viewMode.js";

function asRow(row: unknown): Record<string, unknown> {
  return row && typeof row === "object" ? (row as Record<string, unknown>) : {};
}

export function App() {
  const onLoadSuccessRef = useRef<(() => void) | null>(null);
  const runOnLoadSuccess = useCallback(() => {
    onLoadSuccessRef.current?.();
  }, []);

  const pageData = useForecastPageData({
    onLoadSuccess: runOnLoadSuccess,
  });

  const formState = useForecastFormState({
    reload: pageData.loadAll,
  });

  const rowList = useMemo(
    () => (Array.isArray(pageData.rows?.rows) ? pageData.rows.rows : []),
    [pageData.rows?.rows],
  );

  const selection = useForecastSelection(rowList);
  onLoadSuccessRef.current = selection.clearSelection;

  const actions = useForecastActions({
    form: formState.form,
    apiToken: formState.apiToken,
    reload: pageData.loadAll,
    clearQDebounce: formState.clearQDebounce,
    setStatusLine: pageData.setStatusLine,
    setStatusTone: pageData.setStatusTone,
  });

  const supList = pageData.supplier?.rows;
  const supCount = Array.isArray(supList) ? supList.length : 0;
  const vm = normalizeRowsViewMode(
    pageData.rows?.viewMode ?? formState.form.viewMode,
  );

  const handleSupplierRowClick = useCallback(
    (row: unknown, _index: number) => {
      const o = asRow(row);
      const mi = findMainRowIndexBySku(rowList, o.nmId, o.techSize);
      if (mi >= 0) {
        selection.handleSelectRow(mi, "supplier");
      }
    },
    [rowList, selection.handleSelectRow],
  );

  const totalRowsKpi = pageData.summary?.totalRows ?? 0;
  const highlightSupplierKey =
    selection.explainForUi === "supplier" && selection.selectedRow
      ? supplierRowKey(
          asRow(selection.selectedRow).nmId,
          asRow(selection.selectedRow).techSize,
        )
      : null;
  const supplierExplainActive = Boolean(
    selection.explainForUi === "supplier" && selection.selectedRow,
  );
  const uiBlocked =
    pageData.loadStatus === "loading" || actions.actionBusy !== null;

  const selIdx = selection.selectedRowIndex;

  return (
    <div class="forecast-next-root">
      <header class="top">
        <h1>WB sales forecast</h1>
        <p class="muted">
          Summary + основная таблица + закупка. Старый экран (reference):{" "}
          <a href="/legacy">/legacy</a>
        </p>
      </header>

      <FiltersForm
        form={formState.form}
        apiToken={formState.apiToken}
        warehouseKeys={pageData.warehouseKeys}
        loadStatus={pageData.loadStatus}
        uiBlocked={uiBlocked}
        onSubmit={formState.submitReload}
        patch={formState.patch}
        patchAndReload={formState.patchAndReload}
        scheduleQReload={formState.scheduleQReload}
        setApiToken={formState.setApiToken}
      />

      <ActionsBar
        uiBlocked={uiBlocked}
        actionBusy={actions.actionBusy}
        totalRowsKpi={totalRowsKpi}
        supCount={supCount}
        onRecalculate={actions.runRecalculate}
        onExportWb={actions.runExportWb}
        onExportSupplier={actions.runExportSupplier}
      />

      <StatusBar
        statusLine={pageData.statusLine}
        statusTone={pageData.statusTone}
      />

      {pageData.loadStatus === "success" && pageData.summary ? (
        <section class="panel" id="summaryBox">
          <h2>Сводка KPI</h2>
          <SummaryGrid data={pageData.summary} viewMode={vm} />
        </section>
      ) : null}

      {pageData.loadStatus === "success" && pageData.rows ? (
        <>
          <section class="panel">
            <h2>Строки прогноза</h2>
            <p
              class="muted table-hint"
              dangerouslySetInnerHTML={{ __html: mainTableHintHtml(vm) }}
            />
            <MainTable
              rows={rowList}
              viewMode={vm}
              selectedIndex={
                selection.selectionValid ? selIdx : null
              }
              explainFocus={selection.explainForUi}
              onSelectRow={selection.handleSelectRow}
              onDrillToWarehouses={
                vm === "wbTotal" || vm === "systemTotal"
                  ? formState.drillToWarehouses
                  : undefined
              }
            />
          </section>
          <DetailPanel
            row={selection.selectedRow}
            viewMode={vm}
            explainFocus={selection.explainForUi}
            supplierRows={Array.isArray(supList) ? supList : []}
          />
          <section class="panel" id="supplierPanel">
            <h2>Закупка у производителя (по SKU)</h2>
            <p class="muted table-hint">
              Одна строка на артикул × размер; спрос и остаток WB —{" "}
              <strong>сумма по всем складам</strong> сети; заказ у поставщика — от дефицита общего пула
              (не суммируйте с колонкой «На WB»). Фильтры склада и поиска применяются к списку SKU (без
              фильтра «Риск окончания»). Lead time / coverage / safety — в форме выше.
            </p>
            <SupplierTable
              rows={Array.isArray(supList) ? supList : []}
              highlightSupplierKey={highlightSupplierKey}
              supplierExplainActive={supplierExplainActive}
              onRowClick={handleSupplierRowClick}
            />
          </section>
        </>
      ) : null}

      <style>{`
        .forecast-next-root { max-width: 1400px; margin: 0 auto; padding: 0 1.25rem 3rem; }
        #status { min-height: 1.25rem; }
        .forecast-next-error { color: #fca5a5; margin: 0; }

        .filters-primary-row {
          display: flex;
          flex-wrap: wrap;
          align-items: flex-end;
          gap: 0.75rem 1rem;
        }
        .filters-primary-row label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.85rem; }
        .filter-search input { min-width: 12rem; }
        .btn-load { align-self: flex-end; padding: 0.35rem 0.75rem; }

        .quick-filters {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.5rem 0.75rem;
          margin-top: 0.75rem;
          padding: 0.5rem 0;
          border-top: 1px solid rgba(255,255,255,0.08);
        }
        .quick-filters-label { font-size: 0.8rem; margin-right: 0.25rem; }
        .quick-filters-buttons { display: flex; flex-wrap: wrap; gap: 0.35rem; }
        .quick-filter-btn {
          font-size: 0.8rem;
          padding: 0.25rem 0.55rem;
          border-radius: 4px;
          border: 1px solid rgba(255,255,255,0.15);
          background: rgba(0,0,0,0.2);
          color: inherit;
          cursor: pointer;
        }
        .quick-filter-btn:hover { border-color: rgba(255,255,255,0.35); }
        .quick-filter-btn.is-active {
          border-color: rgba(96, 165, 250, 0.7);
          background: rgba(59, 130, 246, 0.15);
        }

        .filters-secondary-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem 1rem;
          margin-top: 0.5rem;
          padding-top: 0.5rem;
          border-top: 1px solid rgba(255,255,255,0.06);
        }
        .filters-secondary-row label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.8rem; }

        .calc-params-details { margin-top: 0.75rem; }
        .calc-params-summary {
          cursor: pointer;
          font-size: 0.85rem;
          color: rgba(255,255,255,0.65);
          padding: 0.35rem 0;
        }
        .calc-params-body { padding-top: 0.5rem; }
        .calc-params-grid { display: flex; flex-wrap: wrap; gap: 0.75rem 1rem; }
        .calc-params-grid label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.8rem; }

        .summary-grid-wrap { display: flex; flex-direction: column; gap: 0.75rem; }
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
          gap: 0.5rem 0.75rem;
        }
        .summary-grid-tech-label {
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          margin: 0.25rem 0 0 0;
        }
        .summary-grid-technical .cell { opacity: 0.85; }
        .summary-grid-technical .cell strong { font-weight: 500; font-size: 0.95em; }
        .cell-muted .muted { opacity: 0.75; }

        .detail-diagnosis {
          padding: 0.65rem 0.85rem;
          border-radius: 6px;
          margin-bottom: 0.65rem;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(0,0,0,0.15);
        }
        .detail-diagnosis-ok { border-color: rgba(34, 197, 94, 0.35); }
        .detail-diagnosis-need_wb { border-color: rgba(59, 130, 246, 0.45); }
        .detail-diagnosis-stockout_before_arrival { border-color: rgba(248, 113, 113, 0.45); }
        .detail-diagnosis-regional_deficit { border-color: rgba(250, 204, 21, 0.4); }
        .detail-diagnosis-title { font-weight: 600; margin: 0 0 0.25rem 0; font-size: 1rem; }
        .detail-diagnosis-hint { margin: 0; font-size: 0.85rem; line-height: 1.35; }
        .detail-action-line {
          font-size: 0.9rem;
          margin: 0 0 0.75rem 0;
          padding: 0.35rem 0;
          border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .detail-section-heading {
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin: 0.75rem 0 0.35rem 0;
          color: rgba(255,255,255,0.55);
        }

        .table-empty-state {
          padding: 1.5rem 1rem;
          border: 1px dashed rgba(255,255,255,0.15);
          border-radius: 8px;
          text-align: center;
          max-width: 36rem;
          margin: 0.5rem auto 0 auto;
        }
        .table-empty-title { font-weight: 600; margin: 0 0 0.5rem 0; }
        .table-empty-hint { margin: 0; font-size: 0.9rem; line-height: 1.45; }

        .supplier-table-toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.75rem 1rem;
          margin-bottom: 0.5rem;
          font-size: 0.85rem;
        }
        .supplier-toolbar-toggle { display: inline-flex; align-items: center; gap: 0.35rem; cursor: pointer; }
        .supplier-toolbar-hint { font-size: 0.75rem; margin-left: auto; }
      `}</style>
    </div>
  );
}
