import type { JSX } from "preact";
import { denseDataTable } from "../../../styled-system/recipes";
import { cn } from "./cn.js";

export type DenseDataTableProps = Omit<JSX.HTMLAttributes<HTMLTableElement>, "class"> & {
  class?: string;
};

/** Плотная таблица поверх базовых правил `.wb-redistribution-table` в теме. */
export function DenseDataTable({
  class: className,
  children,
  ...rest
}: DenseDataTableProps): JSX.Element {
  return (
    <table
      class={cn(
        "wb-redistribution-table",
        denseDataTable(),
        typeof className === "string" ? className : undefined,
      )}
      {...rest}
    >
      {children}
    </table>
  );
}
