import * as Popover from "@radix-ui/react-popover";
import type { JSX } from "preact";
import { css, cx } from "../../styled-system/css";
import { helpPopover, helpTrigger } from "../../styled-system/recipes";

export interface HelpToggleProps {
  /** Краткое имя для aria */
  label: string;
  /** Текст подсказки */
  children: string;
}

const popClass = cx(
  helpPopover(),
  "forecast-ui-popover-panel",
);

/**
 * Компактный inline-тригнер подсказки (клик → popover). Стили: `helpTrigger` / `helpPopover` (Panda).
 * Для redistribution «?» используйте тот же `helpTrigger` из `styled-system/recipes`.
 */
export function HelpToggle({ label, children }: HelpToggleProps): JSX.Element {
  return (
    <span
      class={css({
        display: "inline-flex",
        alignItems: "center",
        verticalAlign: "middle",
      })}
    >
      <Popover.Root modal={false}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={helpTrigger()}
            aria-label={`Подсказка: ${label}`}
            onClick={(e: MouseEvent) => e.stopPropagation()}
          >
            ⓘ
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className={popClass}
            side="bottom"
            align="start"
            sideOffset={4}
            collisionPadding={8}
            onClick={(e: MouseEvent) => e.stopPropagation()}
            role="note"
          >
            {children}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </span>
  );
}
