import { css } from "../../../styled-system/css";

/** Визуальные состояния строки рекомендаций без изменения поведения (клик / клавиатура). */
export function recommendationRowClass(skuFocus: boolean, selected: boolean): string {
  return css({
    cursor: "pointer",
    "&:hover": {
      background: "var(--fu-hover-row, rgba(0, 0, 0, 0.04))",
    },
    ...(skuFocus ? { background: "rgba(37, 99, 235, 0.06)" } : {}),
    ...(selected
      ? {
          outline: "2px solid var(--fu-accent, #2563eb)",
          outlineOffset: "-2px",
        }
      : {}),
  });
}
