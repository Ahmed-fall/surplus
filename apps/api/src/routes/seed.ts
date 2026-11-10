// Owner: R1. Task C-12: seed-on-boot adapter.
//
// Simulator personas boot deterministically from R2's committed fixtures
// (F-4): every boot converges to the same dataset without network access.
// Live merchants must never be seeded with a fixture balance: the live view
// starts empty and is built up only by verified webhooks (and the hybrid
// baseline rows arrive through the persistent SQLite database seeded via
// `pnpm seed`, whose live fixture holds a zero LIVE_WEBHOOK_ADJUSTED balance).
import type { MerchantId } from "@surplus/contracts";
import { MERCHANT_IDS } from "@surplus/contracts";
import { loadFixtureDataset } from "@surplus/paypal/sources";
import type { MerchantDataset } from "./dataset";
import { LIVE_MERCHANT } from "./webhooks";

/** Minimal seeding surface shared by the in-memory and SQLite stores. */
export interface SeedableStore {
  seed(merchantId: MerchantId, dataset: MerchantDataset): void;
}

/** Every merchant the store serves after a C-12 boot (fixed order). */
export const SEEDED_MERCHANTS: readonly MerchantId[] = MERCHANT_IDS;

/** Empty starting point for a live merchant. No fixture data is mixed in. */
export const EMPTY_LIVE_DATASET: MerchantDataset = {
  transactions: [],
  availableBalanceCents: 0,
  balanceSource: "LIVE_WEBHOOK_ADJUSTED",
  openDisputes: {
    count: 0,
    totalAmountCents: 0,
    unheldAmountCents: 0,
  },
  excludedNonUsdCount: 0,
};

function liveMerchantDataset(): MerchantDataset {
  return {
    ...EMPTY_LIVE_DATASET,
    transactions: [],
    openDisputes: { ...EMPTY_LIVE_DATASET.openDisputes },
  };
}

function personaDataset(merchantId: MerchantId): MerchantDataset {
  const fixture = loadFixtureDataset(merchantId);
  return {
    transactions: fixture.transactions,
    availableBalanceCents: fixture.availableBalanceCents,
    balanceSource: fixture.balanceSource,
    openDisputes: { ...fixture.openDisputes },
    excludedNonUsdCount: fixture.excludedNonUsdCount,
  };
}

/**
 * Seeds every merchant the store serves:
 * - personas from the deterministic fixture datasets (idempotent replace),
 * - live_sandbox empty, clearing any previously applied webhook events.
 * A live PayPal dataset fetched after boot is contributed by
 * getMerchantDataset/store.hydrate, never by this bootstrap.
 */
export function seedOnBoot(store: SeedableStore): void {
  for (const merchantId of SEEDED_MERCHANTS) {
    store.seed(
      merchantId,
      merchantId === LIVE_MERCHANT ? liveMerchantDataset() : personaDataset(merchantId),
    );
  }
}
