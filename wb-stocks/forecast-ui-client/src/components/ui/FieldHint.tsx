import type { JSX } from "preact";
import { fieldHint } from "../../../styled-system/recipes";
import { cn } from "./cn.js";

export type FieldHintProps = JSX.HTMLAttributes<HTMLSpanElement>;

/** Подпись-подсказка под полем (muted). */
export function FieldHint({ class: className, children, ...rest }: FieldHintProps): JSX.Element {
  return (
    <span class={cn(fieldHint(), typeof className === "string" ? className : undefined)} {...rest}>
      {children}
    </span>
  );
}
