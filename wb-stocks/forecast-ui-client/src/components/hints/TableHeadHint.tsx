import type { JSX } from "preact";

/** Short muted caption in the second header row of data tables. */
export function ColHintText({ children = "" }: { children?: string }): JSX.Element {
  return <span class="col-hint">{children}</span>;
}

/** `<th>` for a thead hint row — pairs with `.thead-hint-row`. */
export function TableHeadHintCell({ children = "" }: { children?: string }): JSX.Element {
  return (
    <th class="th-hint" scope="col">
      <ColHintText>{children}</ColHintText>
    </th>
  );
}
