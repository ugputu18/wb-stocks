import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import type { ActionBusy } from "../hooks/useForecastActions.js";
import { ActionHint } from "./hints/index.js";

export interface ActionsBarProps {
  uiBlocked: boolean;
  actionBusy: ActionBusy;
  totalRowsKpi: number;
  supCount: number;
  onExportWb: () => void;
  onExportSupplier: () => void;
  onUploadOwnStocks: (file: File) => void;
}

export function ActionsBar(props: ActionsBarProps): JSX.Element {
  const {
    uiBlocked,
    actionBusy,
    totalRowsKpi,
    supCount,
    onExportWb,
    onExportSupplier,
    onUploadOwnStocks,
  } = props;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <section class="panel actions-bar-panel">
      <div class="actions actions-with-hints">
        <div class="action-with-hint">
          <button
            type="button"
            disabled={uiBlocked || totalRowsKpi === 0}
            onClick={() => void onExportWb()}
          >
            {actionBusy === "export-wb" ? "Экспорт…" : "Скачать WB Excel"}
          </button>
          <ActionHint>Выгружает текущую таблицу поставок на WB (XLSX)</ActionHint>
        </div>
        <div class="action-with-hint">
          <button
            type="button"
            disabled={uiBlocked || supCount === 0}
            onClick={() => void onExportSupplier()}
          >
            {actionBusy === "export-supplier" ? "Экспорт…" : "Скачать Supplier Excel"}
          </button>
          <ActionHint>Выгружает текущий список закупки у производителя (XLSX)</ActionHint>
        </div>
        <div class="action-with-hint">
          <button
            type="button"
            disabled={uiBlocked}
            onClick={() => fileInputRef.current?.click()}
          >
            {actionBusy === "upload-own-stocks"
              ? "Загрузка…"
              : "Загрузить остатки CSV"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={(ev) => {
              const input = ev.currentTarget as HTMLInputElement;
              const file = input.files?.[0];
              if (file) onUploadOwnStocks(file);
              input.value = "";
            }}
          />
          <ActionHint>
            CSV остатков нашего склада. Колонки определяются по содержимому
            (артикул продавца / артикул WB / остаток).
          </ActionHint>
        </div>
      </div>
    </section>
  );
}
