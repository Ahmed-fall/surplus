// Owner: R1. Task C-5/C-12: SQLite-backed webhook persistence.
//
// Uses R2's schema (`packages/paypal/src/sources/db.ts`) and only stores
// normalized, sanitized rows. Raw PayPal payloads and payer free text never
// enter this store. Every applied event is deduplicated inside one SQLite
// transaction, which is the atomicity required by C-5.
import type {
  BalanceSource,
  MerchantId,
  NormalizedTransaction,
  OpenDisputesSummary,
} from "@surplus/contracts";
import { sharedDb } from "@surplus/paypal/db";
import type { MerchantDataset } from "./dataset";
import { EMPTY_DISPUTES } from "./webhookStore";
import type { ApplyEventInput, IgnoreEventInput, WebhookStore } from "./webhookStore";

type Db = ReturnType<typeof sharedDb>;

interface MetadataRow {
  balanceSource: BalanceSource;
  excludedNonUsdCount: number;
  openDisputeCount: number;
  openDisputeTotalCents: number;
  openDisputeUnheldCents: number;
}

interface TransactionRow {
  id: string;
  merchantId: MerchantId;
  occurredAt: string;
  monthBucket: string;
  kind: NormalizedTransaction["kind"];
  grossCents: number;
  feeCents: number;
  netCents: number;
  currency: string;
  status: NormalizedTransaction["status"];
  counterpartyHash: string;
  source: NormalizedTransaction["source"];
}

function toTransaction(row: TransactionRow): NormalizedTransaction {
  return {
    id: row.id,
    merchantId: row.merchantId,
    occurredAt: row.occurredAt,
    monthBucket: row.monthBucket,
    kind: row.kind,
    grossCents: row.grossCents,
    feeCents: row.feeCents,
    netCents: row.netCents,
    currency: "USD",
    status: row.status,
    counterpartyHash: row.counterpartyHash,
    source: row.source,
  };
}

/**
 * Persistent store shared by the API routes, webhook controller and SSE hub.
 *
 * `seed` is destructive and is used on boot/reset (Render runs on an ephemeral
 * filesystem, so the demo is reseeded every boot). `hydrate` is non-destructive
 * and is used when R2's live PayPal dataset arrives after boot: it must not
 * erase webhook rows that were already applied.
 */
export class SqliteWebhookStore implements WebhookStore {
  readonly #db: Db;
  readonly #now: () => Date;
  readonly #excluded = new Map<MerchantId, number>();
  readonly #balanceSource = new Map<MerchantId, BalanceSource>();
  readonly #disputes = new Map<MerchantId, OpenDisputesSummary>();

