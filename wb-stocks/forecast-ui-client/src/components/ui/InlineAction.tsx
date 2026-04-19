import type { ComponentProps, JSX } from "preact";
import { inlineAction } from "../../../styled-system/recipes";
import { cn } from "./cn.js";

export type InlineActionProps = ComponentProps<"button">;

/** Компактная кнопка-действие (не основной CTA). */
export function InlineAction({
  class: className,
  type = "button",
  ...rest
}: InlineActionProps): JSX.Element {
  return (
    <button
      type={type}
      class={cn(inlineAction(), typeof className === "string" ? className : undefined)}
      {...rest}
    />
  );
}
