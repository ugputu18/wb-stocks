import { render } from "preact";
import {
  normalizeForecastUiPathname,
  REDISTRIBUTION_ROUTE,
  REGIONAL_DEMAND_DIAGNOSTICS_ROUTE,
  WAREHOUSE_REGION_AUDIT_ROUTE,
} from "./routes.js";
import "./forecast-ui-theme.css";
import "./panda.css";
import "./components/hints/hints.css";
import "./pages/forecast-page.css";
import { App } from "./App.js";
import { RedistributionPage } from "./pages/RedistributionPage.js";
import { RegionalDemandDiagnosticsPage } from "./pages/RegionalDemandDiagnosticsPage.js";
import { WarehouseRegionAuditPage } from "./pages/WarehouseRegionAuditPage.js";

function routePath(): string {
  if (typeof window === "undefined") return "/";
  return normalizeForecastUiPathname(window.location.pathname || "/");
}

function Root() {
  const p = routePath();
  if (p === REDISTRIBUTION_ROUTE) {
    return <RedistributionPage />;
  }
  if (p === WAREHOUSE_REGION_AUDIT_ROUTE) {
    return <WarehouseRegionAuditPage />;
  }
  if (p === REGIONAL_DEMAND_DIAGNOSTICS_ROUTE) {
    return <RegionalDemandDiagnosticsPage />;
  }
  return <App />;
}

const root = document.getElementById("root");
if (root) {
  render(<Root />, root);
}
