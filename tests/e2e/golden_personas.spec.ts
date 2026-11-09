/* R6 F-12 Golden persona specification
   Verifies four fixture personas using the deterministic engine.
   Values are derived from the engine generators in packages/engine/src/personas.test.ts.
   All monetary assertions use integer cents.
*/
import { describe, it, expect } from "vitest";
import type { MerchantId, NormalizedTransaction, RiskProfile } from "../../packages/contracts/src/index";
import { computeSurplus, computeAllocationPlan } from "../../packages/engine/src/index";

const PERSONA_AS_OF = "2026-09-02T00:00:00Z";

function baseTx(merchantId: MerchantId, bucket: string, overrides: Partial<NormalizedTransaction> = {}): NormalizedTransaction {
  return {
    id: `fix-${merchantId}-${bucket}-${overrides.kind ?? "income"}`,
    merchantId,
    occurredAt: `${bucket}-05T12:00:00Z`,
    monthBucket: bucket,
    kind: "income",
    grossCents: 0,
    feeCents: 0,
    netCents: 0,
    currency: "USD",
    status: "COMPLETED",
    counterpartyHash: "a1b2c3d4",
    source: "fixture",
    ...overrides,
  };
}

function monthBuckets(): string[] {
  const buckets: string[] = [];
  let year = 2025;
  let month = 9;
  for (let i = 0; i < 12; i++) {
    buckets.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return buckets;
}

function makeInput(
  merchantId: MerchantId,
  riskProfile: RiskProfile,
  availableBalanceCents: number,
  monthlyObligationsCents: number | undefined,
  transactions: NormalizedTransaction[],
  openDisputes: { count: number; totalAmountCents: number; unheldAmountCents: number }
) {
  return {
    merchantId,
    transactions,
    asOf: PERSONA_AS_OF,
    availableBalanceCents,
    balanceSource: "PAYPAL_REPORTING_API" as const,
    monthlyObligationsCents,
    riskProfile,
    openDisputes,
    excludedNonUsdCount: 0,
  };
}

function steadyRetainerInput() {
  const transactions = monthBuckets().flatMap(bucket => [
    baseTx("persona_steady_retainer", bucket, { kind: "income", grossCents: 480000, feeCents: 15000, netCents: 465000 }),
    baseTx("persona_steady_retainer", bucket, { kind: "withdrawal", grossCents: 200000, feeCents: 0, netCents: -200000, counterpartyHash: "e5f6a7b8" }),
  ]);
  return makeInput("persona_steady_retainer", "CONSERVATIVE", 2500000, undefined, transactions, { count: 0, totalAmountCents: 0, unheldAmountCents: 0 });
}

function volatileFreelancerInput() {
  const transactions = monthBuckets().flatMap((bucket, index) => {
    if (index % 2 === 0) {
      return [
        baseTx("persona_volatile_freelancer", bucket, { grossCents: 920000, feeCents: 20000, netCents: 900000 }),
        baseTx("persona_volatile_freelancer", bucket, { kind: "withdrawal", grossCents: 150000, feeCents: 0, netCents: -150000, counterpartyHash: "e5f6a7b8" }),
      ];
    }
    return [
      baseTx("persona_volatile_freelancer", bucket, { grossCents: 170000, feeCents: 20000, netCents: 150000 }),
      baseTx("persona_volatile_freelancer", bucket, { kind: "refund", grossCents: 30000, feeCents: 0, netCents: -30000, counterpartyHash: "c3d4e5f6" }),
      baseTx("persona_volatile_freelancer", bucket, { kind: "withdrawal", grossCents: 150000, feeCents: 0, netCents: -150000, counterpartyHash: "e5f6a7b8" }),
    ];
  });
  return makeInput("persona_volatile_freelancer", "BALANCED", 2000000, 200000, transactions, { count: 1, totalAmountCents: 25000, unheldAmountCents: 25000 });
}

function seasonalSellerInput() {
  const nets = [700000,800000,900000,700000,300000,120000,30000,120000,180000,420000,620000,880000];
  const refunds: Record<string, number> = { "2026-02":30000, "2026-03":60000, "2026-08":45000 };
  const transactions = monthBuckets().flatMap((bucket, idx) => {
    const feeCents = 12000;
    const refundCents = refunds[bucket] ?? 0;
    const incomeCents = nets[idx]! + feeCents + refundCents;
    const rows: NormalizedTransaction[] = [
      baseTx("persona_seasonal_seller", bucket, { grossCents: incomeCents, feeCents, netCents: incomeCents - feeCents })
    ];
    if (refundCents > 0) {
      rows.push(baseTx("persona_seasonal_seller", bucket, { kind: "refund", grossCents: refundCents, feeCents: 0, netCents: -refundCents, counterpartyHash: "c3d4e5f6" }));
    }
    rows.push(baseTx("persona_seasonal_seller", bucket, { kind: "withdrawal", grossCents: 200000, feeCents: 0, netCents: -200000, counterpartyHash: "e5f6a7b8" }));
    return rows;
  });
  return makeInput("persona_seasonal_seller", "GROWTH", 3000000, 250000, transactions, { count: 2, totalAmountCents: 60000, unheldAmountCents: 60000 });
}

function disputeSpikeInput() {
  const transactions = monthBuckets().flatMap((bucket, idx) => {
    const rows: NormalizedTransaction[] = [
      baseTx("persona_dispute_spike", bucket, { grossCents: 210000, feeCents: 10000, netCents: 200000 })
    ];
    if (idx === 11) {
      rows[0]!.netCents = 50000;
      rows[0]!.grossCents = 60000;
      rows.push(baseTx("persona_dispute_spike", bucket, { kind: "chargeback", grossCents: 3050000, feeCents: 0, netCents: -3050000, counterpartyHash: "d4e5f6a7" }));
    }
    rows.push(baseTx("persona_dispute_spike", bucket, { kind: "withdrawal", grossCents: 150000, feeCents: 0, netCents: -150000, counterpartyHash: "e5f6a7b8" }));
    return rows;
  });
  return makeInput("persona_dispute_spike", "BALANCED", 900000, 300000, transactions, { count: 3, totalAmountCents: 300000, unheldAmountCents: 125000 });
}

describe("R6 F-12 Golden Personas", () => {
  it("persona_steady_retainer", () => {
    const input = steadyRetainerInput();
    const surplus = computeSurplus(input);
    const plan = computeAllocationPlan(surplus);
    // Traceable golden values from packages/engine/src/__snapshots__/personas.test.ts.snap
    expect(surplus.modelStatus).toBe("OK");
    expect(surplus.obligationsSource).toBe("TRAILING_3M_WITHDRAWAL_AVG");
    expect(surplus.cv).toBe(0);
    expect(surplus.bufferMonths).toBe(3);
    expect(surplus.safeSurplusCents).toBe(1900000);
    expect(surplus.stagingTrancheCount).toBe(6);
    expect(surplus.stagingScheduleCents).toEqual([316670,316666,316666,316666,316666,316666]);
    expect(surplus.stagingScheduleCents.reduce((a,b)=>a+b,0)).toBe(surplus.safeSurplusCents);
    expect(plan.safeSurplusCents).toBe(1900000);
    expect(plan.highVolatilityShiftApplied).toBe(false);
    expect(plan.bands).toHaveLength(3);
    expect(plan.bands[0]!.targetMidpointPct).toBe(50);
    expect(plan.bands[1]!.targetMidpointPct).toBe(35);
    expect(plan.bands[2]!.targetMidpointPct).toBe(15);
    expect(plan.bands[0]!.allocatedMidpointCents).toBe(950000);
    expect(plan.bands[1]!.allocatedMidpointCents).toBe(665000);
    expect(plan.bands[2]!.allocatedMidpointCents).toBe(285000);
    expect(plan.bands.reduce((a,b)=>a+b.allocatedMidpointCents,0)).toBe(plan.safeSurplusCents);
  });

  it("persona_volatile_freelancer", () => {
    const input = volatileFreelancerInput();
    const surplus = computeSurplus(input);
    const plan = computeAllocationPlan(surplus);
    expect(surplus.modelStatus).toBe("OK");
    expect(surplus.cv).toBeCloseTo(0.7987, 4);
    expect(surplus.bufferMonths).toBeCloseTo(7.79, 2);
    expect(surplus.safeSurplusCents).toBe(392724);
    expect(surplus.stagingTrancheCount).toBe(4);
    expect(surplus.stagingScheduleCents).toEqual([98181,98181,98181,98181]);
    expect(plan.highVolatilityShiftApplied).toBe(true);
    expect(plan.safeSurplusCents).toBe(392724);
    expect(plan.bands[0]!.targetMidpointPct).toBe(40);
    expect(plan.bands[1]!.targetMidpointPct).toBe(30);
    expect(plan.bands[2]!.targetMidpointPct).toBe(30);
    expect(plan.bands[0]!.allocatedMidpointCents).toBe(157090);
    expect(plan.bands[1]!.allocatedMidpointCents).toBe(117817);
    expect(plan.bands[2]!.allocatedMidpointCents).toBe(117817);
  });

  it("persona_seasonal_seller", () => {
    const input = seasonalSellerInput();
    const surplus = computeSurplus(input);
    const plan = computeAllocationPlan(surplus);
    expect(surplus.modelStatus).toBe("OK");
    expect(surplus.cv).toBeCloseTo(0.6199, 4);
    expect(surplus.bufferMonths).toBeCloseTo(6.72, 2);
    expect(surplus.safeSurplusCents).toBe(1248300);
    expect(surplus.stagingTrancheCount).toBe(3);
    expect(surplus.stagingScheduleCents).toEqual([416100,416100,416100]);
    expect(plan.highVolatilityShiftApplied).toBe(true);
    expect(plan.safeSurplusCents).toBe(1248300);
    expect(plan.bands[0]!.targetMidpointPct).toBe(25);
    expect(plan.bands[1]!.targetMidpointPct).toBe(20);
    expect(plan.bands[2]!.targetMidpointPct).toBe(55);
    expect(plan.bands[0]!.allocatedMidpointCents).toBe(312075);
    expect(plan.bands[1]!.allocatedMidpointCents).toBe(249660);
    expect(plan.bands[2]!.allocatedMidpointCents).toBe(686565);
  });

  it("persona_dispute_spike", () => {
    const input = disputeSpikeInput();
    const surplus = computeSurplus(input);
    const plan = computeAllocationPlan(surplus);
    expect(surplus.modelStatus).toBe("NEGATIVE_CASH_FLOW");
    expect(surplus.bufferMonths).toBe(9);
    expect(surplus.safeSurplusCents).toBe(0);
    expect(surplus.stagingTrancheCount).toBe(4);
    expect(surplus.stagingScheduleCents).toEqual([0,0,0,0]);
    expect(plan.safeSurplusCents).toBe(0);
    expect(plan.highVolatilityShiftApplied).toBe(true);
  });
});
