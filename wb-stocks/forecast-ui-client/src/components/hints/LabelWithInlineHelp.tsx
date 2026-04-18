import type { ComponentChildren } from "preact";
import type { JSX } from "preact";

/** Wraps a field label plus inline help control (e.g. HelpToggle). */
export function LabelWithInlineHelp({ children }: { children: ComponentChildren }): JSX.Element {
  return <span class="label-with-help">{children}</span>;
}
