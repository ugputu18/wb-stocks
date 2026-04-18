/** Integer display — same rules as legacy `formatInt`. */
export function formatInt(x: unknown): string {
  if (x == null || Number.isNaN(x)) return "—";
  if (typeof x === "number") return String(Math.round(x));
  return String(x);
}

/** Decimal trim — same as legacy `formatNum`. */
export function formatNum(x: unknown): string {
  if (x == null || Number.isNaN(x)) return "—";
  if (typeof x === "number") return x.toFixed(4).replace(/\.?0+$/, "");
  return String(x);
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

/** Как legacy `formatDetailVal` для dd. */
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
