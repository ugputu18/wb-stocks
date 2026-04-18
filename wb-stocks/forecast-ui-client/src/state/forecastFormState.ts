import { defaultFormState, type ForecastUrlFormState } from "./urlState.js";

export interface ForecastFormModelState {
  form: ForecastUrlFormState;
  apiToken: string;
}

export const initialForecastFormState = (): ForecastFormModelState => ({
  form: defaultFormState(),
  apiToken: "",
});

export type ForecastFormAction =
  | { type: "init"; form: ForecastUrlFormState }
  | { type: "patchForm"; patch: Partial<ForecastUrlFormState> }
  | { type: "setApiToken"; token: string };

export function forecastFormReducer(
  state: ForecastFormModelState,
  action: ForecastFormAction,
): ForecastFormModelState {
  switch (action.type) {
    case "init":
      return { ...state, form: action.form };
    case "patchForm":
      return { ...state, form: { ...state.form, ...action.patch } };
    case "setApiToken":
      return { ...state, apiToken: action.token };
    default:
      return state;
  }
}
