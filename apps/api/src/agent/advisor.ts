import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type {
  AdvisorResponse,
  AllocationPlan,
  CashFlowSummary,
  MerchantId,
  RiskProfile,
  ScenarioComparisonResult,
  SurplusResult,
  ToolTraceEntry,
  ValidatorStatus,
} from "@surplus/contracts";
import { AdvisorResponseSchema, DISCLAIMER_ID_V1, DISCLAIMER_TEXT_V1 } from "@surplus/contracts";
import { generateObject, generateText } from "ai";
import type { Tool, ToolExecutionOptions, ToolSet } from "ai";
import { z } from "zod";
import type { MerchantDataset } from "../routes/dataset.js";
import { buildDeterministicTemplateNarrative } from "./fallbackTemplate.js";
import type { AdvisorDraft } from "./groundingValidator.js";
import { validateAdvisorOutput } from "./groundingValidator.js";
import { defaultLastGoodPlanCache, type LastGoodPlanCache } from "./lastGoodPlanCache.js";
import type { SanitizedMcpOutput } from "./mcpSanitizer.js";
import { createAdvisorTools } from "./tools.js";
import type { AdvisorEngineContext, SafePaypalMcpTools } from "./tools.js";

const PRIMARY_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gpt-4o-mini";
const TOOL_LOOP_MAX_STEPS = 5;
export const MODEL_TIMEOUT_MS = 7_000;
export const ADVISOR_ENV_KEYS = {
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  openai: "OPENAI_API_KEY",
} as const;

const INTERNAL_TOOL_NAMES = [
  "get_cash_flow_summary",
  "get_surplus",
  "get_allocation_plan",
] as const;
type InternalToolName = (typeof INTERNAL_TOOL_NAMES)[number];
const TRACEABLE_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...INTERNAL_TOOL_NAMES,
  "run_scenario",
  "paypal_mcp_list_transactions",
  "paypal_mcp_list_disputes",
]);

const AdvisorDraftSchema = z.object({
  narrativeMarkdown: z.string().min(1),
  citedNumbers: z.array(
    z.object({
      metricCode: z.string().min(1),
      rawValue: z.number(),
      formattedText: z.string().min(1),
    }),
  ),
  disclaimerId: z.literal(DISCLAIMER_ID_V1),
});

export interface RunAdvisorTurnInput {
  merchantId: MerchantId;
  dataset: MerchantDataset;
  asOf: string;
  monthlyObligationsCents?: number;
  riskProfile?: RiskProfile;
  question?: string;
}

export type AdvisorProvider = "primary" | "fallback";

export interface ExternalToolSummary {
  toolName: "paypal_mcp_list_transactions" | "paypal_mcp_list_disputes";
  summary: Record<string, number | string>;
}

export interface PaypalMcpSession {
  tools: SafePaypalMcpTools;
  close: () => Promise<void>;
}

export type GetMcpTools = () => Promise<PaypalMcpSession | undefined>;

export type AdvisorToolSet = ReturnType<typeof createAdvisorTools>;

export interface AdvisorToolLoopInput {
  provider: AdvisorProvider;
  tools: AdvisorToolSet;
  question?: string;
  abortSignal?: AbortSignal;
}

export type AdvisorToolLoop = (input: AdvisorToolLoopInput) => Promise<void>;

export type AdvisorDraftGenerator = (input: {
  provider: AdvisorProvider;
  evidence: {
    summary: CashFlowSummary;
    surplus: SurplusResult;
    plan: AllocationPlan;
    externalToolSummaries?: ExternalToolSummary[];
  };
  question?: string;
  rejectedTokens: string[];
}) => Promise<AdvisorDraft>;

export interface RunAdvisorTurnOptions {
  generateDraft?: AdvisorDraftGenerator;
  getMcpTools?: GetMcpTools;
  runToolLoop?: AdvisorToolLoop;
  now?: () => Date;
  planCache?: LastGoodPlanCache;
  modelTimeoutMs?: number;
}

