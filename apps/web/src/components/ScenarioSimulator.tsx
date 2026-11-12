"use client";

// Owner: R5. What-If scenario controls. The browser sends ScenarioInput to the
// existing POST /api/scenario route and renders ScenarioComparisonResult; it
// never calculates a stressed surplus, delta, or band locally.
import { useEffect, useState, type FormEvent } from "react";
import type {
  MerchantId,
  RiskProfile,
  ScenarioComparisonResult,
  ScenarioInput,
} from "@surplus/contracts";
import { describeApiError, runScenario } from "@/lib/api";
import {
  formatCents,
  formatMonths,
  formatSignedCents,
  formatWholePercent,
  parseDollarsToCents,
} from "@/lib/format";
import { EmptyPanel, InlineError } from "./ui";

interface ScenarioSimulatorProps {
  merchantId: MerchantId;
  monthlyObligationsCents: number;
  riskProfile: RiskProfile;
}

const SHOCK_MIN = -80;
const SHOCK_MAX = 50;
const RUN_DELAY_MS = 400;

const PRESETS = [
  { label: "Slow month", shock: -30, delayed: "", expense: "" },
  { label: "Income halves", shock: -50, delayed: "", expense: "" },
  { label: "A client pays $2,000 late", shock: 0, delayed: "2000", expense: "" },
  { label: "Surprise $1,500 bill", shock: 0, delayed: "", expense: "1500" },
] as const;

/** Empty money fields mean $0; anything else must parse as dollars. */
function parseOptionalDollars(raw: string): number | null {
  return raw.trim() === "" ? 0 : parseDollarsToCents(raw);
}

