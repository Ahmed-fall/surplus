// Owner: R2. Task F-4: fixtures are the deterministic seed source. These tests
// form the two-way lock required by F-4: the JSON files under /fixtures must
// reproduce the exact engine numbers locked in packages/engine (persona
// snapshots + the frozen contracts example payloads), and the seeder must be
// idempotent against any DATABASE_PATH (the tests use an in-memory database).
import type { MerchantId } from "@surplus/contracts";
import { MERCHANT_IDS } from "@surplus/contracts";
import { exampleCashFlowSummary, exampleSurplusResult } from "@surplus/contracts/examples";
import { computeAllocationPlan, computeCashFlowSummary, computeSurplus } from "@surplus/engine";
import type { Database } from "better-sqlite3";
import DatabaseConstructor from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { getMerchantDataset } from "./windowedLoader";
import { loadFixtureDataset, seedFixtures } from "./seedFixtures";

const PERSONA_AS_OF = "2026-09-02T00:00:00Z";
const DEMO_AS_OF = "2026-10-01T00:00:00Z";

function newMemoryDb(): Database {
  return new DatabaseConstructor(":memory:");
}

describe("fixture files: shape agreements", () => {
  it("live_sandbox baseline: 12 simulated months, zero live-adjusted balance", () => {
    const live = loadFixtureDataset("live_sandbox");
    expect(live.transactions).toHaveLength(28);
    expect(live.availableBalanceCents).toBe(0);
    expect(live.balanceSource).toBe("LIVE_WEBHOOK_ADJUSTED");
    expect(live.openDisputes).toEqual({
      count: 1,
      totalAmountCents: 40000,
      unheldAmountCents: 40000,
    });
    expect(live.excludedNonUsdCount).toBe(0);
    const months = [...new Set(live.transactions.map((row) => row.monthBucket))];
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2025-10");
    expect(months[11]).toBe("2026-09");
    expect(live.transactions.every((row) => row.source === "fixture")).toBe(true);
  });

  it("all four personas carry the same income/withdrawal shape and non-zero balances", () => {
    const expected: Record<
      Exclude<MerchantId, "live_sandbox">,
      [number, number, number, number, number]
    > = {
      // transactions, availableBalanceCents, disputeCount, disputeTotalCents, disputeUnheldCents
      persona_steady_retainer: [24, 2500000, 0, 0, 0],
      persona_volatile_freelancer: [30, 2000000, 1, 25000, 25000],
      persona_seasonal_seller: [27, 3000000, 2, 60000, 60000],
      persona_dispute_spike: [25, 900000, 3, 300000, 125000],
    };
    for (const [merchantId, [txCount, balance, dCount, dTotal, dUnheld]] of Object.entries(
      expected,
    )) {
      const persona = loadFixtureDataset(merchantId as MerchantId);
      expect(persona.transactions).toHaveLength(txCount);
      expect(persona.availableBalanceCents).toBe(balance);
      expect(persona.balanceSource).toBe("FIXTURE");
      expect(persona.openDisputes).toEqual({
        count: dCount,
        totalAmountCents: dTotal,
        unheldAmountCents: dUnheld,
      });
    }
  });
});

