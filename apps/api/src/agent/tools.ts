// Owner: R4 (cross-owner change by R1 under H-3, approval tracked in issue).
// Task F-11/H-3: advisor tool registry.
//
// Registers 4 internal engine tools (deterministic, pure) and optionally merges
// sanitized read-only MCP tools. Only contract-allowed MCP tools are included.
// No money math here: every cents value comes from @surplus/engine.
import { tool } from "ai";
import { z } from "zod";
import type {
  AllocationPlan,
  CashFlowSummary,
  MerchantId,
  RiskProfile,
  ScenarioComparisonResult,
  SurplusResult,
  ToolTraceEntry,
} from "@surplus/contracts";
import type { AdvisorToolName } from "@surplus/contracts";
import {
  computeAllocationPlan,
  computeCashFlowSummary,
  computeSurplus,
  runScenarioComparison,
} from "@surplus/engine";
import type { MerchantDataset } from "../routes/dataset.js";
import type { SafePaypalMcpTools } from "./mcpClient.js";
import { contractAllowedMcpTools } from "./mcpClient.js";

// ---------------------------------------------------------------------------
// Context that internal tools close over
// ---------------------------------------------------------------------------

export interface AdvisorToolContext {
  merchantId: MerchantId;
  dataset: MerchantDataset;
  asOf: string;
  /** Default obligations; overridden if the user provided one in the request. */
  monthlyObligationsCents?: number;
  /** Default risk profile from the request. */
  riskProfile: RiskProfile;
}

// ---------------------------------------------------------------------------
// Tool trace recorder
// ---------------------------------------------------------------------------

export interface ToolTraceRecorder {
  entries: ToolTraceEntry[];
  /** Wraps a tool execution to record timing and output summary. */
  record<T>(
    toolName: AdvisorToolName,
    fn: () => T | Promise<T>,
    summarize: (result: T) => Record<string, number | string>,
  ): Promise<T>;
}