export function ScenarioSimulator({
  merchantId,
  monthlyObligationsCents,
  riskProfile,
}: ScenarioSimulatorProps) {
  const [incomeShockPct, setIncomeShockPct] = useState(-30);
  const [delayedInput, setDelayedInput] = useState("");
  const [expenseInput, setExpenseInput] = useState("");
  const [result, setResult] = useState<ScenarioComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-run the server-side comparison shortly after any input settles, so the
  // result follows the controls without a "run" button.
  useEffect(() => {
    const delayedPaymentCents = parseOptionalDollars(delayedInput);
    const oneOffExpenseCents = parseOptionalDollars(expenseInput);
    if (delayedPaymentCents === null || oneOffExpenseCents === null) {
      setError("Enter amounts in dollars, for example 1500.");
      return;
    }

    const input: ScenarioInput = {
      merchantId,
      monthlyObligationsCents,
      riskProfile,
      incomeShockPct,
      delayedPaymentCents,
      oneOffExpenseCents,
    };

    let cancelled = false;
    setError(null);
    const timer = window.setTimeout(() => {
      setLoading(true);
      runScenario(input)
        .then((nextResult) => {
          if (!cancelled) setResult(nextResult);
        })
        .catch((cause: unknown) => {
          if (!cancelled) setError(describeApiError(cause));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, RUN_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    merchantId,
    monthlyObligationsCents,
    riskProfile,
    incomeShockPct,
    delayedInput,
    expenseInput,
  ]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  function applyPreset(preset: (typeof PRESETS)[number]) {
    setIncomeShockPct(preset.shock);
    setDelayedInput(preset.delayed);
    setExpenseInput(preset.expense);
  }

  const deltaMonths = result === null ? 0 : result.deltaBufferMonths;
  const deltaMonthsLabel =
    deltaMonths === 0
      ? "No change"
      : `${deltaMonths > 0 ? "+" : "−"}${formatMonths(Math.abs(deltaMonths))}`;

  return (
    <section className="card scenario-card" aria-labelledby="scenario-title">
      <div className="card-head card-head--wrap">
        <div>
          <p className="card-kicker">What if?</p>
          <h2 className="card-title" id="scenario-title">
            Test a bad month
          </h2>
          <p className="card-sub">
            See how a drop in income, a late payment or a surprise bill changes what is safe to
            invest.
          </p>
        </div>
      </div>

      <div className="scenario-layout">
        <form className="scenario-form" onSubmit={handleSubmit}>
          <div className="scenario-presets" role="group" aria-label="Quick scenarios">
            {PRESETS.map((preset) => {
              const active =
                incomeShockPct === preset.shock &&
                delayedInput === preset.delayed &&
                expenseInput === preset.expense;
              return (
                <button
                  key={preset.label}
                  type="button"
                  className={`button button--small ${active ? "button--primary" : "button--ghost"}`}
                  aria-pressed={active}
                  onClick={() => applyPreset(preset)}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <div className="slider-block">
            <div className="slider-head">
              <label htmlFor="income-shock">Change in income</label>
              <output htmlFor="income-shock" className="slider-value">
                {incomeShockPct > 0 ? "+" : ""}
                {incomeShockPct}%
              </output>
            </div>
            <input
              id="income-shock"
              className="range"
              type="range"
              min={SHOCK_MIN}
              max={SHOCK_MAX}
              step={5}
              value={incomeShockPct}
              onChange={(event) => setIncomeShockPct(Number(event.target.value))}
              aria-valuetext={`${incomeShockPct} percent change in income`}
            />
            <div className="range-scale" aria-hidden="true">
              <span>{SHOCK_MIN}%</span>
              <span>0%</span>
              <span>+{SHOCK_MAX}%</span>
            </div>
          </div>

          <div className="scenario-fields">
            <div className="field">
              <label className="field-label" htmlFor="delayed-payment">
                A client pays late
              </label>
              <div className="money-input">
                <span className="money-prefix" aria-hidden="true">
                  $
                </span>
                <input
                  id="delayed-payment"
                  className="text-input text-input--money"
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={delayedInput}
                  onChange={(event) => setDelayedInput(event.target.value)}
                />
                <span className="money-suffix">USD</span>
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="one-off-expense">
                Surprise bill
              </label>
              <div className="money-input">
                <span className="money-prefix" aria-hidden="true">
                  $
                </span>
                <input
                  id="one-off-expense"
                  className="text-input text-input--money"
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={expenseInput}
                  onChange={(event) => setExpenseInput(event.target.value)}
                />
                <span className="money-suffix">USD</span>
              </div>
            </div>
          </div>

          {error !== null ? <InlineError message={error} /> : null}

          <p className="field-hint">
            This is only a what-if. Your real numbers above stay the same.
          </p>
        </form>

        <div className="scenario-output" aria-live="polite" aria-busy={loading}>
          {result === null ? (
            loading || error === null ? (
              <div className="scenario-loading" aria-busy="true">
                <span className="skeleton skeleton--line" style={{ width: "42%" }} />
                <span className="skeleton skeleton--value" />
                <span className="skeleton skeleton--line" style={{ width: "78%" }} />
              </div>
            ) : (
              <EmptyPanel title="Couldn't run this what-if">
                <p>Check the amounts on the left and try again.</p>
              </EmptyPanel>
            )
          ) : (
            <div className={`scenario-result${loading ? " scenario-result--updating" : ""}`}>
              <div className="scenario-result-head">
                <div>
                  <p className="card-kicker">In this scenario</p>
                  <h3>Safe to invest would be</h3>
                </div>
                {result.stressedSurplus.modelStatus !== "OK" ? (
                  <span className="model-badge model-badge--warn">
                    {result.stressedSurplus.modelStatus === "NEGATIVE_CASH_FLOW"
                      ? "Spending more than earning"
                      : "Not enough data"}
                  </span>
                ) : null}
              </div>

              <div className="result-compare">
                <div>
                  <span className="compare-label">Today</span>
                  <strong>{formatCents(result.baselineSurplus.safeSurplusCents)}</strong>
                </div>
                <span className="compare-arrow" aria-hidden="true">
                  →
                </span>
                <div>
                  <span className="compare-label">What if</span>
                  <strong>{formatCents(result.stressedSurplus.safeSurplusCents)}</strong>
                </div>
              </div>

              <div className="delta-row">
                <div
                  className={`delta-card ${
                    result.deltaSafeSurplusCents < 0
                      ? "delta-card--negative"
                      : "delta-card--positive"
                  }`}
                >
                  <span>Safe to invest</span>
                  <strong>
                    {result.deltaSafeSurplusCents === 0
                      ? "No change"
                      : formatSignedCents(result.deltaSafeSurplusCents)}
                  </strong>
                </div>
                <div className="delta-card">
                  <span>Cushion</span>
                  <strong>{deltaMonthsLabel}</strong>
                </div>
              </div>

              <dl className="result-facts">
                <div>
                  <dt>Cushion to keep</dt>
                  <dd>
                    {formatCents(result.stressedSurplus.bufferTargetCents)} (
                    {formatMonths(result.stressedSurplus.bufferMonths)})
                  </dd>
                </div>
                {result.stressedSurplus.riskReserveCents !== 0 ? (
                  <div>
                    <dt>Held for refunds and disputes</dt>
                    <dd>{formatCents(result.stressedSurplus.riskReserveCents)}</dd>
                  </div>
                ) : null}
              </dl>

              {result.stressedSurplus.safeSurplusCents > 0 ? (
                <div className="scenario-bands">
                  <h4>How it could be split</h4>
                  <div className="mini-band-list">
                    {result.stressedPlan.bands.map((band) => (
                      <div className="mini-band" key={band.assetClass}>
                        <span>
                          {band.label}
                          <small>{formatWholePercent(band.targetMidpointPct)}</small>
                        </span>
                        <strong>{formatCents(band.allocatedMidpointCents)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
