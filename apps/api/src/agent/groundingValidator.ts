// Owner: R4 (cross-owner change by R1 under H-3, approval tracked in issue).
// Task C-2/H-3: grounding validator — rejects ungrounded numbers, banned tickers,
// banned promises, and missing disclaimers. See AGENT_CONTEXT Section 10.
//
// Stage 1: build an AllowedNumberSet from tool outputs.
// Stage 2: extract and validate numbers, tickers, promises, disclaimer.
import type { AdvisorToolName, ToolTraceEntry } from "@surplus/contracts";
import type {
  AllocationPlan,
  CashFlowSummary,
  SurplusResult,
  ScenarioComparisonResult,
} from "@surplus/contracts";

// ---------------------------------------------------------------------------
// Allowed Number Registry (Stage 1)
// ---------------------------------------------------------------------------

/** Structural constants that are always allowed and never flagged. */
const WHITELIST_CONSTANTS = new Set([3, 4, 6, 9, 10, 12, 31, 90, 100, 2025, 2026]);

export type AllowedNumberSet = Set<string>;

function addCents(set: AllowedNumberSet, cents: number): void {
  // Register three ways: exact dollars, whole dollars, raw cents
  const dollars = cents / 100;
  set.add(dollars.toFixed(2)); // "4200.00"
  set.add(String(Math.round(dollars))); // "4200"
  set.add(String(cents)); // "420000"
}

function addScalar(set: AllowedNumberSet, value: number): void {
  // As decimal (0.342, 0.34) and as percentage (34.2, 34)
  set.add(String(value));
  set.add(value.toFixed(2));
  set.add(value.toFixed(4));
  const pct = value * 100;
  set.add(String(pct));
  set.add(pct.toFixed(1));
  set.add(String(Math.round(pct)));
}

function addInteger(set: AllowedNumberSet, value: number): void {
  set.add(String(value));
}

function collectFromSummary(set: AllowedNumberSet, s: CashFlowSummary): void {
  for (const w of [s.windows.week, s.windows.month, s.windows.year]) {
    addCents(set, w.grossIncomeCents);
    addCents(set, w.feesCents);
    addCents(set, w.refundsCents);
    addCents(set, w.chargebacksCents);
    addCents(set, w.withdrawalsCents);
    addCents(set, w.netCashFlowCents);
    addInteger(set, w.transactionCount);
  }
  for (const mp of s.monthlySeries) {
    addCents(set, mp.grossIncomeCents);
    addCents(set, mp.feesCents);
    addCents(set, mp.refundsCents);
    addCents(set, mp.chargebacksCents);
    addCents(set, mp.netCents);
  }
  addInteger(set, s.completedMonthsCount);
  addCents(set, s.baselineMonthlyNetCents);
  addCents(set, Math.round(s.meanMonthlyNetCents));
  addScalar(set, s.cv);
  addScalar(set, s.refundRate90d);
  addCents(set, Math.round(s.trendSlopeCentsPerMonth));
  addInteger(set, s.openDisputes.count);
  addCents(set, s.openDisputes.totalAmountCents);
  addCents(set, s.openDisputes.unheldAmountCents);
  addInteger(set, s.excludedNonUsdCount);
}

function collectFromSurplus(set: AllowedNumberSet, r: SurplusResult): void {
  addCents(set, r.availableBalanceCents);
  addCents(set, r.monthlyObligationsCents);
  addScalar(set, r.cv);
  addScalar(set, r.bufferMonths);
  addCents(set, r.bufferTargetCents);
  addCents(set, r.riskReserveCents);
  addCents(set, r.safeSurplusCents);
  addInteger(set, r.stagingTrancheCount);
  for (const t of r.stagingScheduleCents) {
    addCents(set, t);
  }
  for (const bl of r.breakdownLines) {
    if (bl.valueCents !== undefined) addCents(set, bl.valueCents);
    if (bl.valueScalar !== undefined) addScalar(set, bl.valueScalar);
  }
}

