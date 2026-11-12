// Owner: R1. Task C-12: seed-on-boot must not mix fixture balances into live
// merchants, and must seed simulator personas deterministically from fixtures.
import { describe, expect, it } from "vitest";
import { SEEDED_MERCHANTS, EMPTY_LIVE_DATASET, seedOnBoot } from "./seed";
import { InMemoryWebhookStore } from "./webhookStore";

describe("seedOnBoot", () => {
  it("starts live_sandbox empty instead of copying fixture data", () => {
    const store = new InMemoryWebhookStore();
    seedOnBoot(store);

    expect(store.transactionCount("live_sandbox")).toBe(0);
    expect(store.balanceCents("live_sandbox")).toBe(0);

    const dataset = store.getDataset("live_sandbox");
    expect(dataset?.transactions).toEqual([]);
    expect(dataset?.balanceSource).toBe("LIVE_WEBHOOK_ADJUSTED");
    expect(dataset?.openDisputes).toEqual(EMPTY_LIVE_DATASET.openDisputes);
  });

  it("seeds all five merchants", () => {
    const store = new InMemoryWebhookStore();
    seedOnBoot(store);
    for (const merchantId of SEEDED_MERCHANTS) {
      expect(store.getDataset(merchantId)).toBeDefined();
    }
  });

  it("seeds simulator personas from the deterministic fixtures", () => {
    const store = new InMemoryWebhookStore();
    seedOnBoot(store);

    const steady = store.getDataset("persona_steady_retainer");
    expect(steady?.transactions).toHaveLength(24);
    expect(steady?.availableBalanceCents).toBe(2_500_000);
    expect(steady?.balanceSource).toBe("FIXTURE");
    expect(steady?.openDisputes).toEqual({ count: 0, totalAmountCents: 0, unheldAmountCents: 0 });
    expect(steady?.transactions.every((tx) => tx.source === "fixture")).toBe(true);

    const seasonal = store.getDataset("persona_seasonal_seller");
    expect(seasonal?.openDisputes).toEqual({
      count: 2,
      totalAmountCents: 60000,
      unheldAmountCents: 60000,
    });

    const spike = store.getDataset("persona_dispute_spike");
    expect(spike?.availableBalanceCents).toBe(900_000);
    expect(spike?.transactions).toHaveLength(25);

    const volatile = store.getDataset("persona_volatile_freelancer");
    expect(volatile?.availableBalanceCents).toBe(2_000_000);
    expect(volatile?.transactions).toHaveLength(30);
  });

  it("re-seeds personas idempotently on a second boot", () => {
    const store = new InMemoryWebhookStore();
    seedOnBoot(store);
    const first = store.getDataset("persona_steady_retainer");

    seedOnBoot(store);

    const second = store.getDataset("persona_steady_retainer");
    expect(second?.transactions).toHaveLength(first?.transactions.length ?? 0);
    expect(second?.availableBalanceCents).toBe(first?.availableBalanceCents);
    expect(store.balanceCents("live_sandbox")).toBe(0);
  });

  it("is idempotent and clears previously applied events", async () => {
    const store = new InMemoryWebhookStore();
    seedOnBoot(store);
    store.applyEvent({
      eventId: "WH-1",
      merchantId: "live_sandbox",
      transaction: {
        id: "C-1",
        merchantId: "live_sandbox",
        occurredAt: "2026-10-25T12:00:00Z",
        monthBucket: "2026-10",
        kind: "income",
        grossCents: 1000,
        feeCents: 0,
        netCents: 1000,
        currency: "USD",
        status: "COMPLETED",
        counterpartyHash: "aaaaaaaa",
        source: "live",
      },
      deltaNetCents: 1000,
    });
    expect(store.eventCount()).toBe(1);

    seedOnBoot(store);

    expect(store.eventCount()).toBe(0);
    expect(store.transactionCount("live_sandbox")).toBe(0);
    expect(store.balanceCents("live_sandbox")).toBe(0);
  });
});
