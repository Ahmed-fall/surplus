// Owner: R2. Task F-4: deterministic fixture datasets + seeding.
//
// The JSON files under /fixtures are the single source of truth for the four
// simulator personas and the live_sandbox baseline history. They mirror the
// numbers locked by the engine snapshot tests (packages/engine person tokens)
// and the frozen example payloads byte-for-byte, so `pnpm seed` reproduces the
// same demo state on every clone without network access.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Database } from "better-sqlite3";
import type { MerchantId, NormalizedTransaction, OpenDisputesSummary } from "@surplus/contracts";
import {
  BalanceSourceSchema,
  MERCHANT_IDS,
  NormalizedTransactionSchema,
  NonNegativeMoneyCentsSchema,
  OpenDisputesSummarySchema,
} from "@surplus/contracts";
import type { MerchantDataset } from "./windowedLoader";

const fixturesDir = fileURLToPath(new URL("../../../../fixtures/", import.meta.url));

/** Serialized fixture file shape (self-describing: includes its merchantId). */
export interface FixtureDatasetFile {
  merchantId: MerchantId;
  transactions: NormalizedTransaction[];
  availableBalanceCents: number;
  balanceSource: MerchantDataset["balanceSource"];
  openDisputes: OpenDisputesSummary;
  excludedNonUsdCount: number;
}

const NON_LIVE_MERCHANTS: readonly MerchantId[] = MERCHANT_IDS.filter(
  (id) => id !== "live_sandbox",
);

/** Live merchant receives the hybrid baseline; personas load fixture data. */
export function isPersonaMerchant(merchantId: MerchantId): boolean {
  return NON_LIVE_MERCHANTS.includes(merchantId);
}

function fail(what: string, why: string): never {
  throw new Error(`fixture validation failed: ${what}: ${why}`);
}

