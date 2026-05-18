import { useCallback, useEffect, useReducer, useRef } from "preact/hooks";
import {
  formStateFromSearchParams,
  type ForecastUrlFormState,
} from "../state/urlState.js";
import {
  forecastFormReducer,
  initialForecastFormState,
} from "../state/forecastFormState.js";
import { isStale, type LoadResult } from "../utils/forecastLoadMessage.js";
import { syncUrlPush, syncUrlReplace } from "../utils/forecastUrlSync.js";

export interface UseForecastFormStateOptions {
  reload: (form: ForecastUrlFormState) => Promise<LoadResult>;
}

export function useForecastFormState(options: UseForecastFormStateOptions) {
  const { reload } = options;
  const [state, dispatch] = useReducer(
    forecastFormReducer,
    undefined,
    initialForecastFormState,
  );

  const formRef = useRef(state.form);
  formRef.current = state.form;

  const qDebounceTimerRef = useRef<number | null>(null);

  const clearQDebounce = useCallback(() => {
    if (qDebounceTimerRef.current !== null) {
      window.clearTimeout(qDebounceTimerRef.current);
      qDebounceTimerRef.current = null;
    }
  }, []);

  const applyFormFromUrl = useCallback(() => {
    const form = formStateFromSearchParams(
      new URLSearchParams(window.location.search),
    );
    dispatch({ type: "init", form });
    return form;
  }, []);

  const scheduleQReload = useCallback(() => {
    if (qDebounceTimerRef.current !== null) {
      window.clearTimeout(qDebounceTimerRef.current);
    }
    qDebounceTimerRef.current = window.setTimeout(() => {
      qDebounceTimerRef.current = null;
      const f = formRef.current;
      void reload(f).then((r) => {
        if (r.ok && !isStale(r)) syncUrlReplace(f);
      });
    }, 300);
  }, [reload]);

  useEffect(() => {
    const form = applyFormFromUrl();
    clearQDebounce();
    void reload(form).then((r) => {
      if (r.ok && !isStale(r)) {
        syncUrlReplace(form);
      }
    });
  }, [applyFormFromUrl, reload, clearQDebounce]);

  useEffect(() => {
    const onPop = () => {
      clearQDebounce();
      const form = applyFormFromUrl();
      void reload(form);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [applyFormFromUrl, reload, clearQDebounce]);

  const patch = useCallback((p: Partial<ForecastUrlFormState>) => {
    dispatch({ type: "patchForm", patch: p });
  }, []);

  const patchAndReload = useCallback(
    (p: Partial<ForecastUrlFormState>) => {
      clearQDebounce();
      const next = { ...state.form, ...p };
      dispatch({ type: "patchForm", patch: p });
      void reload(next).then((r) => {
        if (r.ok && !isStale(r)) syncUrlReplace(next);
      });
    },
    [state.form, reload, clearQDebounce],
  );

  const submitReload = useCallback(
    async (ev: Event) => {
      ev.preventDefault();
      clearQDebounce();
      const r = await reload(state.form);
      if (r.ok && !isStale(r)) {
        syncUrlReplace(state.form);
      }
    },
    [clearQDebounce, reload, state.form],
  );

  const drillToWarehouses = useCallback(
    (nmId: number, techSize: string) => {
      clearQDebounce();
      const nextForm: ForecastUrlFormState = {
        ...state.form,
        viewMode: "wbWarehouses",
        q: String(nmId),
        techSize,
        systemQuickFilter: "all",
      };
      dispatch({ type: "init", form: nextForm });
      syncUrlPush(nextForm);
      void reload(nextForm);
    },
    [state.form, reload, clearQDebounce],
  );

  return {
    form: state.form,
    patch,
    patchAndReload,
    submitReload,
    applyFormFromUrl,
    syncUrlReplace,
    syncUrlPush,
    scheduleQReload,
    clearQDebounce,
    drillToWarehouses,
  };
}
