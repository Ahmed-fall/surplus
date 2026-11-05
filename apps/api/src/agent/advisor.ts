// Owner: R4 (cross-owner change by R1 under H-3, approval tracked in issue).
// Task C-2/H-3: AI advisor orchestrator — tool-calling agent with grounding validator.
//
// Uses a two-stage approach:
// 1. generateText with tools (internal + MCP) to gather data via tool calls.
// 2. generateObject with the collected tool outputs as evidence to produce the
//    structured AdvisorResponse (narrativeMarkdown, citedNumbers, disclaimerId).
//
// This avoids Gemini's limitations combining tools + structured output in one call.
// Primary: Gemini 2.5 Flash. Fallback: GPT-4o-mini. 7 second budget per model call.
//
// If validation fails twice or the model times out, buildDeterministicTemplateNarrative
// returns a FALLBACK_TEMPLATE response using only engine outputs.
import { generateObject, generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import type {
  AdvisorResponse,
  AllocationPlan,
  CashFlowSummary,
  MerchantId,
  RiskProfile,
  SurplusResult,
  ToolTraceEntry,
  ValidatorStatus,
} from "@surplus/contracts";
import { DISCLAIMER_ID_V1, DISCLAIMER_TEXT_V1, LIVE_MERCHANT_ID } from "@surplus/contracts";
import {
  computeAllocationPlan,
  computeCashFlowSummary,
  computeSurplus,
} from "@surplus/engine";
import type { MerchantDataset } from "../routes/dataset.js";
import type { SafePaypalMcpTools } from "./mcpClient.js";
import { createAdvisorTools, createTraceRecorder } from "./tools.js";
import type { ToolOutputCollector } from "./groundingValidator.js";
import {
  buildAllowedNumberSet,
  validateAdvisorOutput,
} from "./groundingValidator.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_TIMEOUT_MS = 7_000;
const MAX_TOOL_STEPS = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunAdvisorTurnOptions {
  merchantId: MerchantId;
  dataset: MerchantDataset;
  asOf: string;
  monthlyObligationsCents?: number;
  riskProfile?: RiskProfile;
  /**
   * Lazy MCP tool provider. Called ONLY when merchantId === "live_sandbox".
   * If it returns undefined or throws, the turn continues with internal tools only.
   */
  getMcpTools?: () => Promise<
    { tools: SafePaypalMcpTools; close: () => Promise<void> } | undefined
  >;
}

// ---------------------------------------------------------------------------
// Last-good-plan cache
// ---------------------------------------------------------------------------

const lastGoodCache = new Map<MerchantId, AdvisorResponse>();

// ---------------------------------------------------------------------------
// Deterministic template fallback
// ---------------------------------------------------------------------------

function buildDeterministicTemplateNarrative(
  summary: CashFlowSummary,
  surplus: SurplusResult,
  plan: AllocationPlan,
): {
  narrativeMarkdown: string;
  citedNumbers: AdvisorResponse["citedNumbers"];
} {
  const fmtDollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const lines = [
    "## Your safe-to-invest surplus",
    "",
    `Over the last ${summary.completedMonthsCount} completed months your PayPal net cash flow had a baseline median of ${fmtDollars(summary.baselineMonthlyNetCents)} and an income volatility (coefficient of variation) of ${surplus.cv}.`,
    "",
    `The engine keeps a cash buffer of ${surplus.bufferMonths} months of your ${fmtDollars(surplus.monthlyObligationsCents)} monthly obligations — a target of ${fmtDollars(surplus.bufferTargetCents)}. On top of that it reserves ${fmtDollars(surplus.riskReserveCents)} for risk: ${fmtDollars(summary.openDisputes.unheldAmountCents)} of open disputes and ${fmtDollars(surplus.riskReserveCents - summary.openDisputes.unheldAmountCents)} of expected refund exposure (a 90-day refund rate of ${(summary.refundRate90d * 100).toFixed(0)}%).`,
    "",
    `That leaves a safe-to-invest surplus of ${fmtDollars(surplus.safeSurplusCents)} out of your ${fmtDollars(surplus.availableBalanceCents)} available balance. As an educational illustration, a ${surplus.riskProfile} profile stages this in ${surplus.stagingTrancheCount} tranches of about ${fmtDollars(surplus.stagingScheduleCents[0] ?? 0)} each.`,
  ];

  const citedNumbers: AdvisorResponse["citedNumbers"] = [
    { metricCode: "completed_months_count", rawValue: summary.completedMonthsCount, formattedText: `${summary.completedMonthsCount} months` },
    { metricCode: "baseline_monthly_net_cents", rawValue: summary.baselineMonthlyNetCents, formattedText: fmtDollars(summary.baselineMonthlyNetCents) },
    { metricCode: "cv", rawValue: surplus.cv, formattedText: String(surplus.cv) },
    { metricCode: "buffer_months", rawValue: surplus.bufferMonths, formattedText: `${surplus.bufferMonths} months` },
    { metricCode: "monthly_obligations_cents", rawValue: surplus.monthlyObligationsCents, formattedText: fmtDollars(surplus.monthlyObligationsCents) },
    { metricCode: "buffer_target_cents", rawValue: surplus.bufferTargetCents, formattedText: fmtDollars(surplus.bufferTargetCents) },
    { metricCode: "risk_reserve_cents", rawValue: surplus.riskReserveCents, formattedText: fmtDollars(surplus.riskReserveCents) },
    { metricCode: "available_balance_cents", rawValue: surplus.availableBalanceCents, formattedText: fmtDollars(surplus.availableBalanceCents) },
    { metricCode: "safe_surplus_cents", rawValue: surplus.safeSurplusCents, formattedText: fmtDollars(surplus.safeSurplusCents) },
    { metricCode: "first_tranche_cents", rawValue: surplus.stagingScheduleCents[0] ?? 0, formattedText: `about ${fmtDollars(surplus.stagingScheduleCents[0] ?? 0)}` },
  ];

  return { narrativeMarkdown: lines.join("\n"), citedNumbers };
}

// ---------------------------------------------------------------------------
// Structured output schema for the model's response
// ---------------------------------------------------------------------------

const AdvisorDraftSchema = z.object({
  narrativeMarkdown: z.string().describe(
    "Markdown narrative explaining the surplus. Cite numbers from tool outputs only. Never name specific tickers or securities. Always use educational framing.",
  ),
  citedNumbers: z.array(
    z.object({
      metricCode: z.string(),
      rawValue: z.number(),
      formattedText: z.string(),
    }),
  ).describe("Every number mentioned in the narrative, with its raw value from tool output."),
  disclaimerId: z.literal("EDUCATIONAL_NOT_FINANCIAL_ADVICE_V1"),
});

// ---------------------------------------------------------------------------
// Model providers
// ---------------------------------------------------------------------------

function getGeminiModel() {
  const apiKey = process.env["GOOGLE_GENERATIVE_AI_API_KEY"];
  if (!apiKey) return undefined;
  const google = createGoogleGenerativeAI({ apiKey });
  return google("gemini-2.5-flash");
}

function getOpenAIModel() {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return undefined;
  const openai = createOpenAI({ apiKey });
  return openai("gpt-4o-mini");
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the Surplus AI Advisor, an educational financial tool. Your job is to explain a PayPal merchant's cash flow, safe-to-invest surplus, and illustrative allocation plan.

CRITICAL RULES:
1. Call the available tools to gather data. Start with get_cash_flow_summary and get_surplus.
2. ONLY cite numbers that appear in tool outputs. Never invent, estimate, or calculate numbers.
3. Never name specific securities, tickers, ETFs, or funds (no AAPL, SPY, VOO, Vanguard, etc.).
4. Use asset class categories only: "Cash and Money Market", "Short-Term Treasuries and Bonds", "Broad Diversified Equity Index".
5. Never promise returns, guarantee outcomes, or claim money was moved.
6. Always frame everything as educational and illustrative.
7. disclaimerId must be exactly "EDUCATIONAL_NOT_FINANCIAL_ADVICE_V1".
8. Keep the narrative concise (under 300 words).
9. All dollar amounts should be formatted with $ and two decimal places.`;

// ---------------------------------------------------------------------------
// Core: run the advisor turn
// ---------------------------------------------------------------------------

export async function runAdvisorTurn(options: RunAdvisorTurnOptions): Promise<AdvisorResponse> {
  const {
    merchantId,
    dataset,
    asOf,
    riskProfile = "BALANCED",
    monthlyObligationsCents,
  } = options;

  // Compute engine outputs for fallback and validation
  const summary = computeCashFlowSummary({
    merchantId,
    transactions: dataset.transactions,
    asOf,
    openDisputes: dataset.openDisputes,
    excludedNonUsdCount: dataset.excludedNonUsdCount,
  });

  const surplus = computeSurplus({
    merchantId,
    transactions: dataset.transactions,
    asOf,
    availableBalanceCents: dataset.availableBalanceCents,
    balanceSource: dataset.balanceSource,
    monthlyObligationsCents,
    riskProfile,
    openDisputes: dataset.openDisputes,
    excludedNonUsdCount: dataset.excludedNonUsdCount,
  });

  const plan = computeAllocationPlan(surplus);

  // --- MCP tools: only for live_sandbox with a provider ---
  let mcpTools: SafePaypalMcpTools | undefined;
  let mcpClose: (() => Promise<void>) | undefined;

  if (merchantId === LIVE_MERCHANT_ID && options.getMcpTools) {
    try {
      const result = await options.getMcpTools();
      if (result) {
        mcpTools = result.tools;
        mcpClose = result.close;
      }
    } catch {
      // MCP failure: continue with internal tools only. Never fail the request.
    }
  }

  try {
    return await runWithModel(
      merchantId,
      dataset,
      asOf,
      riskProfile,
      monthlyObligationsCents,
      summary,
      surplus,
      plan,
      mcpTools,
    );
  } finally {
    // Always close the MCP client
    if (mcpClose) {
      try {
        await mcpClose();
      } catch {
        // Swallow close errors
      }
    }
  }
}

async function runWithModel(
  merchantId: MerchantId,
  dataset: MerchantDataset,
  asOf: string,
  riskProfile: RiskProfile,
  monthlyObligationsCents: number | undefined,
  summary: CashFlowSummary,
  surplus: SurplusResult,
  plan: AllocationPlan,
  mcpTools: SafePaypalMcpTools | undefined,
): Promise<AdvisorResponse> {
  const recorder = createTraceRecorder();
  const tools = createAdvisorTools(
    { merchantId, dataset, asOf, riskProfile, monthlyObligationsCents },
    recorder,
    mcpTools,
  );

  // Build the allowed number set from all engine outputs
  const collected: ToolOutputCollector = {
    summary,
    surplus,
    plan,
    mcpSummaries: [],
  };
  const allowed = buildAllowedNumberSet(collected);

  // Try primary model, then fallback
  const models = [getGeminiModel(), getOpenAIModel()].filter(
    (m): m is NonNullable<typeof m> => m !== undefined,
  );

  if (models.length === 0) {
    // No API keys configured — use template fallback
    return buildFallbackResponse(merchantId, summary, surplus, plan, recorder.entries);
  }

  for (const model of models) {
    try {
      const result = await attemptGeneration(
        model,
        tools,
        summary,
        surplus,
        plan,
        allowed,
        recorder,
        collected,
      );
      if (result) {
        lastGoodCache.set(merchantId, result.response);
        return {
          ...result.response,
          merchantId,
          toolTrace: recorder.entries,
          generatedAt: new Date().toISOString(),
        };
      }
    } catch {
      // Model failed — try next provider
      continue;
    }
  }

  // All models failed — use template fallback
  return buildFallbackResponse(merchantId, summary, surplus, plan, recorder.entries);
}

async function attemptGeneration(
  model: ReturnType<typeof getGeminiModel>,
  tools: ReturnType<typeof createAdvisorTools>,
  summary: CashFlowSummary,
  surplus: SurplusResult,
  plan: AllocationPlan,
  allowed: ReturnType<typeof buildAllowedNumberSet>,
  recorder: ReturnType<typeof createTraceRecorder>,
  collected: ToolOutputCollector,
): Promise<{ response: AdvisorResponse } | null> {
  if (!model) return null;

  // Stage 1: tool-calling phase — gather data through tools
  try {
    const textResult = await generateText({
      model,
      tools,
      system: SYSTEM_PROMPT,
      prompt: `Analyze the merchant's PayPal cash flow and surplus. Use the available tools to gather the data, then summarize your findings.`,
      maxSteps: MAX_TOOL_STEPS,
      abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    });

    // Update allowed numbers from MCP tool trace entries
    for (const entry of recorder.entries) {
      if (entry.toolName.startsWith("paypal_mcp_")) {
        collected.mcpSummaries.push(entry.sanitizedOutputSummary);
      }
    }
    // Rebuild allowed set with MCP data included
    const updatedAllowed = buildAllowedNumberSet(collected);

    // Stage 2: structured output using tool results as evidence
    const evidence = {
      summary: {
        completedMonthsCount: summary.completedMonthsCount,
        baselineMonthlyNetCents: summary.baselineMonthlyNetCents,
        meanMonthlyNetCents: summary.meanMonthlyNetCents,
        cv: summary.cv,
        refundRate90d: summary.refundRate90d,
        openDisputes: summary.openDisputes,
        windows: {
          week: { transactionCount: summary.windows.week.transactionCount, netCashFlowCents: summary.windows.week.netCashFlowCents },
          month: { transactionCount: summary.windows.month.transactionCount, netCashFlowCents: summary.windows.month.netCashFlowCents },
          year: { transactionCount: summary.windows.year.transactionCount, netCashFlowCents: summary.windows.year.netCashFlowCents },
        },
      },
      surplus: {
        modelStatus: surplus.modelStatus,
        availableBalanceCents: surplus.availableBalanceCents,
        monthlyObligationsCents: surplus.monthlyObligationsCents,
        bufferMonths: surplus.bufferMonths,
        bufferTargetCents: surplus.bufferTargetCents,
        riskReserveCents: surplus.riskReserveCents,
        safeSurplusCents: surplus.safeSurplusCents,
        stagingTrancheCount: surplus.stagingTrancheCount,
        stagingScheduleCents: surplus.stagingScheduleCents,
        riskProfile: surplus.riskProfile,
        cv: surplus.cv,
      },
      plan: {
        bands: plan.bands.map((b) => ({
          assetClass: b.assetClass,
          label: b.label,
          targetMidpointPct: b.targetMidpointPct,
          allocatedMidpointCents: b.allocatedMidpointCents,
        })),
        highVolatilityShiftApplied: plan.highVolatilityShiftApplied,
      },
      toolStepSummary: textResult.text?.slice(0, 500),
      mcpToolResults: recorder.entries
        .filter((e) => e.toolName.startsWith("paypal_mcp_"))
        .map((e) => ({ tool: e.toolName, ...e.sanitizedOutputSummary })),
    };

    // Attempt 1
    const draft1 = await generateStructuredDraft(model, evidence);
    const validation1 = validateAdvisorOutput(
      {
        narrativeMarkdown: draft1.narrativeMarkdown,
        citedNumbers: draft1.citedNumbers,
        disclaimerId: draft1.disclaimerId,
      },
      updatedAllowed,
    );

    if (validation1.passed) {
      return {
        response: {
          merchantId: surplus.merchantId,
          narrativeMarkdown: draft1.narrativeMarkdown,
          citedNumbers: draft1.citedNumbers,
          toolTrace: recorder.entries,
          validatorStatus: "PASSED" as ValidatorStatus,
          validatorMismatchesCaught: [],
          disclaimerId: DISCLAIMER_ID_V1,
          disclaimerText: DISCLAIMER_TEXT_V1,
          generatedAt: new Date().toISOString(),
        },
      };
    }

    // Attempt 2: regenerate with mismatches feedback
    const draft2 = await generateStructuredDraft(model, evidence, validation1.mismatches);
    const validation2 = validateAdvisorOutput(
      {
        narrativeMarkdown: draft2.narrativeMarkdown,
        citedNumbers: draft2.citedNumbers,
        disclaimerId: draft2.disclaimerId,
      },
      updatedAllowed,
    );

    if (validation2.passed) {
      return {
        response: {
          merchantId: surplus.merchantId,
          narrativeMarkdown: draft2.narrativeMarkdown,
          citedNumbers: draft2.citedNumbers,
          toolTrace: recorder.entries,
          validatorStatus: "REGENERATED_PASSED" as ValidatorStatus,
          validatorMismatchesCaught: validation1.mismatches,
          disclaimerId: DISCLAIMER_ID_V1,
          disclaimerText: DISCLAIMER_TEXT_V1,
          generatedAt: new Date().toISOString(),
        },
      };
    }

    // Both attempts failed — fall through to template
    return null;
  } catch {
    // Model timeout or error — try next provider
    throw new Error("MODEL_FAILED");
  }
}

