import type { ComponentChildren } from "preact";
import type { JSX } from "preact";
import { fieldLabelRow } from "../../../styled-system/recipes";

/**
 * Строка подписи поля: текст + компактный help (`HelpToggle`).
 * См. recipes `fieldLabelRow` + `helpTrigger` / `helpPopover` в Panda.
 */
export function LabelWithInlineHelp({ children }: { children: ComponentChildren }): JSX.Element {
  return <span class={fieldLabelRow()}>{children}</span>;
}
