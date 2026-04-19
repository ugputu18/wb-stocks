import { defineConfig, defineRecipe } from "@pandacss/dev";

const panelRecipe = defineRecipe({
  className: "fu-panel",
  description: "Forecast UI bordered panel (aligned with .panel in forecast-ui-theme.css)",
  base: {
    background: "var(--fu-panel)",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--fu-border)",
    borderRadius: "10px",
    boxShadow: "var(--fu-panel-shadow)",
    color: "var(--fu-text)",
    marginTop: "1rem",
  },
  variants: {
    padding: {
      md: { padding: "1rem 1.1rem" },
      sm: { padding: "0.55rem 0.65rem" },
      none: { padding: "0" },
    },
  },
  defaultVariants: {
    padding: "md",
  },
});

const sectionHeadingRecipe = defineRecipe({
  className: "fu-section-heading",
  description: "Section title inside panels",
  base: {
    fontSize: "1.05rem",
    fontWeight: "600",
    marginTop: "0",
    marginBottom: "0.5rem",
    color: "var(--fu-text)",
  },
});

const badgeRecipe = defineRecipe({
  className: "fu-badge",
  description: "Small pill / label",
  base: {
    display: "inline-block",
    fontSize: "0.68rem",
    fontWeight: "600",
    padding: "0.1rem 0.35rem",
    borderRadius: "4px",
    lineHeight: "1.2",
  },
  variants: {
    tone: {
      neutral: {
        backgroundColor: "var(--fu-panel-2, rgba(0,0,0,0.03))",
        color: "var(--fu-text)",
      },
      donor: { backgroundColor: "rgba(37, 99, 235, 0.12)", color: "#1d4ed8" },
      target: { backgroundColor: "rgba(147, 51, 234, 0.12)", color: "#7e22ce" },
      macro: { backgroundColor: "rgba(5, 150, 105, 0.14)", color: "#047857" },
    },
  },
  defaultVariants: {
    tone: "neutral",
  },
});

const fieldHintRecipe = defineRecipe({
  className: "fu-field-hint",
  description: "Muted helper under form fields",
  base: {
    display: "block",
    fontSize: "0.75rem",
    marginTop: "0.2rem",
    lineHeight: "1.35",
    color: "var(--fu-muted, #666)",
  },
});

const inlineActionRecipe = defineRecipe({
  className: "fu-inline-action",
  description: "Small non-primary button (link-style control)",
  base: {
    fontSize: "0.72rem",
    padding: "0.12rem 0.4rem",
    margin: "0",
    borderRadius: "5px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--fu-border-strong)",
    backgroundColor: "var(--fu-panel-2, rgba(0,0,0,0.03))",
    color: "var(--fu-text)",
    cursor: "pointer",
    fontWeight: "600",
    lineHeight: "1.2",
  },
});

const popoverSurfaceRecipe = defineRecipe({
  className: "fu-popover-surface",
  description: "Popover / anchored panel surface (Radix Content)",
  base: {
    zIndex: "20",
    minWidth: "min(18rem, 92vw)",
    maxWidth: "22rem",
    maxHeight: "16rem",
    overflow: "auto",
    padding: "0.55rem 0.65rem",
    borderRadius: "8px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--fu-border-strong)",
    backgroundColor: "var(--fu-bg-elevated, #fff)",
    boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
    fontSize: "0.8rem",
    lineHeight: "1.35",
    textAlign: "left",
    color: "var(--fu-text)",
  },
});

const sectionHeadingRowRecipe = defineRecipe({
  className: "fu-section-heading-row",
  description: "Title + chip(s) on one line (flex wrap)",
  base: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.35rem 0.5rem",
  },
});

const rankingPillRecipe = defineRecipe({
  className: "fu-ranking-pill",
  description: "Active mode label next to a section title",
  base: {
    display: "inline-block",
    fontSize: "0.72rem",
    fontWeight: "600",
    padding: "0.12rem 0.5rem",
    borderRadius: "999px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--fu-border-strong)",
    verticalAlign: "middle",
  },
});

const resultsLedeRecipe = defineRecipe({
  className: "fu-results-lede",
  description: "Intro paragraph under a results section heading",
  base: {
    fontSize: "0.85rem",
    lineHeight: "1.45",
    marginBottom: "0.75rem",
    color: "var(--fu-muted, #666)",
  },
});

