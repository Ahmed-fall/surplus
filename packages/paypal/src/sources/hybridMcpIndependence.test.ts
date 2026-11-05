// Owner: R2. Task H-8: prove fixture personas, the seeder path and the live_sandbox
// hybrid dataset never depend on PayPal MCP. MCP is read-only and optional: when it is
// unavailable, the deterministic engine must still produce a valid plan from 11 fixture
// baseline months plus the live current month.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { NormalizedTransaction } from "@surplus/contracts";
import {
  computeAllocationPlan,
  computeCashFlowSummary,
  computeSurplus,
} from "../../../engine/src/index.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const AS_OF = "2026-08-15T00:00:00Z";

// 11 fixture baseline months from 2025-09 through 2026-07. The current month (2026-08)
// is supplied by live PayPal data, matching the HybridMerchantStore design (FACT-02).
const BASELINE_MONTHS = [
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
] as const;

function fixtureIncome(month: string, index: number): NormalizedTransaction {
  const grossCents = 300_000 + (index % 3) * 25_000;
  const feeCents = 9_000;
  return {
    id: `fix-hybrid-${month}-income`,
    merchantId: "live_sandbox",
    occurredAt: `${month}-05T12:00:00Z`,
    monthBucket: month,
    kind: "income",
    grossCents,
    feeCents,
    netCents: grossCents - feeCents,
    currency: "USD",
    status: "COMPLETED",
    counterpartyHash: "a1b2c3d4",
    source: "fixture",
  };
}

function fixtureWithdrawal(month: string): NormalizedTransaction {
  return {
    id: `fix-hybrid-${month}-withdrawal`,
    merchantId: "live_sandbox",
    occurredAt: `${month}-15T12:00:00Z`,
    monthBucket: month,
    kind: "withdrawal",
    grossCents: 180_000,
    feeCents: 0,
    netCents: -180_000,
    currency: "USD",
    status: "COMPLETED",
    counterpartyHash: "e5f6a7b8",
    source: "fixture",
  };
}

function liveCurrentMonthIncome(): NormalizedTransaction {
  return {
    id: "live-hybrid-2026-08-income",
    merchantId: "live_sandbox",
    occurredAt: "2026-08-10T12:00:00Z",
    monthBucket: "2026-08",
    kind: "income",
    grossCents: 120_000,
    feeCents: 3_500,
    netCents: 116_500,
    currency: "USD",
    status: "COMPLETED",
    counterpartyHash: "9f8e7d6c",
    source: "live",
  };
}

function hybridTransactions(): NormalizedTransaction[] {
  const baseline = BASELINE_MONTHS.flatMap((month, index) => [
    fixtureIncome(month, index),
    fixtureWithdrawal(month),
  ]);
  return [...baseline, liveCurrentMonthIncome()];
}

describe("live_sandbox hybrid data without MCP", () => {
  it("computes a valid engine result from 11 fixture months plus the live current month", () => {
    const transactions = hybridTransactions();
    const summary = computeCashFlowSummary({
      merchantId: "live_sandbox",
      transactions,
      asOf: AS_OF,
      openDisputes: { count: 0, totalAmountCents: 0, unheldAmountCents: 0 },
    });

    expect(summary.completedMonthsCount).toBe(11);
    expect(summary.monthlySeries.map((point) => point.monthBucket)).toEqual([...BASELINE_MONTHS]);
    expect(summary.monthlySeries.some((point) => point.monthBucket === "2026-08")).toBe(false);
    expect(summary.windows.month.grossIncomeCents).toBeGreaterThanOrEqual(120_000);

    const surplus = computeSurplus({
      merchantId: "live_sandbox",
      transactions,
      asOf: AS_OF,
      availableBalanceCents: 2_500_000,
      balanceSource: "LIVE_WEBHOOK_ADJUSTED",
      monthlyObligationsCents: 300_000,
      riskProfile: "BALANCED",
      openDisputes: { count: 0, totalAmountCents: 0, unheldAmountCents: 0 },
      excludedNonUsdCount: 0,
    });

    expect(surplus.modelStatus).toBe("OK");
    expect(surplus.merchantId).toBe("live_sandbox");
    expect(surplus.safeSurplusCents).toBeGreaterThanOrEqual(0);
    expect(surplus.stagingScheduleCents.reduce((total, cents) => total + cents, 0)).toBe(
      surplus.safeSurplusCents,
    );

    const plan = computeAllocationPlan(surplus);
    expect(plan.disclaimerId).toBe("EDUCATIONAL_NOT_FINANCIAL_ADVICE_V1");
    expect(plan.bands.reduce((total, band) => total + band.allocatedMidpointCents, 0)).toBe(
      surplus.safeSurplusCents,
    );
    expect(plan.stagingSchedule).toHaveLength(4);
  });
});

describe("MCP independence", () => {
  it("does not import MCP code from the seeder or the PayPal source layer", () => {
    const mcpImport =
      /connectPaypalMcp|sanitizeMcpOutput|mcpClient|mcpSanitizer|@paypal\/mcp|apps\/api\/src\/agent/;

    const sourcesDir = join(REPO_ROOT, "packages", "paypal", "src", "sources");
    const sourceFiles = readdirSync(sourcesDir).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );
    expect(sourceFiles.length).toBeGreaterThan(0);
    for (const name of sourceFiles) {
      expect(readFileSync(join(sourcesDir, name), "utf8")).not.toMatch(mcpImport);
    }

    const seedSource = readFileSync(join(REPO_ROOT, "scripts", "seed.ts"), "utf8");
    expect(seedSource).not.toMatch(mcpImport);
  });

  it("keeps fixture persona JSON free of MCP references when persona fixtures are present", () => {
    const mcpReference =
      /connectPaypalMcp|sanitizeMcpOutput|mcpClient|mcpSanitizer|@paypal\/mcp|apps\/api/;

    const fixturesDir = join(REPO_ROOT, "fixtures");
    const personaFiles = readdirSync(fixturesDir).filter(
      (name) => name.startsWith("persona_") && name.endsWith(".json"),
    );
    for (const name of personaFiles) {
      expect(readFileSync(join(fixturesDir, name), "utf8")).not.toMatch(mcpReference);
    }
  });
});