  constructor(db: Db = sharedDb(), now: () => Date = () => new Date()) {
    this.#db = db;
    this.#now = now;
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS merchant_store_metadata (
        merchantId TEXT PRIMARY KEY REFERENCES merchants(id),
        balanceSource TEXT NOT NULL,
        excludedNonUsdCount INTEGER NOT NULL DEFAULT 0,
        openDisputeCount INTEGER NOT NULL DEFAULT 0,
        openDisputeTotalCents INTEGER NOT NULL DEFAULT 0,
        openDisputeUnheldCents INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  seed(merchantId: MerchantId, dataset: MerchantDataset): void {
    this.#write(merchantId, dataset, true);
  }

  hydrate(merchantId: MerchantId, dataset: MerchantDataset): void {
    this.#write(merchantId, dataset, false);
  }

  #write(merchantId: MerchantId, dataset: MerchantDataset, replace: boolean): void {
    const db = this.#db;
    const adjustedByWebhook = this.#balanceSource.get(merchantId) === "LIVE_WEBHOOK_ADJUSTED";
    const writesBalance = replace || !adjustedByWebhook;
    const asOf = this.#now().toISOString();

    const write = db.transaction(() => {
      db.prepare("INSERT OR IGNORE INTO merchants (id, name) VALUES (?, ?)").run(
        merchantId,
        merchantId,
      );

      if (replace) {
        db.prepare("DELETE FROM webhook_events WHERE merchantId = ?").run(merchantId);
        db.prepare("DELETE FROM normalized_transactions WHERE merchantId = ?").run(merchantId);
        db.prepare("DELETE FROM balances WHERE merchantId = ?").run(merchantId);
        db.prepare("DELETE FROM open_disputes WHERE merchantId = ?").run(merchantId);
      }

      const insert = db.prepare(`
        INSERT INTO normalized_transactions (
          id, merchantId, occurredAt, monthBucket, kind,
          grossCents, feeCents, netCents, currency, status,
          counterpartyHash, source
        ) VALUES (
          @id, @merchantId, @occurredAt, @monthBucket, @kind,
          @grossCents, @feeCents, @netCents, @currency, @status,
          @counterpartyHash, @source
        ) ON CONFLICT(id) DO UPDATE SET
          merchantId = excluded.merchantId,
          occurredAt = excluded.occurredAt,
          monthBucket = excluded.monthBucket,
          kind = excluded.kind,
          grossCents = excluded.grossCents,
          feeCents = excluded.feeCents,
          netCents = excluded.netCents,
          currency = excluded.currency,
          status = excluded.status,
          counterpartyHash = excluded.counterpartyHash,
          source = excluded.source;
      `);
      for (const transaction of dataset.transactions) {
        insert.run({ ...transaction, currency: "USD" });
      }

      if (writesBalance) {
        db.prepare(
          `
          INSERT INTO balances (merchantId, availableCents, withheldCents, asOf)
          VALUES (?, ?, 0, ?)
          ON CONFLICT(merchantId) DO UPDATE SET
            availableCents = excluded.availableCents,
            withheldCents = excluded.withheldCents,
            asOf = excluded.asOf;
        `,
        ).run(merchantId, dataset.availableBalanceCents, asOf);
      }

      db.prepare(
        `
        INSERT INTO merchant_store_metadata (
          merchantId, balanceSource, excludedNonUsdCount,
          openDisputeCount, openDisputeTotalCents, openDisputeUnheldCents
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(merchantId) DO UPDATE SET
          balanceSource = CASE
            WHEN ? = 1 THEN excluded.balanceSource
            ELSE merchant_store_metadata.balanceSource
          END,
          excludedNonUsdCount = CASE
            WHEN ? = 1 THEN excluded.excludedNonUsdCount
            ELSE MAX(merchant_store_metadata.excludedNonUsdCount, excluded.excludedNonUsdCount)
          END,
          openDisputeCount = excluded.openDisputeCount,
          openDisputeTotalCents = excluded.openDisputeTotalCents,
          openDisputeUnheldCents = excluded.openDisputeUnheldCents;
      `,
      ).run(
        merchantId,
        dataset.balanceSource,
        dataset.excludedNonUsdCount,
        dataset.openDisputes.count,
        dataset.openDisputes.totalAmountCents,
        dataset.openDisputes.unheldAmountCents,
        replace ? 1 : 0,
        replace ? 1 : 0,
      );
    });
    write();

    this.#disputes.set(merchantId, { ...dataset.openDisputes });
    if (writesBalance) this.#balanceSource.set(merchantId, dataset.balanceSource);
    const currentExcluded = this.#excluded.get(merchantId) ?? 0;
    this.#excluded.set(
      merchantId,
      replace
        ? dataset.excludedNonUsdCount
        : Math.max(currentExcluded, dataset.excludedNonUsdCount),
    );
  }

  hasEvent(eventId: string): boolean {
    const row = this.#db
      .prepare("SELECT 1 AS found FROM webhook_events WHERE eventId = ?")
      .get(eventId) as { found: number } | undefined;
    return row !== undefined;
  }