function productionGenerator(): AdvisorDraftGenerator {
  const google = createGoogleGenerativeAI({ apiKey: process.env[ADVISOR_ENV_KEYS.google] });
  const openai = createOpenAI({ apiKey: process.env[ADVISOR_ENV_KEYS.openai] });

  return async ({ provider, evidence, question, rejectedTokens }) => {
    const result = await generateObject({
      model: provider === "primary" ? google(PRIMARY_MODEL) : openai(FALLBACK_MODEL),
      schema: AdvisorDraftSchema,
      mode: "json",
      system: [
        "You are an educational PayPal cash-flow advisor.",
        "Use only the supplied deterministic evidence. Never calculate or invent a number.",
        "Never name a security, ticker, fund provider, cryptocurrency, or promise a return.",
        `Always return disclaimerId ${DISCLAIMER_ID_V1}.`,
        "Every cited rawValue must be copied exactly from the evidence.",
        rejectedTokens.length > 0
          ? `A prior draft was rejected. Do not emit these exact tokens: ${JSON.stringify(rejectedTokens)}.`
          : "This is the first generation attempt.",
      ].join("\n"),
      prompt: JSON.stringify({
        question: question ?? "Explain my educational surplus plan.",
        evidence,
      }),
    });
    return AdvisorDraftSchema.parse(result.object);
  };
}

function productionToolLoop({
  provider,
  tools,
  question,
  abortSignal,
}: AdvisorToolLoopInput): Promise<void> {
  const google = createGoogleGenerativeAI({ apiKey: process.env[ADVISOR_ENV_KEYS.google] });
  const openai = createOpenAI({ apiKey: process.env[ADVISOR_ENV_KEYS.openai] });

  return generateText({
    model: provider === "primary" ? google(PRIMARY_MODEL) : openai(FALLBACK_MODEL),
    tools,
    maxSteps: TOOL_LOOP_MAX_STEPS,
    abortSignal,
    system: [
      "You are gathering read-only PayPal evidence for an educational cash-flow advisor.",
      "Call only the provided read-only tools.",
      "Do not calculate, advise, or write narrative in this step.",
      "Use the merchant question only to choose which tools to call.",
    ].join("\n"),
    prompt:
      question ?? "Gather cash-flow, surplus, allocation-plan, and PayPal page-count evidence.",
  }).then(() => undefined);
}

interface TracedTools {
  tools: AdvisorToolSet;
  toolTrace: ToolTraceEntry[];
  outputs: unknown[];
  latestOutput: Map<string, unknown>;
}

function isTraceableToolName(name: string): name is ToolTraceEntry["toolName"] {
  return TRACEABLE_TOOL_NAMES.has(name);
}

function summarizeOutput(
  toolName: ToolTraceEntry["toolName"],
  output: unknown,
): Record<string, number | string> {
  if (typeof output !== "object" || output === null) return {};
  switch (toolName) {
    case "get_cash_flow_summary": {
      const summary = output as CashFlowSummary;
      return {
        completedMonthsCount: summary.completedMonthsCount,
        baselineMonthlyNetCents: summary.baselineMonthlyNetCents,
      };
    }
    case "get_surplus": {
      const surplus = output as SurplusResult;
      return {
        modelStatus: surplus.modelStatus,
        safeSurplusCents: surplus.safeSurplusCents,
      };
    }
    case "get_allocation_plan": {
      const plan = output as AllocationPlan;
      return {
        bandCount: plan.bands.length,
        stagingTrancheCount: plan.stagingSchedule.length,
      };
    }
    case "run_scenario": {
      const scenario = output as ScenarioComparisonResult;
      return {
        deltaSafeSurplusCents: scenario.deltaSafeSurplusCents,
        deltaBufferMonths: scenario.deltaBufferMonths,
      };
    }
    case "paypal_mcp_list_transactions":
    case "paypal_mcp_list_disputes": {
      const summary = output as SanitizedMcpOutput;
      const safe: Record<string, number> = {};
      if (summary.recordsOnPage !== undefined) safe["recordsOnPage"] = summary.recordsOnPage;
      if (summary.totalItems !== undefined) safe["totalItems"] = summary.totalItems;
      if (summary.totalPages !== undefined) safe["totalPages"] = summary.totalPages;
      return safe;
    }
    default:
      return {};
  }
}