const scrollTableWrapRecipe = defineRecipe({
  className: "fu-scroll-table-wrap",
  description: "Horizontal scroll container for wide data tables",
  base: {
    width: "100%",
    overflowX: "auto",
    WebkitOverflowScrolling: "touch",
  },
});

const denseDataTableRecipe = defineRecipe({
  className: "fu-dense-data-table",
  description:
    "Tight typography + nowrap columns; 2nd column allows wrap (SKU block)",
  base: {
    fontSize: "0.82rem",
    "& th": {
      whiteSpace: "nowrap",
    },
    "& td": {
      whiteSpace: "nowrap",
    },
    "& td:nth-child(2)": {
      whiteSpace: "normal",
      minWidth: "10rem",
    },
  },
});

const macroRegionTdRecipe = defineRecipe({
  className: "fu-macro-region-td",
  base: {
    position: "relative",
    verticalAlign: "top",
  },
});

const macroRegionHeadRecipe = defineRecipe({
  className: "fu-macro-region-head",
  base: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: "0.35rem 0.5rem",
  },
});

const macroRegionHintRecipe = defineRecipe({
  className: "fu-macro-region-hint",
  base: {
    fontSize: "0.72rem",
    marginTop: "0.15rem",
    maxWidth: "14rem",
    color: "var(--fu-muted, #666)",
  },
});

const prefWarehouseTdRecipe = defineRecipe({
  className: "fu-pref-warehouse-td",
  base: {
    whiteSpace: "normal",
    maxWidth: "12rem",
  },
});

/** Строка подписи поля: текст + компактный help-trigger */
const fieldLabelRowRecipe = defineRecipe({
  className: "fu-field-label-row",
  description: "Filter label + inline help (forecast form)",
  base: {
    display: "inline-flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "0.15rem 0.3rem",
    lineHeight: "1.25",
    fontWeight: "500",
    color: "var(--fu-text)",
  },
});

/** Лёгкий info-триггер у подписи (не «вторая кнопка») */
const helpTriggerRecipe = defineRecipe({
  className: "fu-help-trigger",
  description: "Compact i trigger for field help popovers",
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "1.05rem",
    height: "1.05rem",
    padding: "0",
    margin: "0",
    marginLeft: "0.05rem",
    border: "none",
    borderRadius: "4px",
    background: "transparent",
    color: "var(--fu-muted, #64748b)",
    fontSize: "0.62rem",
    lineHeight: "1",
    cursor: "pointer",
    flexShrink: "0",
    verticalAlign: "middle",
    _hover: {
      color: "var(--fu-brand, #0d9488)",
      background: "var(--fu-brand-soft, rgba(13, 148, 136, 0.12))",
    },
    _focusVisible: {
      outline: "2px solid var(--fu-brand)",
      outlineOffset: "1px",
    },
  },
});

/** Горизонтальная полоска инструментов над таблицей (чекбоксы, подсказка справа) */
const toolbarRowRecipe = defineRecipe({
  className: "fu-toolbar-row",
  description: "Flex toolbar row above forecast/supplier tables",
  base: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.75rem 1rem",
    marginBottom: "0.5rem",
    fontSize: "0.85rem",
  },
});

/** Пустое состояние таблицы (рамка, отступы) */
const tableEmptyStateRecipe = defineRecipe({
  className: "fu-table-empty-state",
  description: "Dashed bordered placeholder when a forecast table has no rows",
  base: {
    padding: "1.5rem 1rem",
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: "var(--fu-border-strong)",
    borderRadius: "8px",
    textAlign: "center",
    maxWidth: "36rem",
    margin: "0.5rem auto 0 auto",
    background: "var(--fu-bg)",
  },
});

/** Главная / вторичная строка формы фильтров (`FiltersForm`) */
const filterFormRowRecipe = defineRecipe({
  className: "fu-filter-form-row",
  description: "Forecast filters: primary (top) or secondary row under quick chips",
  base: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: "0.65rem 1rem",
    width: "100%",
  },
  variants: {
    row: {
      primary: {},
      secondary: {
        marginTop: "0.62rem",
        paddingTop: "0.7rem",
        borderTopWidth: "1px",
        borderTopStyle: "solid",
        borderTopColor: "var(--fu-border)",
      },
    },
  },
  defaultVariants: {
    row: "primary",
  },
});

