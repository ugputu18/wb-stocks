import { useCallback, useMemo, useRef } from "preact/hooks";
import { FORECAST_UI_SPA_ROUTES } from "./routes.js";
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
          Summary + основная таблица + закупка.{" "}
          <a href={FORECAST_UI_SPA_ROUTES.redistribution}>Перемещение между складами WB</a>
          {" · "}
          <a href={FORECAST_UI_SPA_ROUTES.regionalDemandDiagnostics}>Регион vs fulfillment</a>
          {" · "}
          Старый экран (reference): <a href="/legacy">/legacy</a>
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
    </div>
  );
}
