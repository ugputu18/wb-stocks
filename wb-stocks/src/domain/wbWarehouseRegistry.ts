/**
 * Справочник складов WB для redistribution и смежных сценариев: исполнение на уровне склада,
 * агрегация — на уровне {@link WbWarehouseRegistryEntry.macroRegion}.
 *
 * Источник ключей и макрорегионов: {@link ./wbWarehouseMacroRegionData.js}.
 */

import { normalizeWarehouseName } from "./warehouseName.js";
import { WB_WAREHOUSE_MACRO_REGION_BY_KEY } from "./wbWarehouseMacroRegionData.js";

export type WbWarehouseCountryCode =
  | "RU"
  | "BY"
  | "KZ"
  | "AM"
  | "KG"
  | "UZ"
  | "TJ";

/**
 * Запись реестра: один канонический `warehouseKey` (после normalizeWarehouseName).
 */
export type WbWarehouseRegistryEntry = {
  readonly warehouseKey: string;
  readonly displayName: string;
  readonly macroRegion: string;
  readonly country: WbWarehouseCountryCode;
  readonly isVirtual: boolean;
  readonly isSortingCenter: boolean;
  readonly canBeRedistributionTarget: boolean;
  readonly canBeRedistributionDonor: boolean;
  readonly wbAcceptsInboundForRedistribution: boolean;
  readonly priorityWithinMacro?: number;
  readonly aliases?: readonly string[];
};

function macroToCountry(macro: string): WbWarehouseCountryCode {
  switch (macro) {
    case "Беларусь":
      return "BY";
    case "Казахстан":
      return "KZ";
    case "Армения":
      return "AM";
    case "Киргизия":
      return "KG";
    case "Узбекистан":
      return "UZ";
    case "Таджикистан":
      return "TJ";
    default:
      return "RU";
  }
}

function inferIsVirtual(normalizedKey: string): boolean {
  return normalizedKey.startsWith("виртуальный ");
}

function inferIsSortingCenter(normalizedKey: string): boolean {
  return normalizedKey.startsWith("сц ");
}

function defaultDisplayName(normalizedKey: string): string {
  return normalizedKey
    .split(/(\s+)/)
    .map((seg) => {
      if (/^\s+$/.test(seg)) return seg;
      if (seg.length === 0) return seg;
      const head = seg.codePointAt(0);
      if (head === undefined) return seg;
      return String.fromCodePoint(head).toUpperCase() + seg.slice(1);
    })
    .join("");
}

/**
 * Точечные правки поверх эвристик (редко).
 */
const WAREHOUSE_REGISTRY_OVERRIDES: Readonly<
  Record<string, Partial<Omit<WbWarehouseRegistryEntry, "warehouseKey" | "macroRegion">>>
> = {};

function buildEntry(normalizedKey: string, macroRegion: string): WbWarehouseRegistryEntry {
  const isVirtual = inferIsVirtual(normalizedKey);
  const isSortingCenter = inferIsSortingCenter(normalizedKey);
  const o = WAREHOUSE_REGISTRY_OVERRIDES[normalizedKey];
  const canBeRedistributionDonor = o?.canBeRedistributionDonor ?? !isVirtual;
  const canBeRedistributionTarget =
    o?.canBeRedistributionTarget ?? (!isVirtual && !isSortingCenter);
  const wbAcceptsInboundForRedistribution =
    o?.wbAcceptsInboundForRedistribution ?? canBeRedistributionTarget;
  const base: WbWarehouseRegistryEntry = {
    warehouseKey: normalizedKey,
    displayName: o?.displayName ?? defaultDisplayName(normalizedKey),
    macroRegion,
    country: o?.country ?? macroToCountry(macroRegion),
    isVirtual: o?.isVirtual ?? isVirtual,
    isSortingCenter: o?.isSortingCenter ?? isSortingCenter,
    canBeRedistributionDonor,
    canBeRedistributionTarget,
    wbAcceptsInboundForRedistribution,
  };
  return {
    ...base,
    ...(o?.priorityWithinMacro !== undefined ? { priorityWithinMacro: o.priorityWithinMacro } : {}),
    ...(o?.aliases !== undefined ? { aliases: o.aliases } : {}),
  };
}

