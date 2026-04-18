import type { ComponentChildren } from "preact";
import type { JSX } from "preact";

/** Muted one-liner under a primary action (load, export, etc.). */
export function ActionHint({ children }: { children: ComponentChildren }): JSX.Element {
  return <p class="action-hint muted">{children}</p>;
}
