import * as Popover from "@radix-ui/react-popover";
import type { ComponentChildren, JSX } from "preact";
import { popoverSurface } from "../../../styled-system/recipes";
import { cn } from "./cn.js";

export type PopoverInfoProps = {
  /** Элемент триггера (один корневой узел для `asChild`). */
  trigger: JSX.Element;
  children: ComponentChildren;
  /** Управляемое открытие (опционально). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
  contentClassName?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
};

/**
 * Кликабельный popover (Radix). Не hover-only.
 * Нейтральная обёртка: контент задаётся потребителем.
 */
export function PopoverInfo({
  trigger,
  children,
  open,
  onOpenChange,
  modal = false,
  contentClassName,
  side = "bottom",
  align = "start",
  sideOffset = 6,
}: PopoverInfoProps): JSX.Element {
  return (
    <Popover.Root modal={modal} open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
          className={cn(
            popoverSurface(),
            "forecast-ui-popover-panel",
            typeof contentClassName === "string" ? contentClassName : undefined,
          )}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
