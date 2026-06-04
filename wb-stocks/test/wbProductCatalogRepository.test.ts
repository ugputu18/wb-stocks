import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type DbHandle } from "../src/infra/db.js";
import {
  catalogKey,
  WbProductCatalogRepository,
} from "../src/infra/wbProductCatalogRepository.js";

describe("WbProductCatalogRepository", () => {
  let db: DbHandle;
  let repo: WbProductCatalogRepository;

  beforeEach(() => {
    db = openDatabase(":memory:");
    repo = new WbProductCatalogRepository(db);
  });

  it("upserts product catalog rows by nm_id and tech_size", () => {
    repo.upsertBatch([
      {
        nmId: 1,
        techSize: "0",
        vendorCode: "SKU-1",
        category: "Пустышки",
        subject: "Соска пустышка",
        brand: "lovi",
        price: 200,
        discount: 25,
        salePrice: 150,
        updatedAt: "2026-04-17T10:00:00.000Z",
      },
    ]);
    repo.upsertBatch([
      {
        nmId: 1,
        techSize: "0",
        vendorCode: null,
        category: null,
        subject: "Соска динамическая",
        brand: null,
        price: 180,
        discount: 10,
        salePrice: 162,
        updatedAt: "2026-04-18T10:00:00.000Z",
      },
    ]);

    expect(repo.countAll()).toBe(1);
    const rows = repo.getBySkuKeys([{ nmId: 1, techSize: "0" }]);
    const row = rows.get(catalogKey(1, "0"));
    expect(row).toMatchObject({
      nmId: 1,
      techSize: "0",
      vendorCode: "SKU-1",
      category: "Пустышки",
      subject: "Соска динамическая",
      brand: "lovi",
      price: 180,
      discount: 10,
      salePrice: 162,
      updatedAt: "2026-04-18T10:00:00.000Z",
    });
  });
});
