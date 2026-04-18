import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { ExplainFocus } from "../types/explain.js";

export function useForecastSelection(rowList: unknown[]) {
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [explainFocus, setExplainFocus] = useState<ExplainFocus>(null);

  const clearSelection = useCallback(() => {
    setSelectedRowIndex(null);
    setExplainFocus(null);
  }, []);

  const handleSelectRow = useCallback((idx: number, focus?: ExplainFocus) => {
    setSelectedRowIndex(idx);
    setExplainFocus(focus ?? null);
  }, []);

  useEffect(() => {
    if (selectedRowIndex !== null && selectedRowIndex >= rowList.length) {
      clearSelection();
    }
  }, [rowList.length, selectedRowIndex, clearSelection]);

  const selIdx = selectedRowIndex;
  const selectionValid = useMemo(
    () => selIdx !== null && selIdx >= 0 && selIdx < rowList.length,
    [selIdx, rowList.length],
  );

  const selectedRow = useMemo(
    () => (selectionValid ? rowList[selIdx as number] ?? null : null),
    [rowList, selectionValid, selIdx],
  );

  const explainForUi = selectedRow ? explainFocus : null;

  return {
    selectedRowIndex,
    explainFocus,
    explainForUi,
    selectedRow,
    selectionValid,
    clearSelection,
    handleSelectRow,
  };
}