function collectFromPlan(set: AllowedNumberSet, p: AllocationPlan): void {
  addCents(set, p.safeSurplusCents);
  for (const b of p.bands) {
    addInteger(set, b.minPct);
    addInteger(set, b.maxPct);
    addInteger(set, b.targetMidpointPct);
    addCents(set, b.allocatedMidpointCents);
  }
  for (const s of p.stagingSchedule) {
    addInteger(set, s.trancheNumber);
    addInteger(set, s.executeAfterDays);
    addCents(set, s.amountCents);
  }
}

function collectFromScenario(set: AllowedNumberSet, r: ScenarioComparisonResult): void {
  collectFromSurplus(set, r.baselineSurplus);
  collectFromSurplus(set, r.stressedSurplus);
  collectFromPlan(set, r.stressedPlan);
  addCents(set, r.deltaSafeSurplusCents);
  addScalar(set, r.deltaBufferMonths);
  addInteger(set, r.scenarioInput.incomeShockPct);
  addCents(set, r.scenarioInput.delayedPaymentCents);
  addCents(set, r.scenarioInput.oneOffExpenseCents);
}

function collectFromMcpSummary(set: AllowedNumberSet, summary: Record<string, number | string>): void {
  for (const value of Object.values(summary)) {
    if (typeof value === "number") {
      addInteger(set, value);
    }
  }
}

// ---------------------------------------------------------------------------
// Tool output collector — builds the registry from what tools actually returned
// ---------------------------------------------------------------------------

export interface ToolOutputCollector {
  summary?: CashFlowSummary;
  surplus?: SurplusResult;
  plan?: AllocationPlan;
  scenario?: ScenarioComparisonResult;
  mcpSummaries: Record<string, number | string>[];
}

