/** Round to one decimal place for UI (days, шт., rates). */
function roundToTenths(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Единое отображение чисел: округление до десятых (дни, штуки, спрос/день). */
function formatTenthsDisplay(x: unknown): string {
  if (x == null) return "—";
  if (typeof x === "number") {
    if (Number.isNaN(x) || !Number.isFinite(x)) return "—";
    return roundToTenths(x).toFixed(1);
  }
  if (typeof x === "string") {
    const t = x.trim();
    if (t === "") return "—";
    const n = Number(t);
    if (Number.isFinite(n)) return roundToTenths(n).toFixed(1);
    return x;
  }
  if (typeof x === "bigint") {
    return roundToTenths(Number(x)).toFixed(1);
  }
  const n = Number(x);
  if (Number.isFinite(n)) return roundToTenths(n).toFixed(1);
  return String(x);
}

/** Штуки и целочисленные метрики — до десятых. */
export function formatInt(x: unknown): string {
  return formatTenthsDisplay(x);
}

/** Дни, спрос/день, коэффициенты — до десятых. */
export function formatNum(x: unknown): string {
  return formatTenthsDisplay(x);
}

export function badgeClass(risk: unknown): string {
  const m: Record<string, string> = {
    critical: "badge-critical",
    warning: "badge-warning",
    attention: "badge-attention",
    ok: "badge-ok",
  };
  const k = typeof risk === "string" ? risk : "";
  return m[k] || "badge-ok";
}

/** Числа в деталях — те же правила (до десятых). */
export function formatDetailVal(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return formatNum(v);
  return String(v);
}

/** Latin labels in wbTotal / systemTotal first column (legacy `riskLabelWbTotal`). */
export function riskLabelWbTotal(risk: unknown): string {
  const m: Record<string, string> = {
    critical: "CRITICAL",
    warning: "WARNING",
    attention: "ATTENTION",
    ok: "OK",
  };
  const k = typeof risk === "string" ? risk : "";
  if (m[k]) return m[k];
  return String(risk ?? "").toUpperCase();
}
