import { render } from "preact";
import {
  normalizeForecastUiPathname,
  FORECAST_ROUTE,
  MANUFACTURER_ORDER_ROUTE,
  REDISTRIBUTION_ROUTE,
  REGIONAL_DEMAND_DIAGNOSTICS_ROUTE,
  REGIONAL_STOCKS_ROUTE,
  SERVICE_ROUTE,
  WAREHOUSE_REGION_AUDIT_ROUTE,
} from "./routes.js";
import "./forecast-ui-theme.css";
import "./panda.css";
import "./components/hints/hints.css";
import "./pages/forecast-page.css";
import { App } from "./App.js";
import { ManufacturerOrderPage } from "./pages/ManufacturerOrderPage.js";
import { RedistributionPage } from "./pages/RedistributionPage.js";
import { RegionalDemandDiagnosticsPage } from "./pages/RegionalDemandDiagnosticsPage.js";
import { RegionalStocksPage } from "./pages/RegionalStocksPage.js";
import { ServicePage } from "./pages/ServicePage.js";
import { WarehouseRegionAuditPage } from "./pages/WarehouseRegionAuditPage.js";

function routePath(): string {
  if (typeof window === "undefined") return "/";
  return normalizeForecastUiPathname(window.location.pathname || "/");
}

function Root() {
  const p = routePath();
  if (p === "/" || p === REGIONAL_STOCKS_ROUTE) {
    return <RegionalStocksPage />;
  }
  if (p === FORECAST_ROUTE) {
    return <App />;
  }
  if (p === REDISTRIBUTION_ROUTE) {
    return <RedistributionPage />;
  }
  if (p === MANUFACTURER_ORDER_ROUTE) {
    return <ManufacturerOrderPage />;
  }
  if (p === WAREHOUSE_REGION_AUDIT_ROUTE) {
    return <WarehouseRegionAuditPage />;
  }
  if (p === REGIONAL_DEMAND_DIAGNOSTICS_ROUTE) {
    return <RegionalDemandDiagnosticsPage />;
  }
  if (p === SERVICE_ROUTE) {
    return <ServicePage />;
  }
  return <RegionalStocksPage />;
}

const root = document.getElementById("root");
if (root) {
  render(<Root />, root);
}
