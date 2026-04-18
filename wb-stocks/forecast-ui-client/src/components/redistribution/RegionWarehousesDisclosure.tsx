import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { DonorMacroRegionRecommendation } from "../../utils/wbRedistributionDonorModel.js";

/** Ненавязчивое раскрытие списка складов WB в целевом макрорегионе (operational hint). */
export function RegionWarehousesDisclosure({
  row,
}: {
  row: DonorMacroRegionRecommendation;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const el = wrapRef.current;
      if (!el || el.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown, true);
    return () => document.removeEventListener("mousedown", onDocDown, true);
  }, [open]);

  const keys = row.candidateWarehouseKeys;
  const labels = row.candidateWarehouseLabels;
  const pref = row.preferredWarehouseKey;
  const n = keys.length;

  const stopRow = (e: JSX.TargetedMouseEvent<HTMLElement>) => {
    e.stopPropagation();
  };

  const toggle = (e: JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    setOpen((v) => !v);
  };

  const pairs = keys.map((k, i) => ({
    key: k,
    label: labels[i] ?? k,
    isPreferred: pref != null && pref === k,
  }));

  const preferredPair = pref ? pairs.find((p) => p.key === pref) : undefined;
  const others = pref ? pairs.filter((p) => p.key !== pref) : pairs;

  return (
    <div ref={wrapRef} class="redistribution-warehouses-disclosure" onClick={stopRow}>
      <button
        type="button"
        class="redistribution-warehouses-trigger"
        aria-expanded={open}
        title="Склады WB в целевом регионе (подсказка для логистики)"
        onClick={toggle}
      >
        Склады
      </button>
      {open ? (
        <div
          class="redistribution-warehouses-popover"
          role="region"
          aria-label="Склады региона"
        >
          <p class="redistribution-warehouses-popover-title">Склады региона</p>
          {n === 0 ? (
            <p class="muted redistribution-warehouses-popover-empty">
              По маппингу складов нет строк в этой сети для выбранного макрорегиона.
            </p>
          ) : n === 1 ? (
            <p class="redistribution-warehouses-popover-line">
              <span class="redistribution-warehouses-k">Единственный склад в регионе по сети SKU:</span>{" "}
              <span>{pairs[0].label}</span>
              <span class="muted wb-redistribution-key"> {pairs[0].key}</span>
            </p>
          ) : (
            <>
              {preferredPair ? (
                <>
                  <p class="redistribution-warehouses-sub">Рекомендуемый склад</p>
                  <p class="redistribution-warehouses-popover-line redistribution-warehouses-preferred">
                    <span>{preferredPair.label}</span>
                    <span class="muted wb-redistribution-key"> {preferredPair.key}</span>
                  </p>
                  <p class="muted redistribution-warehouses-why">
                    Наибольшее значение «На WB» среди складов региона в этой сети по SKU — удобная точка
                    довоза, не лимит перераспределения.
                  </p>
                </>
              ) : null}
              {others.length > 0 ? (
                <>
                  <p class="redistribution-warehouses-sub">
                    {preferredPair ? "Другие склады" : "Склады региона"}
                  </p>
                  <ul class="redistribution-warehouses-list">
                    {others.map((p) => (
                      <li key={p.key}>
                        {p.label}
                        <span class="muted wb-redistribution-key"> {p.key}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