export function createTraceRecorder(): ToolTraceRecorder {
  const entries: ToolTraceEntry[] = [];
  return {
    entries,
    async record(toolName, fn, summarize) {
      const start = Date.now();
      const result = await fn();
      const durationMs = Date.now() - start;
      entries.push({
        toolName,
        durationMs,
        sanitizedOutputSummary: summarize(result),
      });
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Internal engine tools
// ---------------------------------------------------------------------------

function createInternalTools(context: AdvisorToolContext, recorder: ToolTraceRecorder) {
  const { merchantId, dataset, asOf, riskProfile } = context;

  const getCashFlowSummary = tool({
    description:
      "Get the cash flow summary: monthly series, trailing windows, CV, refund rate, open disputes.",
    parameters: z.object({}),
    execute: async () => {
      return recorder.record(
        "get_cash_flow_summary",
        () =>
          computeCashFlowSummary({
            merchantId,
            transactions: dataset.transactions,
            asOf,
            openDisputes: dataset.openDisputes,
            excludedNonUsdCount: dataset.excludedNonUsdCount,
          }),
        (r: CashFlowSummary) => ({
          completedMonthsCount: r.completedMonthsCount,
          transactionCountYear: r.windows.year.transactionCount,
          cv: r.cv,
          refundRate90d: r.refundRate90d,
          baselineMonthlyNetCents: r.baselineMonthlyNetCents,
        }),
      );
    },
  });

  const getSurplus = tool({
    description:
      "Compute the safe-to-invest surplus: buffer target, risk reserve, staging schedule.",
    parameters: z.object({
      monthlyObligationsCents: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Monthly obligations in cents. Uses the request default if omitted."),
    }),
    execute: async (args) => {
      const obligations = args.monthlyObligationsCents ?? context.monthlyObligationsCents;
      return recorder.record(
        "get_surplus",
        () =>
          computeSurplus({
            merchantId,
            transactions: dataset.transactions,
            asOf,
            availableBalanceCents: dataset.availableBalanceCents,
            balanceSource: dataset.balanceSource,
            monthlyObligationsCents: obligations,
            riskProfile,
            openDisputes: dataset.openDisputes,
            excludedNonUsdCount: dataset.excludedNonUsdCount,
          }),
        (r: SurplusResult) => ({
          modelStatus: r.modelStatus,
          bufferMonths: r.bufferMonths,
          safeSurplusCents: r.safeSurplusCents,
          availableBalanceCents: r.availableBalanceCents,
          riskReserveCents: r.riskReserveCents,
          bufferTargetCents: r.bufferTargetCents,
        }),
      );
    },
  });

  const getAllocationPlan = tool({
    description:
      "Compute the allocation plan: asset class bands, staging schedule, disclaimer.",
    parameters: z.object({
      monthlyObligationsCents: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Monthly obligations in cents. Uses the request default if omitted."),
    }),
    execute: async (args) => {
      const obligations = args.monthlyObligationsCents ?? context.monthlyObligationsCents;
      const surplus = computeSurplus({
        merchantId,
        transactions: dataset.transactions,
        asOf,
        availableBalanceCents: dataset.availableBalanceCents,
        balanceSource: dataset.balanceSource,
        monthlyObligationsCents: obligations,
        riskProfile,
        openDisputes: dataset.openDisputes,
        excludedNonUsdCount: dataset.excludedNonUsdCount,
      });
      return recorder.record(
        "get_allocation_plan",
        () => computeAllocationPlan(surplus),
        (r: AllocationPlan) => ({
          bandCount: r.bands.length,
          firstTrancheCents: r.stagingSchedule[0]?.amountCents ?? 0,
          safeSurplusCents: r.safeSurplusCents,
          highVolatilityShiftApplied: String(r.highVolatilityShiftApplied),
        }),
      );
    },
  });

  const runScenario = tool({
    description:
      "Run a what-if scenario: apply income shock, delayed payment, one-off expense.",
    parameters: z.object({
      incomeShockPct: z.number().int().min(-80).max(50).describe("Income shock percentage."),
      delayedPaymentCents: z
        .number()
        .int()
        .nonnegative()
        .describe("Delayed payment in cents."),
      oneOffExpenseCents: z
        .number()
        .int()
        .nonnegative()
        .describe("One-off expense in cents."),
      monthlyObligationsCents: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Monthly obligations in cents. Uses the request default if omitted."),
    }),
    execute: async (args) => {
      const obligations = args.monthlyObligationsCents ?? context.monthlyObligationsCents;
      return recorder.record(
        "run_scenario",
        () =>
          runScenarioComparison(
            {
              merchantId,
              transactions: dataset.transactions,
              asOf,
              availableBalanceCents: dataset.availableBalanceCents,
              balanceSource: dataset.balanceSource,
              monthlyObligationsCents: obligations,
              riskProfile,
              openDisputes: dataset.openDisputes,
              excludedNonUsdCount: dataset.excludedNonUsdCount,
            },
            {
              merchantId,
              monthlyObligationsCents: obligations ?? 0,
              riskProfile,
              incomeShockPct: args.incomeShockPct,
              delayedPaymentCents: args.delayedPaymentCents,
              oneOffExpenseCents: args.oneOffExpenseCents,
            },
          ),
        (r: ScenarioComparisonResult) => ({
          deltaSafeSurplusCents: r.deltaSafeSurplusCents,
          deltaBufferMonths: r.deltaBufferMonths,
        }),
      );
    },
  });

  return {
    get_cash_flow_summary: getCashFlowSummary,
    get_surplus: getSurplus,
    get_allocation_plan: getAllocationPlan,
    run_scenario: runScenario,
  };
}

// ---------------------------------------------------------------------------
// Public: create the full tool set for an advisor turn
// ---------------------------------------------------------------------------

/**
 * Creates the merged tool registry: 4 internal engine tools + contract-allowed
 * MCP tools. MCP tools are filtered to only those whose prefixed name is in the
 * ToolTraceEntry.toolName union (contracts). get_merchant_insights is excluded.
 */
export function createAdvisorTools(
  context: AdvisorToolContext,
  recorder: ToolTraceRecorder,
  paypalMcpTools?: SafePaypalMcpTools,
) {
  const internal = createInternalTools(context, recorder);

  // Wrap MCP tools with trace recording
  const mcpAllowed = paypalMcpTools ? contractAllowedMcpTools(paypalMcpTools) : {};
  const tracedMcp: Record<string, ReturnType<typeof tool>> = {};

  for (const [name, mcpTool] of Object.entries(mcpAllowed)) {
    const toolName = name as AdvisorToolName;
    const originalExecute = mcpTool.execute;
    tracedMcp[name] = tool({
      description: mcpTool.description ?? `PayPal MCP ${name}`,
      parameters: mcpTool.parameters,
      execute: async (args, options) => {
        return recorder.record(
          toolName,
          () => originalExecute(args, options),
          (r) => {
            // r is SanitizedMcpOutput — all values are numbers or undefined
            const summary: Record<string, number | string> = {};
            const out = r as Record<string, unknown>;
            for (const [k, v] of Object.entries(out)) {
              if (typeof v === "number") summary[k] = v;
              else if (typeof v === "string") summary[k] = v;
            }
            return summary;
          },
        );
      },
    });
  }

  return { ...internal, ...tracedMcp };
}

