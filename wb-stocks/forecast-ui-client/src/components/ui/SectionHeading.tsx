import type { JSX } from "preact";
import { sectionHeading } from "../../../styled-system/recipes";
import { cn } from "./cn.js";

export type SectionHeadingProps = JSX.HTMLAttributes<HTMLHeadingElement> & {
  /** По умолчанию `h2`. */
  as?: "h2" | "h3" | "h4";
};

export function SectionHeading({
  as: Tag = "h2",
  class: className,
  children,
  ...rest
}: SectionHeadingProps): JSX.Element {
  return (
    <Tag class={cn(sectionHeading(), typeof className === "string" ? className : undefined)} {...rest}>
      {children}
    </Tag>
  );
}