function buildRegistry(): Readonly<Record<string, WbWarehouseRegistryEntry>> {
  const out: Record<string, WbWarehouseRegistryEntry> = {};
  for (const [k, macro] of Object.entries(WB_WAREHOUSE_MACRO_REGION_BY_KEY)) {
    out[k] = buildEntry(k, macro);
  }
  return Object.freeze(out);
}

export const WB_WAREHOUSE_REGISTRY = buildRegistry();

/** Проекция реестра для обратной совместимости с `warehouse_key` → макрорегион. */
export const WB_WAREHOUSE_MACRO_REGION: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(WB_WAREHOUSE_REGISTRY).map(([k, v]) => [k, v.macroRegion])),
);

export const WB_MACRO_REGION_COVERED_WAREHOUSE_KEYS = Object.freeze(
  Object.keys(WB_WAREHOUSE_REGISTRY),
);

/**
 * Дополнительные синонимы API/выгрузок → канонический ключ реестра (уже после normalizeWarehouseName).
 * Ключи-алиасы не должны дублировать прямые ключи {@link WB_WAREHOUSE_REGISTRY} (иначе сработает прямой hit).
 */
const STATIC_ALIASES_TO_CANONICAL: Readonly<Record<string, string>> = Object.freeze({
  спб: "санкт-петербург",
  /** Подтверждённые варианты из данных / UI → канон из справочника. */
  атакент: "алматы атакент",
  "ск ереван": "ереван",
  "сц ереван": "ереван",
  "ташкент 2": "ташкент",
  "сц шушары": "шушары",
});

const ALIAS_TO_CANONICAL: Readonly<Record<string, string>> = (() => {
  const m: Record<string, string> = { ...STATIC_ALIASES_TO_CANONICAL };
  for (const e of Object.values(WB_WAREHOUSE_REGISTRY)) {
    if (!e.aliases?.length) continue;
    for (const a of e.aliases) {
      const ak = normalizeWarehouseName(a);
      if (ak && ak !== e.warehouseKey) m[ak] = e.warehouseKey;
    }
  }
  return Object.freeze(m);
})();

export function getWarehouseRegistryEntry(
  warehouseKey: string | null | undefined,
): WbWarehouseRegistryEntry | null {
  const k = normalizeWarehouseName(warehouseKey ?? "");
  if (k === "" || k === "<unknown>") return null;
  const direct = WB_WAREHOUSE_REGISTRY[k];
  if (direct) return direct;
  const canon = ALIAS_TO_CANONICAL[k];
  return canon ? (WB_WAREHOUSE_REGISTRY[canon] ?? null) : null;
}

/** Учёт остатков в регионе: виртуальные склады не суммируем (не слой исполнения). */
export function warehouseContributesToRegionalAvailabilityStock(
  entry: WbWarehouseRegistryEntry | null,
  normalizedWarehouseKey: string,
): boolean {
  const virt = entry?.isVirtual ?? inferIsVirtual(normalizedWarehouseKey);
  return !virt;
}

export type RedistributionTargetPickMode = "macro" | "warehouse";

/** Hard filters для склада из реестра (без legacy «нет записи»). Удобно для unit-тестов. */
export function passesRegisteredWarehouseExecutionHardFilters(
  entry: WbWarehouseRegistryEntry,
): boolean {
  if (entry.isVirtual || entry.isSortingCenter) return false;
  if (!entry.canBeRedistributionTarget) return false;
  if (!entry.wbAcceptsInboundForRedistribution) return false;
  return true;
}

/**
 * Склад как конечная точка перераспределения (исполнение).
 * Hard filters (отдельно от ranking): не виртуальный, не СЦ, цель разрешена, WB принимает inbound.
 *
 * - `warehouse` (fulfillment): только записи реестра; неизвестный ключ — не execution target.
 * - `macro`: как и раньше — только записи реестра, прошедшие фильтры (`entry == null` → false).
 */
export function isWarehouseRedistributionExecutionTarget(
  entry: WbWarehouseRegistryEntry | null,
  mode: RedistributionTargetPickMode,
): boolean {
  if (entry == null) return false;
  return passesRegisteredWarehouseExecutionHardFilters(entry);
}

export function isWarehouseRedistributionDonorEligible(
  entry: WbWarehouseRegistryEntry | null,
): boolean {
  if (entry == null) return true;
  return entry.canBeRedistributionDonor;
}
