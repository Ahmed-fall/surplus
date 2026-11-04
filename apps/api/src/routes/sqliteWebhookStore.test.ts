// Owner: R1. Task C-5/C-12: SQLite persistence, idempotency and live isolation.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NormalizedTransaction } from "@surplus/contracts";
import { getDb } from "@surplus/paypal/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MerchantDataset } from "./dataset";
import { EMPTY_LIVE_DATASET } from "./seed";
import { SqliteWebhookStore } from "./sqliteWebhookStore";
import { EMPTY_DISPUTES } from "./webhookStore";
import { LIVE_MERCHANT } from "./webhooks";

const dir = mkdtempSync(join(tmpdir(), "surplus-api-"));
let db: ReturnType<typeof getDb>;
let store: SqliteWebhookStore;
let clock: Date;

const CAPTURE: NormalizedTransaction = {
  id: "CAP-1",
  merchantId: LIVE_MERCHANT,
  occurredAt: "2026-10-25T12:00:00Z",
  monthBucket: "2026-10",
  kind: "income",
  grossCents: 120_000,
  feeCents: 3_530,
  netCents: 116_470,
  currency: "USD",
  status: "COMPLETED",
  counterpartyHash: "aaaaaaaa",
  source: "live",
};

const FIXTURE_DATASET: MerchantDataset = {
  transactions: [
    {
      ...CAPTURE,
      id: "FIX-1",
      source: "fixture",
    },
  ],
  availableBalanceCents: 500_000,
  balanceSource: "FIXTURE",
  openDisputes: { count: 1, totalAmountCents: 25_000, unheldAmountCents: 25_000 },
  excludedNonUsdCount: 2,
};

beforeAll(() => {
  process.env.DATABASE_PATH = join(dir, "test.db");
  db = getDb();
  clock = new Date("2026-10-25T12:00:00Z");
  store = new SqliteWebhookStore(db, () => clock);
});

afterAll(() => {
  db.close();
  delete process.env.DATABASE_PATH;
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  store.seed(LIVE_MERCHANT, EMPTY_LIVE_DATASET);
});

describe("SqliteWebhookStore", () => {
  it("seeds live empty without fixture transactions or balances", () => {
    const dataset = store.getDataset(LIVE_MERCHANT);

    expect(dataset?.transactions).toEqual([]);
    expect(dataset?.availableBalanceCents).toBe(0);
    expect(dataset?.balanceSource).toBe("LIVE_WEBHOOK_ADJUSTED");
    expect(dataset?.openDisputes).toEqual(EMPTY_DISPUTES);
  });

  it("persists a fixture dataset across store instances", () => {
    store.seed(LIVE_MERCHANT, FIXTURE_DATASET);

    const reopened = new SqliteWebhookStore(db);
    const dataset = reopened.getDataset(LIVE_MERCHANT);

    expect(dataset?.transactions.map((tx) => tx.id)).toEqual(["FIX-1"]);
    expect(dataset?.availableBalanceCents).toBe(500_000);
    expect(dataset?.balanceSource).toBe("FIXTURE");
    expect(dataset?.openDisputes).toEqual(FIXTURE_DATASET.openDisputes);
    expect(dataset?.excludedNonUsdCount).toBe(2);
  });

  it("applies an event atomically and deduplicates replays", () => {
    const first = store.applyEvent({
      eventId: "WH-1",
      merchantId: LIVE_MERCHANT,
      transaction: CAPTURE,
      deltaNetCents: CAPTURE.netCents,
      type: "payment.received",
    });
    const replay = store.applyEvent({
      eventId: "WH-1",
      merchantId: LIVE_MERCHANT,
      transaction: CAPTURE,
      deltaNetCents: CAPTURE.netCents,
      type: "payment.received",
    });

    expect(first).toBe(true);
    expect(replay).toBe(false);
    expect(store.hasEvent("WH-1")).toBe(true);
    expect(store.eventCount()).toBe(1);
    expect(store.transactionCount(LIVE_MERCHANT)).toBe(1);
    expect(store.balanceCents(LIVE_MERCHANT)).toBe(116_470);
    expect(store.getDataset(LIVE_MERCHANT)?.balanceSource).toBe("LIVE_WEBHOOK_ADJUSTED");
  });

  it("never drives the stored balance below zero", () => {
    store.seed(LIVE_MERCHANT, { ...EMPTY_LIVE_DATASET, availableBalanceCents: 100 });

    const applied = store.applyEvent({
      eventId: "WH-REFUND",
      merchantId: LIVE_MERCHANT,
      transaction: {
        ...CAPTURE,
        id: "REF-1",
        kind: "refund",
        grossCents: 200_000,
        feeCents: 0,
        netCents: -200_000,
      },
      deltaNetCents: -200_000,
      type: "refund.processed",
    });

    expect(applied).toBe(true);
    expect(store.balanceCents(LIVE_MERCHANT)).toBe(0);
  });

  it("counts a non-USD event once and never writes it to transactions", () => {
    const first = store.ignoreEvent({
      eventId: "WH-EUR",
      merchantId: LIVE_MERCHANT,
      reason: "non_usd",
    });
    const replay = store.ignoreEvent({
      eventId: "WH-EUR",
      merchantId: LIVE_MERCHANT,
      reason: "non_usd",
    });

    expect(first).toBe(true);
    expect(replay).toBe(false);
    expect(store.eventCount()).toBe(1);
    expect(store.transactionCount(LIVE_MERCHANT)).toBe(0);
    expect(store.getDataset(LIVE_MERCHANT)?.excludedNonUsdCount).toBe(1);
  });

  it("hydrates the live baseline without erasing applied webhook rows", () => {
    store.applyEvent({
      eventId: "WH-1",
      merchantId: LIVE_MERCHANT,
      transaction: CAPTURE,
      deltaNetCents: CAPTURE.netCents,
      type: "payment.received",
    });

    store.hydrate(LIVE_MERCHANT, {
      ...FIXTURE_DATASET,
      transactions: [{ ...FIXTURE_DATASET.transactions[0]!, source: "live" }],
      availableBalanceCents: 900_000,
      balanceSource: "PAYPAL_REPORTING_API",
    });

    const dataset = store.getDataset(LIVE_MERCHANT);
    expect(dataset?.transactions.map((tx) => tx.id).sort()).toEqual(["CAP-1", "FIX-1"]);
    expect(dataset?.availableBalanceCents).toBe(116_470);
    expect(dataset?.balanceSource).toBe("LIVE_WEBHOOK_ADJUSTED");
    expect(store.eventCount()).toBe(1);
  });
});
