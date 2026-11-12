// Owner: R5. Formula-by-formula surplus breakdown. Values and formula text are
// rendered exactly as the engine returns them; no result is recalculated here.
import { useState } from "react";
import type {
  AllocationPlan,
  BreakdownLine,
  SurplusModelStatus,
  SurplusResult,
} from "@surplus/contracts";
import { formatCents, formatDaysFromToday, formatDecimal, formatMonths } from "@/lib/format";

interface SurplusBreakdownProps {
  surplus: SurplusResult;
  plan: AllocationPlan;
}

const STATUS_COPY: Record<
  SurplusModelStatus,
  { label: string; tone: string; title: string; body: string }
> = {
  OK: {
    label: "Ready",
    tone: "ok",
    title: "Enough history to calculate",
    body: "Your cushion and refund reserve are covered before anything counts as safe to invest.",
  },
  INSUFFICIENT_DATA: {
    label: "Need more history",
    tone: "warn",
    title: "We need at least 3 full months of payments",
    body: "Until then we keep everything as cushion, so nothing is shown as safe to invest yet.",
  },
  OBLIGATIONS_REQUIRED: {
    label: "Add your costs",
    tone: "warn",
    title: "Add your monthly fixed costs",
    body: "Enter your monthly fixed costs above so we can size your safety cushion.",
  },
  NEGATIVE_CASH_FLOW: {
    label: "Spending more than earning",
    tone: "danger",
    title: "Nothing is safe to invest right now",
    body: "After refunds and chargebacks your average month loses money, so we keep all of your balance as cushion.",
  },
};

/** Plain-language labels by engine line code; the engine's own label is the fallback. */
const LINE_LABELS: Partial<Record<BreakdownLine["code"], string>> = {
  AVAILABLE_BALANCE: "PayPal balance",
  BASELINE_MONTHLY_NET: "Typical month, after fees",
  VOLATILITY_CV: "Income swing score",
  BUFFER_MONTHS: "Months of costs to keep",
  BUFFER_TARGET: "Safety cushion",
  OPEN_DISPUTE_RESERVE: "Held for open disputes",
  EXPECTED_REFUND_EXPOSURE: "Held for likely refunds",
  TOTAL_RISK_RESERVE: "Held for refunds and disputes",
  SAFE_SURPLUS: "Safe to invest",
  STAGED_MONTHLY_TRANCHE: "First investing step",
};

function lineValue(line: BreakdownLine): string {
  if (line.unit === "USD_CENTS" && line.valueCents !== undefined) {
    return formatCents(line.valueCents);
  }
  if (line.unit === "MONTHS" && line.valueScalar !== undefined) {
    return formatMonths(line.valueScalar);
  }
  if (line.unit === "RATIO" && line.valueScalar !== undefined) {
    return formatDecimal(line.valueScalar, 2);
  }
  return "—";
}

export function SurplusBreakdown({ surplus, plan }: SurplusBreakdownProps) {
  const status = STATUS_COPY[surplus.modelStatus];
  const [showMath, setShowMath] = useState(false);
  const emphasisCodes = new Set(["BUFFER_TARGET", "TOTAL_RISK_RESERVE", "SAFE_SURPLUS"]);

  return (
    <article className="card breakdown-card" aria-labelledby="breakdown-title">
      <div className="card-head">
        <div>
          <p className="card-kicker">How we got this number</p>
          <h3 className="card-title" id="breakdown-title">
            Your safe-to-invest amount
          </h3>
          <p className="card-sub">Worked out from your PayPal history with fixed rules, not AI.</p>
        </div>
        <div className="breakdown-head-actions">
          {surplus.modelStatus !== "OK" ? (
            <span className={`model-badge model-badge--${status.tone}`}>{status.label}</span>
          ) : null}
          <button
            type="button"
            className="button button--ghost button--small"
            aria-pressed={showMath}
            aria-controls="breakdown-math"
            onClick={() => setShowMath((current) => !current)}
          >
            {showMath ? "Hide the math" : "Show the math"}
          </button>
        </div>
      </div>

      <div className={`breakdown-hero breakdown-hero--${status.tone}`}>
        <dl className="breakdown-equation">
          <div>
            <dt>Your PayPal balance</dt>
            <dd>{formatCents(surplus.availableBalanceCents)}</dd>
          </div>
          <div>
            <dt>
              − Safety cushion <small>({formatMonths(surplus.bufferMonths)} of costs)</small>
            </dt>
            <dd>{formatCents(surplus.bufferTargetCents)}</dd>
          </div>
          {surplus.riskReserveCents !== 0 ? (
            <div>
              <dt>− Held for refunds and disputes</dt>
              <dd>{formatCents(surplus.riskReserveCents)}</dd>
            </div>
          ) : null}
          <div className="breakdown-equation-total">
            <dt>= Safe to invest</dt>
            <dd>{formatCents(surplus.safeSurplusCents)}</dd>
          </div>
        </dl>
        <p className="breakdown-hero-formula">
          {surplus.obligationsSource === "USER_INPUT"
            ? `Cushion based on your monthly costs of ${formatCents(surplus.monthlyObligationsCents)}.`
            : `Cushion based on estimated monthly costs of ${formatCents(surplus.monthlyObligationsCents)}.`}
        </p>
      </div>

      {surplus.modelStatus !== "OK" ? (
        <div className={`status-panel status-panel--${status.tone}`} role="note">
          <strong>{status.title}.</strong> {status.body}
        </div>
      ) : null}

      {showMath ? (
        <ol className="formula-list" id="breakdown-math">
          {surplus.breakdownLines.map((line, index) => (
            <li
              key={line.code}
              className={`formula-item${emphasisCodes.has(line.code) ? " formula-item--emphasis" : ""}`}
            >
              <span className="formula-index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="formula-body">
                <div className="formula-heading">
                  <span className="formula-label">{LINE_LABELS[line.code] ?? line.label}</span>
                  <span className="formula-value">{lineValue(line)}</span>
                </div>
                <code className="formula-text">{line.formulaText}</code>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {surplus.safeSurplusCents > 0 ? (
        <div className="staging-chips">
          <span className="staging-chips-label">
            Invest it gradually, in {plan.stagingSchedule.length} steps
          </span>
          <div className="staging-chip-row">
            {plan.stagingSchedule.map((tranche) => (
              <span className="staging-chip" key={`${plan.merchantId}-${tranche.trancheNumber}`}>
                <small>{formatDaysFromToday(tranche.executeAfterDays)}</small>
                {formatCents(tranche.amountCents)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
