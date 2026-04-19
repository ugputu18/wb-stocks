import type { JSX } from "preact";
import { scrollTableWrap } from "../../../styled-system/recipes";
import { cn } from "./cn.js";

export function ScrollTableWrap({
  class: className,
  children,
  ...rest
}: JSX.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      class={cn(scrollTableWrap(), typeof className === "string" ? className : undefined)}
      {...rest}
    >
      {children}
    </div>
  );
}