describe("fixtures ↔ engine: persona statistics locks", () => {
  it("steady_retainer (CONSERVATIVE) - default obligations come from withdrawals", () => {
    const fixture = loadFixtureDataset("persona_steady_retainer");
    const surplus = computeSurplus({
      merchantId: fixture.merchantId,
      transactions: fixture.transactions,
      asOf: PERSONA_AS_OF,
      availableBalanceCents: fixture.availableBalanceCents,
      balanceSource: fixture.balanceSource,
      monthlyObligationsCents: undefined,
      riskProfile: "CONSERVATIVE",
      openDisputes: fixture.openDisputes,
      excludedNonUsdCount: fixture.excludedNonUsdCount,
    });
    expect(surplus.cv).toBe(0);
    expect(surplus.bufferMonths).toBe(3);
    expect(surplus.bufferTargetCents).toBe(600000);
    expect(surplus.obligationsSource).toBe("TRAILING_3M_WITHDRAWAL_AVG");
    expect(surplus.monthlyObligationsCents).toBe(200000);
    expect(surplus.safeSurplusCents).toBe(1900000);
    expect(surplus.stagingScheduleCents).toEqual([316670, 316666, 316666, 316666, 316666, 316666]);
    expect(computeAllocationPlan(surplus).bands.map((band) => band.allocatedMidpointCents)).toEqual(
      [950000, 665000, 285000],
    );
  });

  it("volatile_freelancer (BALANCED) - CV shift applied", () => {
    const fixture = loadFixtureDataset("persona_volatile_freelancer");
    const surplus = computeSurplus({
      merchantId: fixture.merchantId,
      transactions: fixture.transactions,
      asOf: PERSONA_AS_OF,
      availableBalanceCents: fixture.availableBalanceCents,
      balanceSource: fixture.balanceSource,
      monthlyObligationsCents: 200000,
      riskProfile: "BALANCED",
      openDisputes: fixture.openDisputes,
      excludedNonUsdCount: fixture.excludedNonUsdCount,
    });
    expect(surplus.cv).toBe(0.7987);
    expect(surplus.bufferMonths).toBe(7.79);
    expect(surplus.bufferTargetCents).toBe(1558000);
    expect(surplus.riskReserveCents).toBe(49276);
    expect(surplus.safeSurplusCents).toBe(392724);
    expect(surplus.stagingScheduleCents).toEqual([98181, 98181, 98181, 98181]);
    const plan = computeAllocationPlan(surplus);
    expect(plan.highVolatilityShiftApplied).toBe(true);
    expect(plan.bands.map((band) => band.allocatedMidpointCents)).toEqual([157090, 117817, 117817]);
  });

  it("seasonal_seller (GROWTH) - quarterly seasonality and mild refunds", () => {
    const fixture = loadFixtureDataset("persona_seasonal_seller");
    const surplus = computeSurplus({
      merchantId: fixture.merchantId,
      transactions: fixture.transactions,
      asOf: PERSONA_AS_OF,
      availableBalanceCents: fixture.availableBalanceCents,
      balanceSource: fixture.balanceSource,
      monthlyObligationsCents: 250000,
      riskProfile: "GROWTH",
      openDisputes: fixture.openDisputes,
      excludedNonUsdCount: fixture.excludedNonUsdCount,
    });
    expect(surplus.cv).toBe(0.6199);
    expect(surplus.bufferMonths).toBe(6.72);
    expect(surplus.bufferTargetCents).toBe(1680000);
    expect(surplus.riskReserveCents).toBe(71700);
    expect(surplus.safeSurplusCents).toBe(1248300);
    expect(surplus.stagingScheduleCents).toEqual([416100, 416100, 416100]);
    expect(computeAllocationPlan(surplus).bands.map((band) => band.allocatedMidpointCents)).toEqual(
      [312075, 249660, 686565],
    );
  });

  it("dispute_spike (BALANCED) - NEGATIVE_CASH_FLOW gate", () => {
    const fixture = loadFixtureDataset("persona_dispute_spike");
    const surplus = computeSurplus({
      merchantId: fixture.merchantId,
      transactions: fixture.transactions,
      asOf: PERSONA_AS_OF,
      availableBalanceCents: fixture.availableBalanceCents,
      balanceSource: fixture.balanceSource,
      monthlyObligationsCents: 300000,
      riskProfile: "BALANCED",
      openDisputes: fixture.openDisputes,
      excludedNonUsdCount: fixture.excludedNonUsdCount,
    });
    expect(surplus.modelStatus).toBe("NEGATIVE_CASH_FLOW");
    expect(surplus.cv).toBe(1);
    expect(surplus.bufferMonths).toBe(9);
    expect(surplus.bufferTargetCents).toBe(2700000);
    expect(surplus.riskReserveCents).toBe(325000);
    expect(surplus.safeSurplusCents).toBe(0);
    expect(surplus.stagingScheduleCents).toEqual([0, 0, 0, 0]);
  });
});