function assertEq(actual: unknown, expected: unknown, what: string): void {
  if (actual !== expected)
    fail(what, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/**
 * Loads and validates a fixture dataset from /fixtures/<merchantId>.json.
 * Throws loudly on drift instead of silently returning partial demo data.
 */
export function loadFixtureDataset(merchantId: MerchantId): FixtureDatasetFile {
  const path = `${fixturesDir}${merchantId}.json`;
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(merchantId, `could not read ${path}: ${String(error)}`);
  }
  const file = json as Partial<FixtureDatasetFile>;
  assertEq(file.merchantId, merchantId, `${path} merchantId`);

  if (!Array.isArray(file.transactions)) fail(merchantId, "transactions must be an array");
  const ids = new Set<string>();
  const transactions: NormalizedTransaction[] = [];
  for (const row of file.transactions) {
    const transaction = NormalizedTransactionSchema.parse(row);
    if (ids.has(transaction.id)) fail(merchantId, `duplicate transaction id ${transaction.id}`);
    ids.add(transaction.id);
    assertEq(transaction.merchantId, merchantId, `${transaction.id}.merchantId`);
    assertEq(transaction.source, "fixture", `${transaction.id}.source`);
    assertEq(transaction.currency, "USD", `${transaction.id}.currency`);
    transactions.push(transaction);
  }
  if (transactions.length === 0) fail(merchantId, "fixture must contain at least one transaction");

  const availableBalanceCents = NonNegativeMoneyCentsSchema.parse(file.availableBalanceCents);
  const balanceSource = BalanceSourceSchema.parse(file.balanceSource as never);
  const openDisputes = OpenDisputesSummarySchema.parse(file.openDisputes as never);
  const excludedNonUsdCount = NonNegativeMoneyCentsSchema.parse(file.excludedNonUsdCount);

  return {
    merchantId,
    transactions,
    availableBalanceCents,
    balanceSource,
    openDisputes,
    excludedNonUsdCount,
  };
}

/**
 * Seeds all five fixture merchants into the given SQLite database, inside one
 * transaction per merchant. Idempotent: stale fixture rows are deleted and
 * reinserted, so re-running always converges to the same state. Webhook
 * events and cached plans are seeding-independent and are not touched here.
 * Returns the per-merchant transaction counts for the CLI summary.
 */
export function seedFixtures(db: Database): { merchantId: MerchantId; transactionCount: number }[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS merchants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS normalized_transactions (
      id TEXT PRIMARY KEY,
      merchantId TEXT NOT NULL REFERENCES merchants(id),
      occurredAt TEXT NOT NULL,
      monthBucket TEXT NOT NULL,
      kind TEXT NOT NULL,
      grossCents INTEGER NOT NULL,
      feeCents INTEGER NOT NULL,
      netCents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      counterpartyHash TEXT NOT NULL,
      source TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS balances (
      merchantId TEXT PRIMARY KEY REFERENCES merchants(id),
      availableCents INTEGER NOT NULL,
      withheldCents INTEGER NOT NULL,
      asOf TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS open_disputes (
      disputeId TEXT PRIMARY KEY,
      merchantId TEXT NOT NULL REFERENCES merchants(id),
      amountCents INTEGER NOT NULL,
      status TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS merchant_store_metadata (
      merchantId TEXT PRIMARY KEY REFERENCES merchants(id),
      balanceSource TEXT NOT NULL,
      excludedNonUsdCount INTEGER NOT NULL DEFAULT 0,
      openDisputeCount INTEGER NOT NULL DEFAULT 0,
      openDisputeTotalCents INTEGER NOT NULL DEFAULT 0,
      openDisputeUnheldCents INTEGER NOT NULL DEFAULT 0
    );
  `);

  const summary: { merchantId: MerchantId; transactionCount: number }[] = [];

  for (const merchantId of MERCHANT_IDS) {
    const dataset = loadFixtureDataset(merchantId);
    const seed = db.transaction(() => {
      db.prepare(
        "INSERT INTO merchants (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name",
      ).run(merchantId, merchantId);

      db.prepare("DELETE FROM normalized_transactions WHERE merchantId = ?").run(merchantId);
      const insert = db.prepare(`
        INSERT INTO normalized_transactions (
          id, merchantId, occurredAt, monthBucket, kind,
          grossCents, feeCents, netCents, currency, status,
          counterpartyHash, source
        ) VALUES (
          @id, @merchantId, @occurredAt, @monthBucket, @kind,
          @grossCents, @feeCents, @netCents, @currency, @status,
          @counterpartyHash, @source
        )
      `);
      for (const transaction of dataset.transactions) {
        insert.run({ ...transaction, currency: "USD" });
      }

      // The fixed asOf keeps repeated seeds byte-identical (deterministic idempotency).
      db.prepare(
        `
        INSERT INTO balances (merchantId, availableCents, withheldCents, asOf)
        VALUES (?, ?, 0, ?)
        ON CONFLICT(merchantId) DO UPDATE SET
          availableCents = excluded.availableCents,
          withheldCents = excluded.withheldCents,
          asOf = excluded.asOf
      `,
      ).run(merchantId, dataset.availableBalanceCents, "2026-10-01T00:00:00Z");

      db.prepare("DELETE FROM open_disputes WHERE merchantId = ?").run(merchantId);
      const disputeInsert = db.prepare(`
        INSERT INTO open_disputes (disputeId, merchantId, amountCents, status, createdAt)
        VALUES (?, ?, ?, 'OPEN', ?)
      `);
      const { count, totalAmountCents } = dataset.openDisputes;
      // Spread the known dispute total over the known count; row detail is
      // informational, the summary values drive engine computations.
      const per = count > 0 ? Math.floor(totalAmountCents / count) : 0;
      let distributed = 0;
      for (let i = 1; i <= count; i++) {
        const isLast = i === count;
        const amountCents = isLast && count > 0 ? totalAmountCents - distributed : per;
        distributed += amountCents;
        disputeInsert.run(
          `${merchantId}-dispute-${i}`,
          merchantId,
          amountCents,
          dataset.transactions[0]?.monthBucket ?? "2026-09",
        );
      }

      db.prepare(
        `
        INSERT INTO merchant_store_metadata (
          merchantId, balanceSource, excludedNonUsdCount,
          openDisputeCount, openDisputeTotalCents, openDisputeUnheldCents
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(merchantId) DO UPDATE SET
          balanceSource = excluded.balanceSource,
          excludedNonUsdCount = excluded.excludedNonUsdCount,
          openDisputeCount = excluded.openDisputeCount,
          openDisputeTotalCents = excluded.openDisputeTotalCents,
          openDisputeUnheldCents = excluded.openDisputeUnheldCents
      `,
      ).run(
        merchantId,
        dataset.balanceSource,
        dataset.excludedNonUsdCount,
        dataset.openDisputes.count,
        dataset.openDisputes.totalAmountCents,
        dataset.openDisputes.unheldAmountCents,
      );
    });
    seed();
    summary.push({ merchantId, transactionCount: dataset.transactions.length });
  }
  return summary;
}