/**
 * Правая часть 1-й строки: растягиваемый поиск + кнопка «Загрузить» и подсказка.
 * Держит чип у label+button и не даёт полям «разъехаться» на всю ширину по одному в ряд.
 */
const filterSearchActionGroupRecipe = defineRecipe({
  className: "fu-filter-search-action",
  description: "Search field + load button cluster (primary filter row)",
  base: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: "0.6rem 0.85rem",
    flex: "1 1 16rem",
    minWidth: "min(100%, 15rem)",
  },
});

/** Колонка подпись + control в форме фильтров (компактный вертикальный стек) */
const filterFieldRecipe = defineRecipe({
  className: "fu-filter-field",
  description:
    "Label+column in FiltersForm; layout_* = width hints (desktop); inputs fill field, not viewport",
  base: {
    display: "flex",
    flexDirection: "column",
    gap: "0.32rem",
    fontSize: "0.8rem",
    boxSizing: "border-box",
    minWidth: "0",
    "& .fu-field-label-row": {
      flexWrap: "nowrap",
      alignItems: "center",
      lineHeight: "1.2",
      minHeight: "1.1rem",
    },
    "& select, & input": {
      boxSizing: "border-box",
      width: "100%",
      minWidth: "0",
      maxWidth: "100%",
    },
  },
  variants: {
    layout: {
      auto: {
        flex: "0 1 auto",
        width: "auto",
        maxWidth: "min(100%, 20rem)",
      },
      wide: {
        flex: "0 1 17rem",
        width: "auto",
        maxWidth: "min(100%, 22rem)",
      },
      medium: {
        flex: "0 1 12rem",
        maxWidth: "min(100%, 14rem)",
      },
      narrow: {
        flex: "0 1 7.5rem",
        maxWidth: "min(100%, 9rem)",
      },
      date: {
        flex: "0 1 10.5rem",
        maxWidth: "min(100%, 11.5rem)",
      },
      tech: {
        flex: "0 1 7.5rem",
        maxWidth: "min(100%, 10rem)",
      },
      /** Внутри `filterSearchActionGroup`: поле поиска забирает остаток ширины */
      search: {
        flex: "1 1 10rem",
        minWidth: "0",
        width: "auto",
        maxWidth: "none",
        alignSelf: "stretch",
        "& input": {
          minWidth: "min(11rem, 100%)",
        },
      },
      grow: {
        flex: "1 1 12rem",
        minWidth: "min(100%, 10rem)",
        maxWidth: "100%",
      },
      /** Полная ширина строки в grid (Bearer) */
      spanGridFull: {
        width: "100%",
        maxWidth: "100%",
        gridColumn: "1 / -1",
        alignSelf: "start",
        marginTop: "0.2rem",
      },
    },
  },
  defaultVariants: {
    layout: "auto",
  },
});

const quickFiltersBarRecipe = defineRecipe({
  className: "fu-quick-filters",
  description: "Compact quick-scenario toolbar under primary row",
  base: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.45rem 0.65rem",
    marginTop: "0.55rem",
    padding: "0.3rem 0",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: "var(--fu-border)",
  },
});

const quickFiltersLabelRecipe = defineRecipe({
  className: "fu-quick-filters-label",
  base: {
    fontSize: "0.72rem",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginRight: "0.2rem",
    color: "var(--fu-muted)",
    flex: "0 0 auto",
  },
});

const quickFiltersButtonsRecipe = defineRecipe({
  className: "fu-quick-filters-buttons",
  base: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.3rem 0.4rem",
    flex: "1 1 auto",
    minWidth: "0",
  },
});

const quickFilterChipRecipe = defineRecipe({
  className: "fu-quick-filter-chip",
  description: "Compact preset chip in FiltersForm quick row",
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    minHeight: "1.6rem",
    fontSize: "0.78rem",
    lineHeight: "1.2",
    padding: "0.22rem 0.48rem",
    borderRadius: "7px",
    borderWidth: "1px",
    borderStyle: "solid",
    cursor: "pointer",
    color: "var(--fu-text)",
  },
  variants: {
    active: {
      true: {
        borderColor: "var(--fu-brand)",
        background: "var(--fu-brand-soft)",
        color: "var(--fu-brand-on-soft)",
      },
      false: {
        borderColor: "var(--fu-border-strong)",
        background: "var(--fu-panel)",
        _hover: {
          borderColor: "var(--fu-brand)",
          background: "var(--fu-brand-soft)",
        },
      },
    },
  },
  defaultVariants: {
    active: false,
  },
});