  applyEvent(input: ApplyEventInput): boolean {
    const db = this.#db;
    const asOf = this.#now().toISOString();
    const type = input.type ?? "transaction";

    const apply = db.transaction((): boolean => {
      db.prepare("INSERT OR IGNORE INTO merchants (id, name) VALUES (?, ?)").run(
        input.merchantId,
        input.merchantId,
      );

      const inserted = db
        .prepare(
          `
          INSERT OR IGNORE INTO webhook_events
            (eventId, merchantId, type, payload, receivedAt)
          VALUES (?, ?, ?, ?, ?)
        `,
        )
        .run(input.eventId, input.merchantId, type, "{}", asOf);
      if (inserted.changes === 0) return false;

      const tx = input.transaction;
      db.prepare(
        `
        INSERT INTO normalized_transactions (
          id, merchantId, occurredAt, monthBucket, kind,
          grossCents, feeCents, netCents, currency, status,
          counterpartyHash, source
        ) VALUES (
          @id, @merchantId, @occurredAt, @monthBucket, @kind,
          @grossCents, @feeCents, @netCents, @currency, @status,
          @counterpartyHash, @source
        ) ON CONFLICT(id) DO UPDATE SET
          merchantId = excluded.merchantId,
          occurredAt = excluded.occurredAt,
          monthBucket = excluded.monthBucket,
          kind = excluded.kind,
          grossCents = excluded.grossCents,
          feeCents = excluded.feeCents,
          netCents = excluded.netCents,
          currency = excluded.currency,
          status = excluded.status,
          counterpartyHash = excluded.counterpartyHash,
          source = excluded.source;
      `,
      ).run({ ...tx, currency: "USD" });

      const balance = db
        .prepare("SELECT availableCents FROM balances WHERE merchantId = ?")
        .get(input.merchantId) as { availableCents: number } | undefined;
      const nextBalance = Math.max(0, (balance?.availableCents ?? 0) + input.deltaNetCents);
      db.prepare(
        `
        INSERT INTO balances (merchantId, availableCents, withheldCents, asOf)
        VALUES (?, ?, 0, ?)
        ON CONFLICT(merchantId) DO UPDATE SET
          availableCents = excluded.availableCents,
          withheldCents = excluded.withheldCents,
          asOf = excluded.asOf;
      `,
      ).run(input.merchantId, nextBalance, asOf);

      db.prepare(
        `
        INSERT INTO merchant_store_metadata (merchantId, balanceSource)
        VALUES (?, 'LIVE_WEBHOOK_ADJUSTED')
        ON CONFLICT(merchantId) DO UPDATE SET
          balanceSource = 'LIVE_WEBHOOK_ADJUSTED';
      `,
      ).run(input.merchantId);
      return true;
    });

    const applied = apply();
    if (applied) this.#balanceSource.set(input.merchantId, "LIVE_WEBHOOK_ADJUSTED");
    return applied;
  }

  ignoreEvent(input: IgnoreEventInput): boolean {
    const inserted = this.#db
      .prepare(
        `
        INSERT OR IGNORE INTO webhook_events
          (eventId, merchantId, type, payload, receivedAt)
        VALUES (?, ?, ?, ?, ?)
      `,
      )
      .run(input.eventId, input.merchantId, input.reason, "{}", this.#now().toISOString());
    if (inserted.changes === 0) return false;
    if (input.reason === "non_usd") {
      this.#db
        .prepare(
          `
          INSERT INTO merchant_store_metadata (
            merchantId, balanceSource, excludedNonUsdCount
          ) VALUES (?, 'LIVE_WEBHOOK_ADJUSTED', 1)
          ON CONFLICT(merchantId) DO UPDATE SET
            excludedNonUsdCount = merchant_store_metadata.excludedNonUsdCount + 1;
        `,
        )
        .run(input.merchantId);
      this.#excluded.set(input.merchantId, (this.#excluded.get(input.merchantId) ?? 0) + 1);
    }
    return true;
  }

  #metadata(merchantId: MerchantId): MetadataRow | undefined {
    return this.#db
      .prepare(
        `
        SELECT balanceSource, excludedNonUsdCount, openDisputeCount,
               openDisputeTotalCents, openDisputeUnheldCents
        FROM merchant_store_metadata
        WHERE merchantId = ?
      `,
      )
      .get(merchantId) as MetadataRow | undefined;
  }

