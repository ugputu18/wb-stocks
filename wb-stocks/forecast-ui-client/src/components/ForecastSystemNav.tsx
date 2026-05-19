import type { JSX } from "preact";
import { cx } from "../../styled-system/css";
import { helpTrigger } from "../../styled-system/recipes";
import {
  FORECAST_UI_SPA_ROUTES,
  normalizeForecastUiPathname,
} from "../routes.js";

interface ForecastSystemNavProps {
  dataDate?: string | null;
  onRecalculate?: () => void;
  recalculateBusy?: boolean;
  recalculateDisabled?: boolean;
}

const NAV_ITEMS = [
  { href: FORECAST_UI_SPA_ROUTES.home, label: "Прогноз" },
  { href: FORECAST_UI_SPA_ROUTES.manufacturerOrder, label: "Заказ производителю" },
  { href: FORECAST_UI_SPA_ROUTES.regionalStocks, label: "Запасы" },
  { href: FORECAST_UI_SPA_ROUTES.redistribution, label: "Перемещение" },
  { href: FORECAST_UI_SPA_ROUTES.regionalDemandDiagnostics, label: "Регион vs fulfillment" },
  { href: FORECAST_UI_SPA_ROUTES.warehouseRegionAudit, label: "Аудит складов" },
] as const;

function currentPath(): string {
  if (typeof window === "undefined") return FORECAST_UI_SPA_ROUTES.home;
  return normalizeForecastUiPathname(window.location.pathname || "/");
}

export function ForecastSystemNav({
  dataDate,
  onRecalculate,
  recalculateBusy = false,
  recalculateDisabled = false,
}: ForecastSystemNavProps): JSX.Element {
  const activePath = currentPath();
  return (
    <nav class="system-nav" aria-label="Разделы forecast UI">
      <div class="system-nav-links">
        {NAV_ITEMS.map((item) => {
          const active = normalizeForecastUiPathname(item.href) === activePath;
          return (
            <a
              key={item.href}
              href={item.href}
              class={active ? "system-nav-link system-nav-link-active" : "system-nav-link"}
              aria-current={active ? "page" : undefined}
            >
              {item.label}
            </a>
          );
        })}
      </div>
      <div class="system-nav-meta">
        <span class="system-nav-date">
          {dataDate ? `Данные на ${dataDate}` : "Данные обновляются"}
        </span>
        {onRecalculate ? (
          <button
            type="button"
            class={cx(helpTrigger(), "system-nav-recalculate")}
            disabled={recalculateBusy || recalculateDisabled}
            title="Пересчитать прогноз, обновить WB и склад"
            aria-label="Пересчитать прогноз, обновить WB и склад"
            onClick={() => void onRecalculate()}
          >
            {recalculateBusy ? "…" : "↻"}
          </button>
        ) : null}
      </div>
    </nav>
  );
}
