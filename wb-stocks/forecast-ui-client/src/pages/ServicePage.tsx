import type { JSX } from "preact";
import { ForecastSystemNav } from "../components/ForecastSystemNav.js";
import {
  FORECAST_UI_SPA_ROUTES,
} from "../routes.js";

const SERVICE_LINKS = [
  {
    href: FORECAST_UI_SPA_ROUTES.regionalDemandDiagnostics,
    label: "Регион vs fulfillment",
  },
  {
    href: FORECAST_UI_SPA_ROUTES.warehouseRegionAudit,
    label: "Аудит складов",
  },
  {
    href: FORECAST_UI_SPA_ROUTES.forecast,
    label: "Прогноз",
  },
] as const;

export function ServicePage(): JSX.Element {
  return (
    <div class="forecast-next-root service-page">
      <ForecastSystemNav />
      <header class="top">
        <h1>Служебное</h1>
      </header>

      <section class="panel service-links-panel">
        <ul class="service-links-list">
          {SERVICE_LINKS.map((item) => (
            <li key={item.href}>
              <a href={item.href}>{item.label}</a>
            </li>
          ))}
        </ul>
      </section>

      <style>{`
        .service-page .service-links-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          margin: 0;
          padding-left: 1.15rem;
        }
        .service-page .service-links-list a {
          color: var(--fu-link);
          font-weight: 650;
          text-decoration: none;
        }
        .service-page .service-links-list a:hover {
          color: var(--fu-link-hover);
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