async function generateStructuredDraft(
  model: NonNullable<ReturnType<typeof getGeminiModel>>,
  evidence: Record<string, unknown>,
  rejectedTokens?: string[],
) {
  const prompt = rejectedTokens
    ? `Based on these tool outputs, write a grounded educational narrative. Your PREVIOUS attempt was rejected because these tokens were not found in tool outputs: ${rejectedTokens.join(", ")}. Remove or fix them. Only cite numbers from the evidence below.\n\nEvidence:\n${JSON.stringify(evidence, null, 2)}`
    : `Based on these tool outputs, write a grounded educational narrative explaining the merchant's surplus and allocation plan. Only cite numbers that appear in the evidence.\n\nEvidence:\n${JSON.stringify(evidence, null, 2)}`;

  const result = await generateObject({
    model,
    schema: AdvisorDraftSchema,
    system: SYSTEM_PROMPT,
    prompt,
    abortSignal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });

  return result.object;
}

function buildFallbackResponse(
  merchantId: MerchantId,
  summary: CashFlowSummary,
  surplus: SurplusResult,
  plan: AllocationPlan,
  toolTrace: ToolTraceEntry[],
): AdvisorResponse {
  // Try last-good cache first
  const cached = lastGoodCache.get(merchantId);
  if (cached) {
    return {
      ...cached,
      toolTrace,
      validatorStatus: "FALLBACK_TEMPLATE",
      generatedAt: new Date().toISOString(),
    };
  }

  const { narrativeMarkdown, citedNumbers } = buildDeterministicTemplateNarrative(
    summary,
    surplus,
    plan,
  );

  return {
    merchantId,
    narrativeMarkdown,
    citedNumbers,
    toolTrace,
    validatorStatus: "FALLBACK_TEMPLATE",
    validatorMismatchesCaught: [],
    disclaimerId: DISCLAIMER_ID_V1,
    disclaimerText: DISCLAIMER_TEXT_V1,
    generatedAt: new Date().toISOString(),
  };
}