function traceTools(tools: AdvisorToolSet): TracedTools {
  const toolTrace: ToolTraceEntry[] = [];
  const outputs: unknown[] = [];
  const latestOutput = new Map<string, unknown>();
  const wrapped: ToolSet = {};

  for (const [name, source] of Object.entries(tools)) {
    const execute = source.execute;
    if (execute === undefined) {
      wrapped[name] = source;
      continue;
    }
    wrapped[name] = {
      ...source,
      execute: async (args: unknown, options: ToolExecutionOptions) => {
        const startedAt = Date.now();
        const result = await execute(args as never, options);
        if (isTraceableToolName(name)) {
          const durationMs = Math.max(0, Date.now() - startedAt);
          toolTrace.push({
            toolName: name,
            durationMs,
            sanitizedOutputSummary: summarizeOutput(name, result),
          });
          outputs.push(result);
          latestOutput.set(name, result);
        }
        return result;
      },
    } as Tool;
  }

  return { tools: wrapped as AdvisorToolSet, toolTrace, outputs, latestOutput };
}

function engineContext(input: RunAdvisorTurnInput): AdvisorEngineContext {
  return {
    merchantId: input.merchantId,
    transactions: input.dataset.transactions,
    asOf: input.asOf,
    availableBalanceCents: input.dataset.availableBalanceCents,
    balanceSource: input.dataset.balanceSource,
    monthlyObligationsCents: input.monthlyObligationsCents,
    riskProfile: input.riskProfile ?? ("BALANCED" as const),
    openDisputes: input.dataset.openDisputes,
    excludedNonUsdCount: input.dataset.excludedNonUsdCount,
  };
}

async function ensureOutput<T>(recorder: TracedTools, name: InternalToolName): Promise<T> {
  if (recorder.latestOutput.has(name)) return recorder.latestOutput.get(name) as T;
  const execute = recorder.tools[name]?.execute;
  if (execute === undefined) throw new Error(`TOOL_UNAVAILABLE:${name}`);
  return (await execute(
    {},
    {
      toolCallId: `internal-${name}`,
      messages: [],
    },
  )) as T;
}

async function closeMcp(session: PaypalMcpSession | undefined): Promise<void> {
  if (session === undefined) return;
  try {
    await session.close();
  } catch {
    return;
  }
}

async function openMcp(
  input: RunAdvisorTurnInput,
  options: RunAdvisorTurnOptions,
): Promise<PaypalMcpSession | undefined> {
  if (input.merchantId !== "live_sandbox" || options.getMcpTools === undefined) return undefined;
  try {
    const session = await options.getMcpTools();
    if (session === undefined) return undefined;
    if (
      session.tools["paypal_mcp_list_transactions"] === undefined &&
      session.tools["paypal_mcp_list_disputes"] === undefined
    ) {
      await closeMcp(session);
      return undefined;
    }
    return session;
  } catch {
    return undefined;
  }
}

async function invokeWithAbortableTimeout<T>(
  operation: (abortSignal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new ModelTimeoutError());
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function runToolLoopWithFallback(
  loop: AdvisorToolLoop,
  tools: AdvisorToolSet,
  question: string | undefined,
  timeoutMs: number,
): Promise<void> {
  for (const provider of ["primary", "fallback"] as const) {
    try {
      await invokeWithAbortableTimeout(
        (abortSignal) => loop({ provider, tools, question, abortSignal }),
        timeoutMs,
      );
      return;
    } catch {
      continue;
    }
  }
}

async function buildEvidence(
  input: RunAdvisorTurnInput,
  options: RunAdvisorTurnOptions,
  mcp: PaypalMcpSession | undefined,
): Promise<{
  summary: CashFlowSummary;
  surplus: SurplusResult;
  plan: AllocationPlan;
  toolTrace: ToolTraceEntry[];
  outputs: unknown[];
  externalToolSummaries: ExternalToolSummary[];
}> {
  const recorder = traceTools(createAdvisorTools(engineContext(input), mcp?.tools));
  if (mcp !== undefined) {
    await runToolLoopWithFallback(
      options.runToolLoop ?? productionToolLoop,
      recorder.tools,
      input.question,
      options.modelTimeoutMs ?? MODEL_TIMEOUT_MS,
    );
  }

  const summary = await ensureOutput<CashFlowSummary>(recorder, "get_cash_flow_summary");
  const surplus = await ensureOutput<SurplusResult>(recorder, "get_surplus");
  const plan = await ensureOutput<AllocationPlan>(recorder, "get_allocation_plan");
  const toolTrace = [...recorder.toolTrace];
  const externalToolSummaries = toolTrace.flatMap<ExternalToolSummary>((entry) => {
    if (
      entry.toolName === "paypal_mcp_list_transactions" ||
      entry.toolName === "paypal_mcp_list_disputes"
    ) {
      return [{ toolName: entry.toolName, summary: entry.sanitizedOutputSummary }];
    }
    return [];
  });

  return {
    summary,
    surplus,
    plan,
    toolTrace,
    outputs: [...recorder.outputs],
    externalToolSummaries,
  };
}

async function generateWithProviderFallback(
  generator: AdvisorDraftGenerator,
  request: Omit<Parameters<AdvisorDraftGenerator>[0], "provider">,
  failures: string[],
  timeoutMs: number,
): Promise<AdvisorDraft | undefined> {
  const invoke = async (provider: AdvisorProvider): Promise<AdvisorDraft> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        generator({ ...request, provider }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new ModelTimeoutError()), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };

  try {
    return await invoke("primary");
  } catch (error) {
    if (error instanceof ModelTimeoutError) {
      failures.push("model:timeout");
      return undefined;
    }
    failures.push("model:primary_failed");
  }
  try {
    return await invoke("fallback");
  } catch (error) {
    if (error instanceof ModelTimeoutError) failures.push("model:timeout");
    failures.push("model:fallback_failed");
    return undefined;
  }
}

