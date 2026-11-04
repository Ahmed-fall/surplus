// Owner: R1. Task F-9: fallback dataset adapter for fixture personas.
//
// server.ts now loads live_sandbox through R2's getMerchantDataset(); the four
// fixture personas still use this contracts example until R2's scripts/seed.ts
// and fixtures land. The loader is injected into buildApp() so tests can supply
// a richer dataset.
import type {
  BalanceSource,
  MerchantId,
  NormalizedTransaction,
  OpenDisputesSummary,
} from "@surplus/contracts";
import {
  DEMO_AS_OF,
  exampleNormalizedTransaction,
  exampleOpenDisputesSummary,
  exampleSurplusResult,
} from "@surplus/contracts/examples";

/**
 * Shape returned by R2's getMerchantDataset(merchantId). Kept structurally
 * compatible so the live loader can be injected without coupling routes to the
 * PayPal source package's internal types.
 */
export interface MerchantDataset {
  transactions: NormalizedTransaction[];
  availableBalanceCents: number;
  balanceSource: BalanceSource;
  openDisputes: OpenDisputesSummary;
  excludedNonUsdCount: number;
}

export type DatasetLoader = (merchantId: MerchantId) => MerchantDataset | Promise<MerchantDataset>;

/**
 * Fixture personas use a fixed asOf so golden values stay reproducible.
 * live_sandbox tracks wall-clock time because it is adjusted by live webhooks.
 */
export function asOfFor(merchantId: MerchantId, now: Date = new Date()): string {
  return merchantId === "live_sandbox" ? now.toISOString() : DEMO_AS_OF;
}

/** TEMPORARY loader. Replaced by R2's getMerchantDataset on merge. */
export const exampleDatasetLoader = (merchantId: MerchantId): MerchantDataset => ({
  transactions: [{ ...exampleNormalizedTransaction, merchantId }],
  availableBalanceCents: exampleSurplusResult.availableBalanceCents,
  balanceSource: "FIXTURE",
  openDisputes: exampleOpenDisputesSummary,
  excludedNonUsdCount: 0,
});
