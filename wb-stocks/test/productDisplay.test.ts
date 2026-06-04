import { describe, expect, it } from "vitest";
import {
  formatProductBrandLabel,
  formatProductNameLabel,
} from "../src/application/productDisplay.js";

describe("product display labels", () => {
  it("shortens known WB brand and subject names", () => {
    expect(formatProductBrandLabel("Canpol Babies")).toBe("Canpol");
    expect(formatProductBrandLabel("canpol babies")).toBe("Canpol");
    expect(formatProductBrandLabel("lovi")).toBe("lovi");

    expect(formatProductNameLabel("Бутылочки для кормления")).toBe("Бутылочки");
    expect(formatProductNameLabel("Прокладки гигиенические")).toBe("Прокладки");
    expect(formatProductNameLabel("Ложки для прикорма")).toBe("Ложки");
    expect(formatProductNameLabel("Переносные души-биде")).toBe("Души-биде");
    expect(formatProductNameLabel("Накладки на соски для кормления")).toBe(
      "Накладки на соски",
    );
    expect(formatProductNameLabel("Трусы одноразовые")).toBe("Трусы одн.");
    expect(formatProductNameLabel("Контейнеры для детского питания")).toBe(
      "Контейнеры",
    );
    expect(formatProductNameLabel("Наборы для кормления")).toBe("Наборы");
    expect(formatProductNameLabel("Салфетки сервировочные")).toBe("Салфетки");
  });
});