describe("fixtures ↔ engine: live_sandbox golden locks", () => {
  const live = loadFixtureDataset("live_sandbox");

  it("cash-flow summary equals the frozen exampleCashFlowSummary", () => {
    const summary = computeCashFlowSummary({
      merchantId: live.merchantId,
      transactions: live.transactions,
      asOf: DEMO_AS_OF,
      openDisputes: live.openDisputes,
      excludedNonUsdCount: live.excludedNonUsdCount,
    });
    expect(summary).toEqual(exampleCashFlowSummary);
  });

  it("surplus with the golden $18,500 balance equals the frozen exampleSurplusResult", () => {
    const surplus = computeSurplus({
      merchantId: live.merchantId,
      transactions: live.transactions,
      asOf: DEMO_AS_OF,
      availableBalanceCents: 1850000,
      balanceSource: "PAYPAL_REPORTING_API",
      monthlyObligationsCents: 300000,
      riskProfile: "BALANCED",
      openDisputes: live.openDisputes,
      excludedNonUsdCount: live.excludedNonUsdCount,
    });
    expect(surplus).toEqual(exampleSurplusResult);
  });
});

describe("seedFixtures", () => {
  it("seeds every merchant, is idempotent, and lands consistent dispute sums", () => {
    const db = newMemoryDb();

    const seededA = seedFixtures(db);
    expect(seededA.map((row) => row.merchantId)).toEqual(MERCHANT_IDS);
    const countsA = new Map(
      seededA.map(({ merchantId, transactionCount }) => [merchantId, transactionCount]),
    );
    expect(countsA.get("live_sandbox")).toBe(28);
    expect(countsA.get("persona_steady_retainer")).toBe(24);
    expect(countsA.get("persona_volatile_freelancer")).toBe(30);
    expect(countsA.get("persona_seasonal_seller")).toBe(27);
    expect(countsA.get("persona_dispute_spike")).toBe(25);

    // Re-run must not accumulate anything.
    seedFixtures(db);
    const rows = db
      .prepare(
        "SELECT merchantId, COUNT(*) AS count FROM normalized_transactions GROUP BY merchantId",
      )
      .all() as { merchantId: MerchantId; count: number }[];
    expect(rows).toHaveLength(MERCHANT_IDS.length);
    for (const row of rows) {
      expect(row.count).toBe(countsA.get(row.merchantId));
    }
    expect(db.prepare("SELECT COUNT(*) AS count FROM merchants").get()).toEqual({
      count: MERCHANT_IDS.length,
    });

    // Balance + dispute rows agree with fixture summaries.
    const balanceCount = (
      db.prepare("SELECT COUNT(*) AS count FROM balances").get() as { count: number }
    ).count;
    expect(balanceCount).toBe(MERCHANT_IDS.length);
    const disputes = db
      .prepare(
        "SELECT merchantId, COUNT(*) AS count, SUM(amountCents) AS total FROM open_disputes GROUP BY merchantId",
      )
      .all() as { merchantId: MerchantId; count: number; total: number }[];
    const fxSteady = db
      .prepare("SELECT availableCents FROM balances WHERE merchantId = ?")
      .get("persona_steady_retainer") as { availableCents: number };
    expect(fxSteady.availableCents).toBe(2500000);
    for (const row of disputes) {
      const fixture = loadFixtureDataset(row.merchantId);
      expect(row.count).toBe(fixture.openDisputes.count);
      expect(row.total).toBe(fixture.openDisputes.totalAmountCents);
    }
  });
});

describe("getMerchantDataset: fixture path", () => {
  it("resolves simulator personas from fixtures without PayPal credentials", async () => {
    const dataset = await getMerchantDataset("persona_steady_retainer", PERSONA_AS_OF);
    expect(dataset.availableBalanceCents).toBe(2500000);
    expect(dataset.balanceSource).toBe("FIXTURE");
    expect(dataset.transactions).toHaveLength(24);
  });
});
