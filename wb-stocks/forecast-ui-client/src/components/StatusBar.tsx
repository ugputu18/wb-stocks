import type { JSX } from "preact";

export interface StatusBarProps {
  statusLine: string;
  statusTone: "default" | "error";
}

export function StatusBar(props: StatusBarProps): JSX.Element {
  const { statusLine, statusTone } = props;

  return (
    <section class="panel">
      <h2>Статус</h2>
      <p
        id="status"
        class={statusTone === "error" ? "forecast-next-error" : "muted"}
        aria-live="polite"
      >
        {statusLine}
      </p>
    </section>
  );
}
