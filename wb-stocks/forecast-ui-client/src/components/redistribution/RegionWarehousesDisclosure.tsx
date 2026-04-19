import * as Popover from "@radix-ui/react-popover";
import type { JSX } from "preact";
import { css, cx } from "../../../styled-system/css";
import { helpPopover, helpTrigger } from "../../../styled-system/recipes";
import type { DonorMacroRegionRecommendation } from "../../utils/wbRedistributionDonorModel.js";

const titleClass = css({
  margin: "0 0 0.35rem 0",
  fontSize: "0.72rem",
  fontWeight: "700",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--fu-muted, #555)",
});

const subClass = css({
  margin: "0.4rem 0 0.2rem 0",
  fontSize: "0.75rem",
  fontWeight: "600",
  color: "var(--fu-text)",
});

/** Список складов чуть шире help-текста, но без «полумодалки» */
const contentClass = cx(
  helpPopover(),
  css({
    minWidth: "min(17rem, 92vw)",
    maxWidth: "21.25rem",
    textAlign: "left",
  }),
  "forecast-ui-popover-panel",
);

/** Ненавязчивое раскрытие списка складов WB в целевом регионе (Radix Popover, клик). */
export function RegionWarehousesDisclosure({
  row,
}: {
  row: DonorMacroRegionRecommendation;
}): JSX.Element {
  const keys = row.candidateWarehouseKeys;
  const labels = row.candidateWarehouseLabels;
  const pref = row.preferredWarehouseKey;
  const n = keys.length;

  const stopRow = (e: JSX.TargetedMouseEvent<HTMLElement>) => {
    e.stopPropagation();
  };

  const pairs = keys.map((k, i) => ({
    key: k,
    label: labels[i] ?? k,
    isPreferred: pref != null && pref === k,
  }));

  const preferredPair = pref ? pairs.find((p) => p.key === pref) : undefined;
  const others = pref ? pairs.filter((p) => p.key !== pref) : pairs;

  return (
    <div
      class={css({
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
      })}
      onClick={stopRow}
    >
      <Popover.Root modal={false}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={helpTrigger()}
            title="Склады WB в целевом регионе (подсказка для логистики)"
            aria-label="Склады региона: подсказка"
            onClick={(e: MouseEvent) => {
              e.stopPropagation();
            }}
          >
            ?
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className={contentClass}
            side="bottom"
            align="start"
            sideOffset={4}
            collisionPadding={8}
            role="region"
            aria-label="Склады региона"
            onClick={(e: MouseEvent) => e.stopPropagation()}
          >
            <p class={titleClass}>Склады региона</p>
            {n === 0 ? (
              <p class="muted redistribution-warehouses-popover-empty">
                По маппингу складов нет строк в этой сети для выбранного региона.
              </p>
            ) : n === 1 ? (
              <p class="redistribution-warehouses-popover-line">
                <span class="redistribution-warehouses-k">Единственный склад в регионе по сети SKU:</span>{" "}
                <span>{pairs[0].label}</span>
                <span class="muted wb-redistribution-key"> {pairs[0].key}</span>
              </p>
            ) : (
              <>
                {preferredPair ? (
                  <>
                    <p class={subClass}>Рекомендуемый склад</p>
                    <p class="redistribution-warehouses-popover-line redistribution-warehouses-preferred">
                      <span>{preferredPair.label}</span>
                      <span class="muted wb-redistribution-key"> {preferredPair.key}</span>
                    </p>
                    <p class="muted redistribution-warehouses-why">
                      Наибольшее значение «На WB» среди складов региона в этой сети по SKU — удобная точка
                      довоза, не лимит перераспределения.
                    </p>
                  </>
                ) : null}
                {others.length > 0 ? (
                  <>
                    <p class={subClass}>{preferredPair ? "Другие склады" : "Склады региона"}</p>
                    <ul class="redistribution-warehouses-list">
                      {others.map((p) => (
                        <li key={p.key}>
                          {p.label}
                          <span class="muted wb-redistribution-key"> {p.key}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