  /** Recovers the source after a process restart without adding a schema column. */
  #balanceSourceFor(merchantId: MerchantId, hasBalance: boolean): BalanceSource {
    const explicit = this.#balanceSource.get(merchantId);
    if (explicit !== undefined) return explicit;

    const metadata = this.#metadata(merchantId);
    if (metadata !== undefined) return metadata.balanceSource;

    const webhook = this.#db
      .prepare(
        `
        SELECT 1 AS found FROM webhook_events
        WHERE merchantId = ? AND type IN ('payment.received', 'refund.processed')
        LIMIT 1
      `,
      )
      .get(merchantId) as { found: number } | undefined;
    if (webhook !== undefined) return "LIVE_WEBHOOK_ADJUSTED";

    const fixture = this.#db
      .prepare(
        `
        SELECT 1 AS found FROM normalized_transactions
        WHERE merchantId = ? AND source = 'fixture'
        LIMIT 1
      `,
      )
      .get(merchantId) as { found: number } | undefined;
    if (fixture !== undefined) return "FIXTURE";

    return hasBalance ? "PAYPAL_REPORTING_API" : "LIVE_WEBHOOK_ADJUSTED";
  }

  getDataset(merchantId: MerchantId): MerchantDataset | undefined {
    const merchant = this.#db
      .prepare("SELECT 1 AS found FROM merchants WHERE id = ?")
      .get(merchantId) as { found: number } | undefined;
    if (merchant === undefined) return undefined;

    const rows = this.#db
      .prepare(
        `
        SELECT id, merchantId, occurredAt, monthBucket, kind, grossCents,
               feeCents, netCents, currency, status, counterpartyHash, source
        FROM normalized_transactions
        WHERE merchantId = ?
        ORDER BY occurredAt ASC, id ASC
      `,
      )
      .all(merchantId) as TransactionRow[];

    const balance = this.#db
      .prepare("SELECT availableCents FROM balances WHERE merchantId = ?")
      .get(merchantId) as { availableCents: number } | undefined;

    const metadata = this.#metadata(merchantId);
    const balanceSource = this.#balanceSourceFor(merchantId, balance !== undefined);
    const disputes =
      this.#disputes.get(merchantId) ??
      (metadata === undefined
        ? EMPTY_DISPUTES
        : {
            count: metadata.openDisputeCount,
            totalAmountCents: metadata.openDisputeTotalCents,
            unheldAmountCents: metadata.openDisputeUnheldCents,
          });

    return {
      transactions: rows.map(toTransaction),
      availableBalanceCents: balance?.availableCents ?? 0,
      balanceSource,
      openDisputes: { ...disputes },
      excludedNonUsdCount: this.#excluded.get(merchantId) ?? metadata?.excludedNonUsdCount ?? 0,
    };
  }

  balanceCents(merchantId: MerchantId): number | undefined {
    const row = this.#db
      .prepare("SELECT availableCents FROM balances WHERE merchantId = ?")
      .get(merchantId) as { availableCents: number } | undefined;
    return row?.availableCents;
  }

  transactionCount(merchantId: MerchantId): number {
    const row = this.#db
      .prepare("SELECT COUNT(*) AS count FROM normalized_transactions WHERE merchantId = ?")
      .get(merchantId) as { count: number };
    return row.count;
  }

  eventCount(): number {
    const row = this.#db.prepare("SELECT COUNT(*) AS count FROM webhook_events").get() as {
      count: number;
    };
    return row.count;
  }
}
