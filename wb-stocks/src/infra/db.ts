import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type DbHandle = Database.Database;

const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS wb_stock_snapshots (
     id                  INTEGER PRIMARY KEY AUTOINCREMENT,
     snapshot_at         TEXT    NOT NULL,
     nm_id               INTEGER NOT NULL,
     vendor_code         TEXT,
     barcode             TEXT,
     tech_size           TEXT,
     warehouse_name      TEXT    NOT NULL,
     quantity            INTEGER NOT NULL,
     in_way_to_client    INTEGER,
     in_way_from_client  INTEGER,
     quantity_full       INTEGER,
     last_change_date    TEXT
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_wb_stock_snapshots_key
     ON wb_stock_snapshots (
       snapshot_at,
       nm_id,
       COALESCE(barcode, ''),
       COALESCE(tech_size, ''),
       warehouse_name
     )`,
  `CREATE INDEX IF NOT EXISTS ix_wb_stock_snapshots_snapshot_at
     ON wb_stock_snapshots (snapshot_at)`,
  `CREATE INDEX IF NOT EXISTS ix_wb_stock_snapshots_nm_id
     ON wb_stock_snapshots (nm_id)`,
  `CREATE TABLE IF NOT EXISTS own_stock_snapshots (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     snapshot_date   TEXT    NOT NULL,
     warehouse_code  TEXT    NOT NULL,
     vendor_code     TEXT    NOT NULL,
     quantity        INTEGER NOT NULL,
     source_file     TEXT,
     imported_at     TEXT    NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_own_stock_snapshots_key
     ON own_stock_snapshots (snapshot_date, warehouse_code, vendor_code)`,
  `CREATE INDEX IF NOT EXISTS ix_own_stock_snapshots_date_wh
     ON own_stock_snapshots (snapshot_date, warehouse_code)`,
  `CREATE TABLE IF NOT EXISTS wb_supplies (
     supply_id                  INTEGER PRIMARY KEY,
     preorder_id                INTEGER,
     phone                      TEXT,
     create_date                TEXT,
     supply_date                TEXT,
     fact_date                  TEXT,
     updated_date               TEXT,
     status_id                  INTEGER NOT NULL,
     box_type_id                INTEGER,
     virtual_type_id            INTEGER,
     is_box_on_pallet           INTEGER,
     warehouse_id               INTEGER,
     warehouse_name             TEXT,
     actual_warehouse_id        INTEGER,
     actual_warehouse_name      TEXT,
     quantity                   INTEGER,
     accepted_quantity          INTEGER,
     unloading_quantity         INTEGER,
     ready_for_sale_quantity    INTEGER,
     depersonalized_quantity    INTEGER,
     first_seen_at              TEXT    NOT NULL,
     last_seen_at               TEXT    NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS ix_wb_supplies_status_id
     ON wb_supplies (status_id)`,
  `CREATE INDEX IF NOT EXISTS ix_wb_supplies_fact_date
     ON wb_supplies (fact_date)`,
  `CREATE INDEX IF NOT EXISTS ix_wb_supplies_warehouse
     ON wb_supplies (warehouse_id)`,
  `CREATE TABLE IF NOT EXISTS wb_supply_items (
     id                      INTEGER PRIMARY KEY AUTOINCREMENT,
     supply_id               INTEGER NOT NULL,
     barcode                 TEXT,
     vendor_code             TEXT,
     nm_id                   INTEGER NOT NULL,
     tech_size               TEXT,
     color                   TEXT,
     quantity                INTEGER,
     accepted_quantity       INTEGER,
     ready_for_sale_quantity INTEGER,
     unloading_quantity      INTEGER,
     FOREIGN KEY (supply_id) REFERENCES wb_supplies(supply_id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS ix_wb_supply_items_supply_id
     ON wb_supply_items (supply_id)`,
  `CREATE INDEX IF NOT EXISTS ix_wb_supply_items_nm_id
     ON wb_supply_items (nm_id)`,
  `CREATE TABLE IF NOT EXISTS wb_supply_status_history (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     supply_id   INTEGER NOT NULL,
     status_id   INTEGER NOT NULL,
     fact_date   TEXT,
     changed_at  TEXT    NOT NULL,
     FOREIGN KEY (supply_id) REFERENCES wb_supplies(supply_id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS ix_wb_supply_status_history_sup
     ON wb_supply_status_history (supply_id, changed_at)`,
  `CREATE TABLE IF NOT EXISTS wb_orders_daily (
     id                 INTEGER PRIMARY KEY AUTOINCREMENT,
     order_date         TEXT    NOT NULL,
     warehouse_name_raw TEXT,
     warehouse_key      TEXT    NOT NULL,
     nm_id              INTEGER NOT NULL,
     tech_size          TEXT    NOT NULL,
     vendor_code        TEXT,
     barcode            TEXT,
     units              INTEGER NOT NULL,
     cancelled_units    INTEGER NOT NULL DEFAULT 0,
     gross_units        INTEGER NOT NULL,
     first_seen_at      TEXT    NOT NULL,
     last_seen_at       TEXT    NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_wb_orders_daily_key
     ON wb_orders_daily (order_date, warehouse_key, nm_id, tech_size)`,
  `CREATE INDEX IF NOT EXISTS ix_wb_orders_daily_date
     ON wb_orders_daily (order_date)`,
  `CREATE INDEX IF NOT EXISTS ix_wb_orders_daily_nm_id
     ON wb_orders_daily (nm_id)`,
  `CREATE INDEX IF NOT EXISTS ix_wb_orders_daily_warehouse
     ON wb_orders_daily (warehouse_key)`,
  `CREATE TABLE IF NOT EXISTS wb_demand_snapshots (
     id                     INTEGER PRIMARY KEY AUTOINCREMENT,
     snapshot_date          TEXT    NOT NULL,
     warehouse_name_raw     TEXT,
     warehouse_key          TEXT    NOT NULL,
     nm_id                  INTEGER NOT NULL,
     tech_size              TEXT    NOT NULL,
     vendor_code            TEXT,
     barcode                TEXT,
     units7                 INTEGER NOT NULL,
     units30                INTEGER NOT NULL,
     units90                INTEGER NOT NULL DEFAULT 0,
     avg_daily_7            REAL    NOT NULL,
     avg_daily_30           REAL    NOT NULL,
     avg_daily_90           REAL    NOT NULL DEFAULT 0,
     base_daily_demand      REAL    NOT NULL,
     trend_ratio            REAL    NOT NULL,
     trend_ratio_clamped    REAL    NOT NULL,
     forecast_daily_demand  REAL    NOT NULL,
     computed_at            TEXT    NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_wb_demand_snapshots_key
     ON wb_demand_snapshots (snapshot_date, warehouse_key, nm_id, tech_size)`,
  `CREATE INDEX IF NOT EXISTS ix_wb_demand_snapshots_date
     ON wb_demand_snapshots (snapshot_date)`,
  `CREATE INDEX IF NOT EXISTS ix_wb_demand_snapshots_nm_id
     ON wb_demand_snapshots (nm_id)`,
  `CREATE INDEX IF NOT EXISTS ix_wb_demand_snapshots_warehouse
     ON wb_demand_snapshots (warehouse_key)`,
  `CREATE TABLE IF NOT EXISTS wb_forecast_snapshots (
     id                     INTEGER PRIMARY KEY AUTOINCREMENT,
     snapshot_date          TEXT    NOT NULL,
     horizon_days           INTEGER NOT NULL,
     warehouse_name_raw     TEXT,
     warehouse_key          TEXT    NOT NULL,
     nm_id                  INTEGER NOT NULL,
     tech_size              TEXT    NOT NULL,
     vendor_code            TEXT,
     barcode                TEXT,
     units7                 INTEGER NOT NULL,
     units30                INTEGER NOT NULL,
     units90                INTEGER NOT NULL DEFAULT 0,
     avg_daily_7            REAL    NOT NULL,
     avg_daily_30           REAL    NOT NULL,
     avg_daily_90           REAL    NOT NULL DEFAULT 0,
     base_daily_demand      REAL    NOT NULL,
     trend_ratio            REAL    NOT NULL,
     trend_ratio_clamped    REAL    NOT NULL,
     forecast_daily_demand  REAL    NOT NULL,
     stock_snapshot_at      TEXT    NOT NULL,
     start_stock            INTEGER NOT NULL,
     incoming_units         INTEGER NOT NULL,
     forecast_units         REAL    NOT NULL,
     end_stock              REAL    NOT NULL,
     days_of_stock          INTEGER NOT NULL,
     stockout_date          TEXT,
     computed_at            TEXT    NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_wb_forecast_snapshots_key
     ON wb_forecast_snapshots (
       snapshot_date, horizon_days, warehouse_key, nm_id, tech_size
     )`,
  `CREATE INDEX IF NOT EXISTS ix_wb_forecast_snapshots_date
     ON wb_forecast_snapshots (snapshot_date)`,
  `CREATE INDEX IF NOT EXISTS ix_wb_forecast_snapshots_horizon
     ON wb_forecast_snapshots (snapshot_date, horizon_days)`,
  `CREATE INDEX IF NOT EXISTS ix_wb_forecast_snapshots_nm_id
     ON wb_forecast_snapshots (nm_id)`,
  `CREATE INDEX IF NOT EXISTS ix_wb_forecast_snapshots_warehouse
     ON wb_forecast_snapshots (warehouse_key)`,
  `CREATE TABLE IF NOT EXISTS wb_orders_daily_by_region (
     id                 INTEGER PRIMARY KEY AUTOINCREMENT,
     order_date         TEXT    NOT NULL,
     region_name_raw    TEXT,
     region_key         TEXT    NOT NULL,
     nm_id              INTEGER NOT NULL,
     tech_size          TEXT    NOT NULL,
     vendor_code        TEXT,
     barcode            TEXT,
     units              INTEGER NOT NULL,
     cancelled_units    INTEGER NOT NULL DEFAULT 0,
     gross_units        INTEGER NOT NULL,
     first_seen_at      TEXT    NOT NULL,
     last_seen_at       TEXT    NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_wb_orders_daily_by_region_key
     ON wb_orders_daily_by_region (order_date, region_key, nm_id, tech_size)`,
  `CREATE INDEX IF NOT EXISTS ix_wb_orders_daily_by_region_date
     ON wb_orders_daily_by_region (order_date)`,
  `CREATE INDEX IF NOT EXISTS ix_wb_orders_daily_by_region_nm_id
     ON wb_orders_daily_by_region (nm_id)`,
  `CREATE TABLE IF NOT EXISTS wb_region_demand_snapshots (
     id                     INTEGER PRIMARY KEY AUTOINCREMENT,
     snapshot_date          TEXT    NOT NULL,
     region_name_raw        TEXT,
     region_key             TEXT    NOT NULL,
     nm_id                  INTEGER NOT NULL,
     tech_size              TEXT    NOT NULL,
     vendor_code            TEXT,
     barcode                TEXT,
     units7                 INTEGER NOT NULL,
     units30                INTEGER NOT NULL,
     units90                INTEGER NOT NULL DEFAULT 0,
     avg_daily_7            REAL    NOT NULL,
     avg_daily_30           REAL    NOT NULL,
     avg_daily_90           REAL    NOT NULL DEFAULT 0,
     base_daily_demand      REAL    NOT NULL,
     trend_ratio            REAL    NOT NULL,
     trend_ratio_clamped    REAL    NOT NULL,
     regional_forecast_daily_demand REAL NOT NULL,
     computed_at            TEXT    NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_wb_region_demand_snapshots_key
     ON wb_region_demand_snapshots (snapshot_date, region_key, nm_id, tech_size)`,
  `CREATE INDEX IF NOT EXISTS ix_wb_region_demand_snapshots_date
     ON wb_region_demand_snapshots (snapshot_date)`,
  `CREATE INDEX IF NOT EXISTS ix_wb_region_demand_snapshots_nm_id
     ON wb_region_demand_snapshots (nm_id)`,
  `CREATE TABLE IF NOT EXISTS wb_region_macro_region (
     region_key   TEXT PRIMARY KEY,
     macro_region TEXT NOT NULL
   )`,
];

export function openDatabase(path: string): DbHandle {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  migrateDemandWindowColumns(db);
  migrateRegionDemandSnapshotColumn(db);
  return db;
}

/** Старые БД: добавляем 90-дневные поля спроса без backfill исторических срезов. */
function migrateDemandWindowColumns(db: DbHandle): void {
  ensureColumn(db, "wb_demand_snapshots", "units90", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "wb_demand_snapshots", "avg_daily_90", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "wb_forecast_snapshots", "units90", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "wb_forecast_snapshots", "avg_daily_90", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "wb_region_demand_snapshots", "units90", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "wb_region_demand_snapshots", "avg_daily_90", "REAL NOT NULL DEFAULT 0");
}

function ensureColumn(
  db: DbHandle,
  table: string,
  column: string,
  definition: string,
): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (rows.some((r) => r.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/** Старые БД: колонка `forecast_daily_demand` → `regional_forecast_daily_demand`. */
function migrateRegionDemandSnapshotColumn(db: DbHandle): void {
  const rows = db
    .prepare("PRAGMA table_info(wb_region_demand_snapshots)")
    .all() as { name: string }[];
  const names = new Set(rows.map((r) => r.name));
  if (names.has("forecast_daily_demand") && !names.has("regional_forecast_daily_demand")) {
    db.exec(
      `ALTER TABLE wb_region_demand_snapshots RENAME COLUMN forecast_daily_demand TO regional_forecast_daily_demand`,
    );
  }
}

function runMigrations(db: DbHandle): void {
  const tx = db.transaction(() => {
    for (const stmt of MIGRATIONS) {
      db.exec(stmt);
    }
  });
  tx();
}
