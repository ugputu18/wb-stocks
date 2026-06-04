const BRAND_LABELS = new Map<string, string>([
  [normalizeLabelKey("Canpol Babies"), "Canpol"],
]);

const PRODUCT_LABELS = new Map<string, string>([
  [normalizeLabelKey("Бутылочки для кормления"), "Бутылочки"],
  [normalizeLabelKey("Прокладки гигиенические"), "Прокладки"],
  [normalizeLabelKey("Ложки для прикорма"), "Ложки"],
  [normalizeLabelKey("Переносные души-биде"), "Души-биде"],
  [normalizeLabelKey("Накладки на соски для кормления"), "Накладки на соски"],
  [normalizeLabelKey("Трусы одноразовые"), "Трусы одн."],
  [normalizeLabelKey("Контейнеры для детского питания"), "Контейнеры"],
  [normalizeLabelKey("Наборы для кормления"), "Наборы"],
  [normalizeLabelKey("Салфетки сервировочные"), "Салфетки"],
]);

export function formatProductBrandLabel(value: string | null | undefined): string {
  return formatCatalogLabel(value, BRAND_LABELS);
}

export function formatProductNameLabel(value: string | null | undefined): string {
  return formatCatalogLabel(value, PRODUCT_LABELS);
}

function formatCatalogLabel(
  value: string | null | undefined,
  replacements: ReadonlyMap<string, string>,
): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  return replacements.get(normalizeLabelKey(trimmed)) ?? trimmed;
}

function normalizeLabelKey(value: string): string {
  return value.trim().toLocaleLowerCase("ru");
}