class ModelTimeoutError extends Error {}

function response(
  input: RunAdvisorTurnInput,
  draft: AdvisorDraft,
  toolTrace: ToolTraceEntry[],
  validatorStatus: ValidatorStatus,
  mismatches: string[],
  now: () => Date,
): AdvisorResponse {
  return AdvisorResponseSchema.parse({
    merchantId: input.merchantId,
    ...draft,
    toolTrace,
    validatorStatus,
    validatorMismatchesCaught: mismatches,
    disclaimerText: DISCLAIMER_TEXT_V1,
    generatedAt: now().toISOString(),
  });
}

/** C-2 orchestration: deterministic evidence, provider fallback, validation, one repair, template. */
export async function runAdvisorTurn(
  input: RunAdvisorTurnInput,
  options: RunAdvisorTurnOptions = {},
): Promise<AdvisorResponse> {
  const mcp = await openMcp(input, options);
  let evidenceBundle;
  try {
    evidenceBundle = await buildEvidence(input, options, mcp);
  } finally {
    await closeMcp(mcp);
  }

  const { summary, surplus, plan, toolTrace, outputs, externalToolSummaries } = evidenceBundle;
  (options.planCache ?? defaultLastGoodPlanCache).set(plan);
  const evidence = { summary, surplus, plan, externalToolSummaries };
  const generator = options.generateDraft ?? productionGenerator();
  const mismatches: string[] = [];

  const first = await generateWithProviderFallback(
    generator,
    { evidence, question: input.question, rejectedTokens: [] },
    mismatches,
    options.modelTimeoutMs ?? MODEL_TIMEOUT_MS,
  );
  if (first) {
    const validation = validateAdvisorOutput(first, outputs);
    if (validation.valid) {
      return response(
        input,
        first,
        toolTrace,
        "PASSED",
        mismatches,
        options.now ?? (() => new Date()),
      );
    }
    mismatches.push(...validation.mismatches);
    const regenerated = await generateWithProviderFallback(
      generator,
      { evidence, question: input.question, rejectedTokens: validation.mismatches },
      mismatches,
      options.modelTimeoutMs ?? MODEL_TIMEOUT_MS,
    );
    if (regenerated) {
      const regeneratedValidation = validateAdvisorOutput(regenerated, outputs);
      if (regeneratedValidation.valid) {
        return response(
          input,
          regenerated,
          toolTrace,
          "REGENERATED_PASSED",
          mismatches,
          options.now ?? (() => new Date()),
        );
      }
      mismatches.push(...regeneratedValidation.mismatches);
    }
  }

  const fallback = buildDeterministicTemplateNarrative(summary, surplus, plan);
  return response(
    input,
    fallback,
    toolTrace,
    "FALLBACK_TEMPLATE",
    mismatches,
    options.now ?? (() => new Date()),
  );
}