export function buildAllowedNumberSet(collected: ToolOutputCollector): AllowedNumberSet {
  const set: AllowedNumberSet = new Set<string>();
  // Add whitelist constants
  for (const c of WHITELIST_CONSTANTS) {
    set.add(String(c));
  }
  if (collected.summary) collectFromSummary(set, collected.summary);
  if (collected.surplus) collectFromSurplus(set, collected.surplus);
  if (collected.plan) collectFromPlan(set, collected.plan);
  if (collected.scenario) collectFromScenario(set, collected.scenario);
  for (const ms of collected.mcpSummaries) {
    collectFromMcpSummary(set, ms);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Stage 2: extraction and policy compliance
// ---------------------------------------------------------------------------

const BANNED_TICKER_RE =
  /\b(S&P\s*500|SPY|VOO|QQQ|VTI|AAPL|MSFT|NVDA|TSLA|BTC|ETH|Bitcoin|Ethereum|Vanguard|BlackRock|Fidelity)\b/i;

const BANNED_PROMISE_RE =
  /\b(guarantee[ds]?|risk-free|will earn|we have invested|executed trade|transferred funds)\b/i;

const CURRENCY_TOKEN_RE = /\$([0-9,]+(?:\.[0-9]{1,2})?)/g;

const PCT_DECIMAL_TOKEN_RE = /(?<![a-zA-Z#/])([0-9]+(?:\.[0-9]+)?)%/g;

/** Standalone numbers (not dates, not list prefixes) */
const PROSE_NUMBER_RE = /(?<![a-zA-Z0-9#/.\-])([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)(?![%a-zA-Z0-9/])/g;

/** Markdown ordered-list prefix: skip these */
const LIST_PREFIX_RE = /^\s*\d+\./;

function extractCurrencyValues(text: string): string[] {
  return [...text.matchAll(CURRENCY_TOKEN_RE)].map((m) => {
    const raw = m[1]!.replace(/,/g, "");
    return raw;
  });
}

function extractPercentValues(text: string): string[] {
  return [...text.matchAll(PCT_DECIMAL_TOKEN_RE)].map((m) => m[1]!);
}

function isNumberAllowed(value: string, allowed: AllowedNumberSet): boolean {
  // Direct match
  if (allowed.has(value)) return true;
  // Try without trailing zeros after decimal
  const num = parseFloat(value);
  if (isNaN(num)) return false;
  // Check various representations
  if (allowed.has(String(num))) return true;
  if (allowed.has(num.toFixed(2))) return true;
  // 1 cent tolerance: check +/- 0.01
  if (allowed.has((num + 0.01).toFixed(2))) return true;
  if (allowed.has((num - 0.01).toFixed(2))) return true;
  // 0.1% tolerance for percentages
  const nearby = [num - 0.1, num + 0.1];
  for (const n of nearby) {
    if (allowed.has(n.toFixed(1))) return true;
    if (allowed.has(String(Math.round(n)))) return true;
  }
  return false;
}

export interface ValidatorInput {
  narrativeMarkdown: string;
  citedNumbers: { metricCode: string; rawValue: number; formattedText: string }[];
  disclaimerId: string;
}

export interface ValidatorResult {
  passed: boolean;
  mismatches: string[];
}

export function validateAdvisorOutput(
  input: ValidatorInput,
  allowed: AllowedNumberSet,
): ValidatorResult {
  const mismatches: string[] = [];

  // 1. Citation check: every rawValue must be in the registry
  for (const cited of input.citedNumbers) {
    const val = cited.rawValue;
    // Check dollars, cents, and raw
    const asDollars = (val / 100).toFixed(2);
    const asWhole = String(Math.round(val / 100));
    const asRaw = String(val);
    if (
      !allowed.has(asRaw) &&
      !allowed.has(asDollars) &&
      !allowed.has(asWhole) &&
      !allowed.has(String(val)) &&
      !allowed.has(val.toFixed(2)) &&
      !allowed.has(val.toFixed(4))
    ) {
      mismatches.push(`cited:${cited.metricCode}=${val}`);
    }
  }

  // 2. Prose scan — extract currency, percentage, and standalone numbers
  const lines = input.narrativeMarkdown.split("\n");
  for (const line of lines) {
    // Skip list prefixes (1. 2. 3. etc)
    const currencyVals = extractCurrencyValues(line);
    for (const cv of currencyVals) {
      if (!isNumberAllowed(cv, allowed)) {
        mismatches.push(`prose_currency:$${cv}`);
      }
    }

    const pctVals = extractPercentValues(line);
    for (const pv of pctVals) {
      if (!isNumberAllowed(pv, allowed)) {
        mismatches.push(`prose_pct:${pv}%`);
      }
    }

    // Standalone numbers — skip markdown list prefixes
    if (!LIST_PREFIX_RE.test(line)) {
      const stripped = line.replace(CURRENCY_TOKEN_RE, "").replace(PCT_DECIMAL_TOKEN_RE, "");
      for (const m of stripped.matchAll(PROSE_NUMBER_RE)) {
        const v = m[1]!.replace(/,/g, "");
        if (WHITELIST_CONSTANTS.has(Number(v))) continue;
        if (!isNumberAllowed(v, allowed)) {
          mismatches.push(`prose_number:${v}`);
        }
      }
    }
  }

  // 3. Banned ticker/security
  const tickerMatch = BANNED_TICKER_RE.exec(input.narrativeMarkdown);
  if (tickerMatch) {
    mismatches.push(`banned_ticker:${tickerMatch[1]}`);
  }

  // 4. Banned promise/execution
  const promiseMatch = BANNED_PROMISE_RE.exec(input.narrativeMarkdown);
  if (promiseMatch) {
    mismatches.push(`banned_promise:${promiseMatch[1]}`);
  }

  // 5. Mandatory disclaimer
  if (input.disclaimerId !== "EDUCATIONAL_NOT_FINANCIAL_ADVICE_V1") {
    mismatches.push("missing_disclaimer");
  }

  return { passed: mismatches.length === 0, mismatches };
}

