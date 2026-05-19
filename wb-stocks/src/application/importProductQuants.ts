import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { Logger } from "pino";
import type { ProductQuantRecord } from "../domain/productQuant.js";
import type { ProductQuantRepository } from "../infra/productQuantRepository.js";
import {
  parseProductQuantsCsv,
  type ProductQuantCsvDetection,
  type ProductQuantCsvParseIssue,
} from "./parseProductQuantsCsv.js";

export interface ImportProductQuantsDeps {
  repository: ProductQuantRepository;
  logger: Logger;
  now?: () => Date;
  readFile?: (path: string) => Promise<Buffer>;
}

export interface ImportProductQuantsOptions {
  file?: string;
}

export interface ImportProductQuantsResult {
  sourceFile: string;
  fetched: number;
  skippedBlankVendor: number;
  defaulted: number;
  inserted: number;
  wasUpdate: boolean;
  durationMs: number;
  detection: ProductQuantCsvDetection;
  issues: ProductQuantCsvParseIssue[];
}

export async function importProductQuants(
  deps: ImportProductQuantsDeps,
  options: ImportProductQuantsOptions = {},
): Promise<ImportProductQuantsResult> {
  const { repository, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const read = deps.readFile ?? (async (p) => readFile(p));
  const sourceFile = resolve(options.file ?? "../store/kvants.csv");
  const startedAt = Date.now();

  logger.info({ sourceFile }, "Product quant import: start");

  const existing = repository.countAll();
  const wasUpdate = existing > 0;
  const parsed = parseProductQuantsCsv(await read(sourceFile));
  const importedAt = now().toISOString();
  const records: ProductQuantRecord[] = parsed.rows.map((row) => ({
    vendorCode: row.vendorCode,
    unitsPerBox: row.unitsPerBox,
    sourceFile: basename(sourceFile),
    importedAt,
  }));

  const { inserted } = repository.replaceAll(records);
  for (const issue of parsed.issues.slice(0, 20)) {
    logger.warn(
      { lineNumber: issue.lineNumber, reason: issue.reason, raw: issue.raw },
      "Product quant import: row warning",
    );
  }
  if (parsed.issues.length > 20) {
    logger.warn(
      { warnings: parsed.issues.length, logged: 20 },
      "Product quant import: additional warnings omitted from logs",
    );
  }

  const result: ImportProductQuantsResult = {
    sourceFile,
    fetched: parsed.rows.length + parsed.skippedBlankVendor,
    skippedBlankVendor: parsed.skippedBlankVendor,
    defaulted: parsed.defaulted,
    inserted,
    wasUpdate,
    durationMs: Date.now() - startedAt,
    detection: parsed.detection,
    issues: parsed.issues,
  };
  logger.info(result, "Product quant import: done");
  return result;
}
