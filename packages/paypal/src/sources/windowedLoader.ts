// Owner: R2 - F-2 windowed transaction loader.
//
// Walks backward over up to twelve 31-day RFC3339 windows (FACT-01), paginates
// each window, deduplicates by transaction id, normalizes every row through
// F-3, and upserts the result into SQLite. Free text never leaves the client.
import { PaypalClient } from "../client/index.js";
import type { MerchantId, NormalizedTransaction } from "@surplus/contracts";
import { getDb } from "./db";
import { normalizeTransaction } from "./normalizer";
import { isPersonaMerchant, loadFixtureDataset } from "./seedFixtures";

const WINDOW_COUNT = 12;
const WINDOW_DAYS = 31;
const PAGE_SIZE = 100;

export interface MerchantDataset {
  transactions: NormalizedTransaction[];
  availableBalanceCents: number;
  balanceSource: "PAYPAL_REPORTING_API" | "LIVE_WEBHOOK_ADJUSTED" | "FIXTURE";
  openDisputes: { count: number; totalAmountCents: number; unheldAmountCents: number };
  excludedNonUsdCount: number;
}

interface WindowedLoadResult {
  transactions: NormalizedTransaction[];
  excludedNonUsdCount: number;
}

interface BalanceRow {
  availableCents: number;
}

interface DisputeRow {
  count: number;
  totalAmountCents: number | null;
}

/** Builds a client from the PayPal environment variables. */
export function createPaypalClientFromEnv(): PaypalClient {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET. Set them in .env (Sandbox only).",
    );
  }
  return new PaypalClient({
    clientId,
    clientSecret,
    baseUrl: process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com",
  });
}

function isoNoMillis(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Loads, normalizes, and persists transactions for a merchant.
 * Returns the deduplicated transaction rows plus the count of non-USD rows
 * that were intentionally excluded.
 */
async function loadWindowedTransactions(
  merchantId: MerchantId,
  asOf: string,
  client: PaypalClient,
): Promise<WindowedLoadResult> {
  const asOfDate = new Date(asOf);
  if (Number.isNaN(asOfDate.getTime())) {
    throw new Error(`loadTransactions: invalid asOf timestamp "${asOf}"`);
  }

  const db = getDb();
  const all: NormalizedTransaction[] = [];
  const seen = new Set<string>();
  let excludedNonUsdCount = 0;

  for (let windowIndex = 0; windowIndex < WINDOW_COUNT; windowIndex++) {
    const windowEnd = new Date(asOfDate.getTime() - windowIndex * WINDOW_DAYS * 86_400_000);
    const windowStart = new Date(windowEnd.getTime() - WINDOW_DAYS * 86_400_000);
    const startDate = isoNoMillis(windowStart);
    const endDate = isoNoMillis(windowEnd);

    for (let page = 1; ; page++) {
      const response = await client.searchTransactions(startDate, endDate, page, PAGE_SIZE);
      const details = response.transaction_details ?? [];

      for (const detail of details) {
        if (detail.transaction_info?.transaction_amount?.currency_code !== "USD") {
          excludedNonUsdCount++;
          continue;
        }
        const transaction = normalizeTransaction(detail, merchantId, "live");
        if (transaction === null || seen.has(transaction.id)) continue;
        seen.add(transaction.id);
        all.push(transaction);
      }

      const totalPages = response.total_pages ?? 1;
      if (details.length === 0 || page >= totalPages) break;
    }
  }

  // Merchant row must exist before the normalized_transactions FK is applied.
  db.prepare("INSERT OR IGNORE INTO merchants (id, name) VALUES (?, ?)").run(
    merchantId,
    merchantId,
  );

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

  const persist = db.transaction((transactions: NormalizedTransaction[]) => {
    for (const transaction of transactions) {
      insert.run({ ...transaction, source: "live" });
    }
  });
  persist(all);

  return { transactions: all, excludedNonUsdCount };
}

/**
 * Loads transactions for a merchant using PayPal Transaction Search and returns
 * the fully normalized, deduplicated array.
 */
export async function loadTransactions(
  merchantId: MerchantId,
  asOf: string,
  client: PaypalClient = createPaypalClientFromEnv(),
): Promise<NormalizedTransaction[]> {
  const result = await loadWindowedTransactions(merchantId, asOf, client);
  return result.transactions;
}

/**
 * Public dataset getter used by the API layer (AGENT_CONTEXT Section 7).
 *
 * Simulator personas resolve synchronously from the fixture files (no PayPal
 * credentials required); the live merchant walks the windowed PayPal flow.
 * Personas are always deterministic — fixture data is not "live data" for
 * any of them, so we never touch the network.
 */
export async function getMerchantDataset(
  merchantId: MerchantId,
  asOf: string = new Date().toISOString(),
  client?: PaypalClient,
): Promise<MerchantDataset> {
  if (isPersonaMerchant(merchantId)) {
    const fixture = loadFixtureDataset(merchantId);
    return {
      transactions: fixture.transactions,
      availableBalanceCents: fixture.availableBalanceCents,
      balanceSource: fixture.balanceSource,
      openDisputes: fixture.openDisputes,
      excludedNonUsdCount: fixture.excludedNonUsdCount,
    };
  }
  const liveClient = client ?? createPaypalClientFromEnv();

  const { transactions, excludedNonUsdCount } = await loadWindowedTransactions(
    merchantId,
    asOf,
    liveClient,
  );

  const db = getDb();
  const balance = db
    .prepare("SELECT availableCents FROM balances WHERE merchantId = ?")
    .get(merchantId) as BalanceRow | undefined;
  const disputes = db
    .prepare(
      "SELECT COUNT(*) AS count, SUM(amountCents) AS totalAmountCents FROM open_disputes WHERE merchantId = ?",
    )
    .get(merchantId) as DisputeRow | undefined;

  return {
    transactions,
    availableBalanceCents: balance?.availableCents ?? 0,
    balanceSource: balance === undefined ? "FIXTURE" : "PAYPAL_REPORTING_API",
    openDisputes: {
      count: disputes?.count ?? 0,
      totalAmountCents: disputes?.totalAmountCents ?? 0,
      unheldAmountCents: disputes?.totalAmountCents ?? 0,
    },
    excludedNonUsdCount,
  };
}
