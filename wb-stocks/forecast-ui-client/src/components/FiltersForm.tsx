import { useMemo } from "preact/hooks";
import type { JSX } from "preact";
import { cx } from "../../styled-system/css";
import {
  calcParamsBody,
  calcParamsDetails,
  calcParamsGrid,
  calcParamsSummary,
  filterField,
  filterFormRow,
  filterSearchActionGroup,
  quickFilterChip,
  quickFiltersBar,
  quickFiltersButtons,
  quickFiltersLabel,
} from "../../styled-system/recipes";
import { HelpToggle } from "./HelpToggle.js";
import { ActionHint, LabelWithInlineHelp } from "./hints/index.js";
import type { LoadStatus } from "../state/forecastPageState.js";
import type { ForecastUrlFormState } from "../state/urlState.js";
import { formatWarehouseWithRegion } from "../utils/wbWarehouseRegion.js";

export interface FiltersFormProps {
  form: ForecastUrlFormState;
  apiToken: string;
  warehouseKeys: string[] | null;
  loadStatus: LoadStatus;
  uiBlocked: boolean;
  onSubmit: (ev: Event) => void;
  patch: (p: Partial<ForecastUrlFormState>) => void;
  patchAndReload: (p: Partial<ForecastUrlFormState>) => void;
  scheduleQReload: () => void;
  setApiToken: (token: string) => void;
}

type QuickPreset =
  | "all"
  | "systemRisk"
  | "wbReplenish"
  | "supplierOrder"
  | "deficitArrival";

function matchesQuickPreset(form: ForecastUrlFormState, preset: QuickPreset): boolean {
  if (form.viewMode !== "systemTotal") return false;
  switch (preset) {
    case "all":
      return form.systemQuickFilter === "all" && form.riskStockout === "all";
    case "systemRisk":
      return form.systemQuickFilter === "systemRisk" && form.riskStockout === "all";
    case "wbReplenish":
      return form.systemQuickFilter === "wbReplenish" && form.riskStockout === "all";
    case "supplierOrder":
      return (
        form.systemQuickFilter === "supplierOrder" &&
        form.riskStockout === "all"
      );
    case "deficitArrival":
      return (
        form.systemQuickFilter === "supplierOrder" && form.riskStockout === "lt30"
      );
    default:
      return false;
  }
}

function presetPatch(preset: QuickPreset): Partial<ForecastUrlFormState> {
  const base = { viewMode: "systemTotal" as const };
  switch (preset) {
    case "all":
      return { ...base, systemQuickFilter: "all", riskStockout: "all" };
    case "systemRisk":
      return { ...base, systemQuickFilter: "systemRisk", riskStockout: "all" };
    case "wbReplenish":
      return { ...base, systemQuickFilter: "wbReplenish", riskStockout: "all" };
    case "supplierOrder":
      return { ...base, systemQuickFilter: "supplierOrder", riskStockout: "all" };
    case "deficitArrival":
      return { ...base, systemQuickFilter: "supplierOrder", riskStockout: "lt30" };
    default:
      return base;
  }
}

