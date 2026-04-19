import type { JSX } from "preact";
import { badge } from "../../../styled-system/recipes";
import type { BadgeVariantProps } from "../../../styled-system/recipes/badge";
import { cn } from "./cn.js";

export type BadgeProps = JSX.HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeVariantProps["tone"];
};

export function Badge({ class: className, tone, children, ...rest }: BadgeProps): JSX.Element {
  const extra = typeof className === "string" ? className : undefined;
  return (
    <span class={cn(badge({ tone }), extra)} {...rest}>
      {children}
    </span>
  );
}
