import type {
  ForecastRowsResponse,
  ForecastSummaryResponse,
  SupplierReplenishmentResponse,
} from "../api/types.js";

export type LoadStatus = "idle" | "loading" | "success" | "error";

export interface ForecastPageDataState {
  loadStatus: LoadStatus;
  errorMessage: string | null;
  summary: ForecastSummaryResponse | null;
  rows: ForecastRowsResponse | null;
  supplier: SupplierReplenishmentResponse | null;
  warehouseKeys: string[] | null;
}

export const initialForecastPageDataState = (): ForecastPageDataState => ({
  loadStatus: "idle",
  errorMessage: null,
  summary: null,
  rows: null,
  supplier: null,
  warehouseKeys: null,
});

export type ForecastPageDataAction =
  | { type: "loadStart" }
  | {
      type: "loadOk";
      summary: ForecastSummaryResponse;
      rows: ForecastRowsResponse;
      supplier: SupplierReplenishmentResponse;
      warehouseKeys: string[];
    }
  | { type: "loadErr"; message: string };

export function forecastPageDataReducer(
  state: ForecastPageDataState,
  action: ForecastPageDataAction,
): ForecastPageDataState {
  switch (action.type) {
    case "loadStart":
      return {
        ...state,
        loadStatus: "loading",
        errorMessage: null,
      };
    case "loadOk":
      return {
        ...state,
        loadStatus: "success",
        errorMessage: null,
        summary: action.summary,
        rows: action.rows,
        supplier: action.supplier,
        warehouseKeys: action.warehouseKeys,
      };
    case "loadErr":
      return {
        ...state,
        loadStatus: "error",
        errorMessage: action.message,
        summary: null,
        rows: null,
        supplier: null,
        warehouseKeys: null,
      };
    default:
      return state;
  }
}