export function FiltersForm(props: FiltersFormProps): JSX.Element {
  const {
    form,
    apiToken,
    warehouseKeys,
    loadStatus,
    uiBlocked,
    onSubmit,
    patch,
    patchAndReload,
    scheduleQReload,
    setApiToken,
  } = props;

  const quickActive = useMemo(
    () => ({
      all: matchesQuickPreset(form, "all"),
      systemRisk: matchesQuickPreset(form, "systemRisk"),
      wbReplenish: matchesQuickPreset(form, "wbReplenish"),
      supplierOrder: matchesQuickPreset(form, "supplierOrder"),
      deficitArrival: matchesQuickPreset(form, "deficitArrival"),
    }),
    [form],
  );

  const applyQuick = (preset: QuickPreset) => {
    patchAndReload(presetPatch(preset));
  };

  return (
    <section class="panel filters-panel">
      <form class="controls" onSubmit={onSubmit}>
        <div class={filterFormRow({ row: "primary" })}>
          <label class={filterField({ layout: "wide" })}>
            <LabelWithInlineHelp>Вид</LabelWithInlineHelp>
            <select
              value={form.viewMode}
              onChange={(e) => {
                const viewMode = (e.target as HTMLSelectElement)
                  .value as ForecastUrlFormState["viewMode"];
                patchAndReload({
                  viewMode,
                  systemQuickFilter:
                    viewMode === "systemTotal" ? form.systemQuickFilter : "all",
                });
              }}
            >
              <option value="systemTotal">Запасы в целом (system)</option>
              <option value="wbTotal">WB в целом</option>
              <option value="wbWarehouses">По складам WB</option>
            </select>
          </label>
          <label class={filterField({ layout: "date" })}>
            <LabelWithInlineHelp>Дата среза</LabelWithInlineHelp>
            <input
              type="date"
              value={form.snapshotDate}
              onInput={(e) =>
                patchAndReload({
                  snapshotDate: (e.target as HTMLInputElement).value,
                })
              }
            />
          </label>
          <label class={filterField({ layout: "medium" })}>
            <LabelWithInlineHelp>
              Горизонт
              <HelpToggle label="Горизонт">
                Сколько дней вперёд учитывать в прогнозе спроса и в горизонте входящих поставок для
                строк таблицы.
              </HelpToggle>
            </LabelWithInlineHelp>
            <select
              value={form.horizonDays}
              onChange={(e) =>
                patchAndReload({ horizonDays: (e.target as HTMLSelectElement).value })
              }
            >
              <option value="30">30 дн.</option>
              <option value="60">60 дн.</option>
              <option value="90">90 дн.</option>
            </select>
          </label>
          <label class={filterField({ layout: "medium" })}>
            <LabelWithInlineHelp>
              Риск окончания
              <HelpToggle label="Риск окончания">
                Фильтр основной таблицы по бакету дней запаса: остаются только строки «хуже» выбранного
                порога. К supplier-витрине не применяется.
              </HelpToggle>
            </LabelWithInlineHelp>
            <select
              value={form.riskStockout}
              onChange={(e) =>
                patchAndReload({ riskStockout: (e.target as HTMLSelectElement).value })
              }
            >
              <option value="all">Все</option>
              <option value="lt7">&lt; 7 дн.</option>
              <option value="lt14">&lt; 14 дн.</option>
              <option value="lt30">&lt; 30 дн.</option>
              <option value="lt45">&lt; 45 дн.</option>
              <option value="lt60">&lt; 60 дн.</option>
            </select>
          </label>
          <div class={filterSearchActionGroup()}>
            <label class={filterField({ layout: "search" })}>
              <LabelWithInlineHelp>Поиск</LabelWithInlineHelp>
              <input
                type="search"
                placeholder="nm_id, артикул…"
                value={form.q}
                onInput={(e) => {
                  patch({
                    q: (e.target as HTMLInputElement).value,
                    techSize: "",
                  });
                  scheduleQReload();
                }}
              />
            </label>
            <div class="filter-load-wrap">
              <button type="submit" class="btn-load" disabled={uiBlocked}>
                {loadStatus === "loading" ? "Загрузка…" : "Загрузить"}
              </button>
              <ActionHint>
                Обновляет таблицы по текущим фильтрам и параметрам
              </ActionHint>
            </div>
          </div>
        </div>

        <div
          class={quickFiltersBar()}
          role="group"
          aria-label="Быстрые фильтры (режим system)"
        >
          <span class={cx(quickFiltersLabel(), "muted")}>Быстрый фокус</span>
          <div class={quickFiltersButtons()}>
            <button
              type="button"
              class={quickFilterChip({ active: quickActive.all })}
              title="Режим «Запасы в целом», без узкого фильтра строк"
              onClick={() => applyQuick("all")}
            >
              Все
            </button>
            <button
              type="button"
              class={quickFilterChip({ active: quickActive.systemRisk })}
              title="systemQuickFilter = systemRisk"
              onClick={() => applyQuick("systemRisk")}
            >
              Системный риск
            </button>
            <button
              type="button"
              class={quickFilterChip({ active: quickActive.wbReplenish })}
              title="systemQuickFilter = wbReplenish"
              onClick={() => applyQuick("wbReplenish")}
            >
              Нужно на WB
            </button>
            <button
              type="button"
              class={quickFilterChip({ active: quickActive.supplierOrder })}
              title="systemQuickFilter = supplierOrder"
              onClick={() => applyQuick("supplierOrder")}
            >
              Нужно заказать
            </button>
            <button
              type="button"
              class={quickFilterChip({ active: quickActive.deficitArrival })}
              title="Заказ у поставщика + риск &lt; 30 дн."
              onClick={() => applyQuick("deficitArrival")}
            >
              Дефицит до прихода
            </button>
          </div>
        </div>

        <div class={filterFormRow({ row: "secondary" })}>
          <label class={filterField({ layout: "wide" })}>
            <LabelWithInlineHelp>Склад</LabelWithInlineHelp>
            <select
              value={form.warehouseKey}
              onChange={(e) =>
                patch({ warehouseKey: (e.target as HTMLSelectElement).value })
              }
            >
              <option value="">Все</option>
              {(warehouseKeys ?? []).map((k) => (
                <option key={k} value={k}>
                  {formatWarehouseWithRegion(k, k)}
                </option>
              ))}
            </select>
          </label>
          <label class={filterField({ layout: "narrow" })}>
            <LabelWithInlineHelp>Закупка</LabelWithInlineHelp>
            <select
              value={form.replenishmentMode}
              onChange={(e) =>
                patchAndReload({
                  replenishmentMode:
                    (e.target as HTMLSelectElement).value === "supplier"
                      ? "supplier"
                      : "wb",
                })
              }
            >
              <option value="wb">WB</option>
              <option value="supplier">Производитель</option>
            </select>
          </label>
          <label class={filterField({ layout: "narrow" })}>
            <LabelWithInlineHelp>Лимит строк</LabelWithInlineHelp>
            <select
              value={form.rowLimit}
              onChange={(e) =>
                patchAndReload({ rowLimit: (e.target as HTMLSelectElement).value })
              }
            >
              <option value="250">250</option>
              <option value="500">500</option>
              <option value="1000">1000</option>
              <option value="2000">2000</option>
            </select>
          </label>
          <label class={filterField({ layout: "tech" })}>
            <LabelWithInlineHelp>Размер (techSize)</LabelWithInlineHelp>
            <input
              type="text"
              value={form.techSize}
              onInput={(e) =>
                patch({ techSize: (e.target as HTMLInputElement).value })
              }
            />
          </label>
          {form.viewMode === "systemTotal" ? (
            <label class={filterField({ layout: "medium" })}>
              <LabelWithInlineHelp>Узкий фильтр строк</LabelWithInlineHelp>
              <select
                value={form.systemQuickFilter}
                onChange={(e) =>
                  patchAndReload({
                    systemQuickFilter: (e.target as HTMLSelectElement)
                      .value as ForecastUrlFormState["systemQuickFilter"],
                  })
                }
              >
                <option value="all">Все строки</option>
                <option value="systemRisk">Системный риск</option>
                <option value="supplierOrder">Заказ у пр-ля</option>
                <option value="wbReplenish">Довоз на WB</option>
              </select>
            </label>
          ) : null}
        </div>

        <details class={calcParamsDetails()}>
          <summary class={calcParamsSummary()}>
            Параметры расчёта (покрытие, LT, безопасный запас, склад own, токен)
          </summary>
          <div class={calcParamsBody()}>
            <div class={calcParamsGrid()}>
              <label class={filterField({ layout: "narrow" })}>
                <LabelWithInlineHelp>
                  targetCoverageDays
                  <HelpToggle label="targetCoverageDays">
                    Целевое покрытие в днях для расчёта «На WB» и простой рекомендации заказа у
                    производителя (колонка «Заказать»).
                  </HelpToggle>
                </LabelWithInlineHelp>
                <select
                  value={form.targetCoverageDays}
                  onChange={(e) =>
                    patchAndReload({
                      targetCoverageDays: (e.target as HTMLSelectElement).value,
                    })
                  }
                >
                  <option value="30">30</option>
                  <option value="45">45</option>
                  <option value="60">60</option>
                </select>
              </label>
              <label class={filterField({ layout: "narrow" })}>
                <LabelWithInlineHelp>
                  leadTimeDays
                  <HelpToggle label="leadTimeDays">
                    Лид-тайм поставки в днях: используется в плане заказа с учётом прихода (колонка
                    «Заказ (LT)» в таблице закупки).
                  </HelpToggle>
                </LabelWithInlineHelp>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={form.leadTimeDays}
                  onInput={(e) =>
                    patchAndReload({ leadTimeDays: (e.target as HTMLInputElement).value })
                  }
                />
              </label>
              <label class={filterField({ layout: "narrow" })}>
                <LabelWithInlineHelp>
                  coverageDays
                  <HelpToggle label="coverageDays">
                    Покрытие после прихода партии: сколько дней спроса хотите держать на складе после
                    того, как товар прибыл (в паре с lead time для «Заказ (LT)»).
                  </HelpToggle>
                </LabelWithInlineHelp>
                <input
                  type="number"
                  min={1}
                  max={730}
                  value={form.coverageDays}
                  onInput={(e) =>
                    patchAndReload({ coverageDays: (e.target as HTMLInputElement).value })
                  }
                />
              </label>
              <label class={filterField({ layout: "narrow" })}>
                <LabelWithInlineHelp>
                  safetyDays
                  <HelpToggle label="safetyDays">
                    Дополнительный буфер в днях поверх целевого покрытия после прихода — страховой
                    запас в формуле заказа.
                  </HelpToggle>
                </LabelWithInlineHelp>
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={form.safetyDays}
                  onInput={(e) =>
                    patchAndReload({ safetyDays: (e.target as HTMLInputElement).value })
                  }
                />
              </label>
              <label class={filterField({ layout: "medium" })}>
                <LabelWithInlineHelp>ownWarehouseCode</LabelWithInlineHelp>
                <input
                  type="text"
                  value={form.ownWarehouseCode}
                  onInput={(e) =>
                    patchAndReload({
                      ownWarehouseCode: (e.target as HTMLInputElement).value,
                    })
                  }
                />
              </label>
              <label class={filterField({ layout: "spanGridFull" })}>
                <LabelWithInlineHelp>Bearer (FORECAST_UI_TOKEN)</LabelWithInlineHelp>
                <input
                  type="password"
                  autocomplete="off"
                  value={apiToken}
                  onInput={(e) =>
                    setApiToken((e.target as HTMLInputElement).value)
                  }
                />
              </label>
            </div>
          </div>
        </details>
      </form>
    </section>
  );
}