const calcParamsDetailsRecipe = defineRecipe({
  className: "fu-calc-params-details",
  base: {
    marginTop: "0.75rem",
  },
});

const calcParamsSummaryRecipe = defineRecipe({
  className: "fu-calc-params-summary",
  base: {
    cursor: "pointer",
    fontSize: "0.78rem",
    fontWeight: "500",
    color: "var(--fu-muted)",
    padding: "0.22rem 0",
    lineHeight: "1.4",
    letterSpacing: "0.01em",
  },
});

const calcParamsBodyRecipe = defineRecipe({
  className: "fu-calc-params-body",
  base: {
    paddingTop: "0.45rem",
  },
});

const calcParamsGridRecipe = defineRecipe({
  className: "fu-calc-params-grid",
  description: "Calculation params grid inside FiltersForm details",
  base: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "0.5rem 0.75rem",
    alignItems: "end",
    width: "100%",
  },
});

/** Узкий лёгкий popover для help-текста (не полноразмерная панель) */
const helpPopoverRecipe = defineRecipe({
  className: "fu-help-popover",
  description: "Compact Radix popover body for inline field help",
  base: {
    zIndex: "1200",
    boxSizing: "border-box",
    width: "min(20rem, calc(100vw - 1.5rem))",
    maxWidth: "21.25rem",
    minWidth: "11rem",
    maxHeight: "11rem",
    overflowY: "auto",
    overflowX: "hidden",
    padding: "0.42rem 0.52rem",
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "var(--fu-border-strong)",
    backgroundColor: "var(--fu-bg-elevated, #fff)",
    boxShadow: "0 3px 12px rgba(15, 23, 42, 0.1)",
    fontSize: "0.76rem",
    lineHeight: "1.45",
    color: "var(--fu-text)",
    textAlign: "left",
    whiteSpace: "normal",
    wordBreak: "break-word",
  },
});

export default defineConfig({
  /** Global Panda reset отключён: уже есть `forecast-ui-theme.css`. */
  preflight: false,
  jsxFramework: "preact",
  include: ["./src/**/*.{ts,tsx}"],
  exclude: [],
  outdir: "styled-system",
  theme: {
    extend: {
      recipes: {
        panel: panelRecipe,
        sectionHeading: sectionHeadingRecipe,
        sectionHeadingRow: sectionHeadingRowRecipe,
        badge: badgeRecipe,
        fieldHint: fieldHintRecipe,
        inlineAction: inlineActionRecipe,
        popoverSurface: popoverSurfaceRecipe,
        rankingPill: rankingPillRecipe,
        resultsLede: resultsLedeRecipe,
        scrollTableWrap: scrollTableWrapRecipe,
        denseDataTable: denseDataTableRecipe,
        macroRegionTd: macroRegionTdRecipe,
        macroRegionHead: macroRegionHeadRecipe,
        macroRegionHint: macroRegionHintRecipe,
        prefWarehouseTd: prefWarehouseTdRecipe,
        fieldLabelRow: fieldLabelRowRecipe,
        helpTrigger: helpTriggerRecipe,
        helpPopover: helpPopoverRecipe,
        toolbarRow: toolbarRowRecipe,
        tableEmptyState: tableEmptyStateRecipe,
        filterFormRow: filterFormRowRecipe,
        filterSearchActionGroup: filterSearchActionGroupRecipe,
        filterField: filterFieldRecipe,
        quickFiltersBar: quickFiltersBarRecipe,
        quickFiltersLabel: quickFiltersLabelRecipe,
        quickFiltersButtons: quickFiltersButtonsRecipe,
        quickFilterChip: quickFilterChipRecipe,
        calcParamsDetails: calcParamsDetailsRecipe,
        calcParamsSummary: calcParamsSummaryRecipe,
        calcParamsBody: calcParamsBodyRecipe,
        calcParamsGrid: calcParamsGridRecipe,
      },
    },
  },
});
