import type { Logger } from "pino";
import type { WbCommonClient } from "../infra/wbCommonClient.js";
import type { WbWarehouseTariffRepository } from "../infra/wbWarehouseTariffRepository.js";
import {
  mapAcceptanceCoefficient,
  mapBoxTariffEnvelope,
  mapPalletTariffEnvelope,
} from "./mapWbWarehouseTariff.js";

export interface ImportWbWarehouseTariffsDeps {
  wbClient: WbCommonClient;
  repository: WbWarehouseTariffRepository;
  logger: Logger;
  /** Override for tests; defaults to () => new Date(). */
  now?: () => Date;
}

export interface ImportWbWarehouseTariffsOptions {
  /**
   * `date=` query parameter for the box & pallet endpoints (YYYY-MM-DD).
   * Defaults to today's UTC date. WB returns the tariff schedule effective
   * for that date; using "today" gives the currently-applicable tariff.
   */
  tariffDate?: string;
  /** Skip the box tariff call. */
  skipBox?: boolean;
  /** Skip the pallet tariff call. */
  skipPallet?: boolean;
  /** Skip the acceptance coefficients call. */
  skipAcceptance?: boolean;
  /**
   * Restrict acceptance endpoint to specific warehouses. Empty/undefined
   * = all warehouses (default WB behavior).
   */
  warehouseIds?: readonly number[];
  /** If true, log everything but do not write to DB. */
  dryRun?: boolean;
}

export interface ImportWbWarehouseTariffsResult {
  fetchedAt: string;
  tariffDate: string;
  box: {
    fetched: number;
    inserted: number;
    skipped: number;
    dtNextBox: string | null;
    dtTillMax: string | null;
  } | null;
  pallet: {
    fetched: number;
    inserted: number;
    skipped: number;
    dtNextPallet: string | null;
    dtTillMax: string | null;
  } | null;
  acceptance: {
    fetched: number;
    inserted: number;
    skipped: number;
  } | null;
  durationMs: number;
}

function todayUtcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Use case: "load WB warehouse tariffs (box/pallet/acceptance) for a date".
 *
 * One invocation fans out to three independent WB endpoints. Each one is
 * optional via `skip*` flags so a partial sync can recover from rate-limit
 * issues without blocking the rest. All writes happen *after* successful
 * fetch+map for that section, so a 4xx in one endpoint does not corrupt
 * the others. `dryRun` short-circuits writes globally.
 */
export async function importWbWarehouseTariffs(
  deps: ImportWbWarehouseTariffsDeps,
  options: ImportWbWarehouseTariffsOptions = {},
): Promise<ImportWbWarehouseTariffsResult> {
  const { wbClient, repository, logger } = deps;
  const now = deps.now ?? (() => new Date());

  const fetchedAt = now().toISOString();
  const tariffDate = options.tariffDate ?? todayUtcDate(now());
  const dryRun = options.dryRun === true;
  const startedAt = Date.now();

  logger.info(
    {
      fetchedAt,
      tariffDate,
      skip: {
        box: options.skipBox === true,
        pallet: options.skipPallet === true,
        acceptance: options.skipAcceptance === true,
      },
      warehouseIds: options.warehouseIds ?? null,
      dryRun,
    },
    "WB warehouse tariffs import: start",
  );

  let box: ImportWbWarehouseTariffsResult["box"] = null;
  if (options.skipBox !== true) {
    const body = await wbClient.getBoxTariffs({ date: tariffDate });
    const mapped = mapBoxTariffEnvelope(body, { tariffDate, fetchedAt });
    let inserted = 0;
    if (!dryRun) {
      inserted = repository.saveBoxBatch(mapped.records).inserted;
    }
    box = {
      fetched: mapped.records.length + mapped.skipped.length,
      inserted,
      skipped: mapped.skipped.length,
      dtNextBox: mapped.dtNextBox,
      dtTillMax: mapped.dtTillMax,
    };
    for (const s of mapped.skipped) {
      logger.warn(
        { reason: s.reason, raw: s.raw },
        "WB warehouse tariffs import: box row skipped",
      );
    }
    logger.info({ box }, "WB warehouse tariffs import: box done");
  }

  let pallet: ImportWbWarehouseTariffsResult["pallet"] = null;
  if (options.skipPallet !== true) {
    const body = await wbClient.getPalletTariffs({ date: tariffDate });
    const mapped = mapPalletTariffEnvelope(body, { tariffDate, fetchedAt });
    let inserted = 0;
    if (!dryRun) {
      inserted = repository.savePalletBatch(mapped.records).inserted;
    }
    pallet = {
      fetched: mapped.records.length + mapped.skipped.length,
      inserted,
      skipped: mapped.skipped.length,
      dtNextPallet: mapped.dtNextPallet,
      dtTillMax: mapped.dtTillMax,
    };
    for (const s of mapped.skipped) {
      logger.warn(
        { reason: s.reason, raw: s.raw },
        "WB warehouse tariffs import: pallet row skipped",
      );
    }
    logger.info({ pallet }, "WB warehouse tariffs import: pallet done");
  }

  let acceptance: ImportWbWarehouseTariffsResult["acceptance"] = null;
  if (options.skipAcceptance !== true) {
    const rawRows = await wbClient.getAcceptanceCoefficients({
      warehouseIds: options.warehouseIds,
    });
    const records = [];
    let skipped = 0;
    for (const raw of rawRows) {
      const r = mapAcceptanceCoefficient(raw, { fetchedAt });
      if (r.ok) {
        records.push(r.record);
      } else {
        skipped += 1;
        logger.warn(
          { reason: r.reason, raw: r.raw },
          "WB warehouse tariffs import: acceptance row skipped",
        );
      }
    }
    let inserted = 0;
    if (!dryRun) {
      inserted = repository.saveAcceptanceBatch(records).inserted;
    }
    acceptance = { fetched: rawRows.length, inserted, skipped };
    logger.info(
      { acceptance },
      "WB warehouse tariffs import: acceptance done",
    );
  }

  const durationMs = Date.now() - startedAt;
  const result: ImportWbWarehouseTariffsResult = {
    fetchedAt,
    tariffDate,
    box,
    pallet,
    acceptance,
    durationMs,
  };
  logger.info(result, "WB warehouse tariffs import: done");
  return result;
}
