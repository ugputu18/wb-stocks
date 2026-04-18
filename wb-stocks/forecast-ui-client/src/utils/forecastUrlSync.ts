import { toRowsSearchParams, type ForecastUrlFormState } from "../state/urlState.js";

export function syncUrlReplace(form: ForecastUrlFormState): void {
  const qs = toRowsSearchParams(form).toString();
  const path = window.location.pathname || "/";
  const next = qs ? `${path}?${qs}` : path;
  const cur = window.location.pathname + window.location.search;
  if (next === cur) return;
  history.replaceState(null, "", next);
}

/** Drilldown: отдельная запись в истории (как legacy `syncUrlFromForm("push")`). */
export function syncUrlPush(form: ForecastUrlFormState): void {
  const qs = toRowsSearchParams(form).toString();
  const path = window.location.pathname || "/";
  const next = qs ? `${path}?${qs}` : path;
  history.pushState(null, "", next);
}
