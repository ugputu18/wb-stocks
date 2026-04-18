export const ROWS_LIMIT_DEFAULT = 500;
export const ROWS_LIMIT_MIN = 50;
export const ROWS_LIMIT_MAX = 2000;

/** Диагностика сырых заказов WB: макс. длина окна по `orderDate`. */
export const ORDERS_DIAG_MAX_RANGE_DAYS = 31;
export const RAW_ORDERS_DIAG_LIMIT_DEFAULT = 200;
export const RAW_ORDERS_DIAG_LIMIT_MAX = 2000;

export const ALLOWED_TARGET_COVERAGE = new Set([30, 45, 60]);

export const DEFAULT_SUPPLIER_LEAD_DAYS = 45;
export const DEFAULT_SUPPLIER_ORDER_COVERAGE_DAYS = 90;
export const DEFAULT_SUPPLIER_SAFETY_DAYS = 0;
/** Должно совпадать с `max` у `#leadTimeDays` в forecast UI (сейчас 1000). */
export const MAX_SUPPLIER_LEAD_DAYS = 1000;

export const DEFAULT_OWN_WAREHOUSE_CODE = "main";
