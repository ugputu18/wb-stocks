import type { JSX } from "preact";
import { panel } from "../../../styled-system/recipes";
import type { PanelVariantProps } from "../../../styled-system/recipes/panel";
import { cn } from "./cn.js";

export type PanelProps = Omit<JSX.HTMLAttributes<HTMLElement>, "class"> & {
  class?: string;
  padding?: PanelVariantProps["padding"];
};

/** Панель секции: Panda recipe `panel` (визуально согласована с legacy `.panel` в теме). */
export function Panel({ class: className, padding, children, ...rest }: PanelProps): JSX.Element {
  return (
    <section
      class={cn(
        panel({ padding: padding ?? "md" }),
        typeof className === "string" ? className : undefined,
      )}
      {...rest}
    >
      {children}
    </section>
  );
}
