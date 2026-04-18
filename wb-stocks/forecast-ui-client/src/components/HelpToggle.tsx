import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";

export interface HelpToggleProps {
  /** Краткое имя для aria */
  label: string;
  /** Текст подсказки */
  children: string;
}

/** Кнопка ⓘ: клик открывает/закрывает подсказку; клик вне — закрывает. Без модалок и hover-only. */
export function HelpToggle({ label, children }: HelpToggleProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", onDoc, true);
    return () => document.removeEventListener("click", onDoc, true);
  }, [open]);

  const toggle = useCallback((e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen((v) => !v);
  }, []);

  return (
    <span class="help-toggle" ref={rootRef}>
      <button
        type="button"
        class="help-toggle-btn"
        aria-label={`Подсказка: ${label}`}
        aria-expanded={open}
        onClick={toggle}
      >
        ⓘ
      </button>
      {open ? (
        <span class="help-toggle-pop" role="note">
          {children}
        </span>
      ) : null}
    </span>
  );
}
