import { defaultFormState, type ForecastUrlFormState } from "./urlState.js";

export interface ForecastFormModelState {
  form: ForecastUrlFormState;
}

export const initialForecastFormState = (): ForecastFormModelState => ({
  form: defaultFormState(),
});

export type ForecastFormAction =
  | { type: "init"; form: ForecastUrlFormState }
  | { type: "patchForm"; patch: Partial<ForecastUrlFormState> };

export function forecastFormReducer(
  state: ForecastFormModelState,
  action: ForecastFormAction,
): ForecastFormModelState {
  switch (action.type) {
    case "init":
      return { ...state, form: action.form };
    case "patchForm":
      return { ...state, form: { ...state.form, ...action.patch } };
    default:
      return state;
  }
}
