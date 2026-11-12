// Owner: R5. Settings bar: business switcher, monthly costs and risk profile.
import type { FormEvent } from "react";
import type { MerchantId, ObligationsSource, RiskProfile } from "@surplus/contracts";
import { PERSONAS, RISK_PROFILES, personaById } from "@/lib/personas";

interface PersonaBarProps {
  merchantId: MerchantId;
  obligationsInput: string;
  obligationsError: string | null;
  obligationsSource: ObligationsSource | null;
  riskProfile: RiskProfile;
  busy: boolean;
  onPersonaChange: (merchantId: MerchantId) => void;
  onObligationsInputChange: (value: string) => void;
  onApplyObligations: () => void;
  onRiskProfileChange: (profile: RiskProfile) => void;
}

export function PersonaBar({
  merchantId,
  obligationsInput,
  obligationsError,
  obligationsSource,
  riskProfile,
  busy,
  onPersonaChange,
  onObligationsInputChange,
  onApplyObligations,
  onRiskProfileChange,
}: PersonaBarProps) {
  const activePersona = personaById(merchantId);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onApplyObligations();
  }

  return (
    <section className="persona-panel persona-panel--compact" aria-labelledby="persona-heading">
      <div className="section-head section-head--compact">
        <div>
          <p className="section-kicker">Your details</p>
          <h2 className="section-title" id="persona-heading">
            Make it yours
          </h2>
        </div>
        <span className={`source-pill source-pill--${activePersona.dataSource}`}>
          {activePersona.dataSource === "live" ? "Live PayPal data" : "Example data"}
        </span>
      </div>

      <form className="controls-grid controls-grid--settings" onSubmit={handleSubmit}>
        <div className="field">
          <label className="field-label" htmlFor="business-select">
            Business
          </label>
          <select
            id="business-select"
            className="select select--field"
            value={merchantId}
            onChange={(event) => {
              const next = PERSONAS.find((persona) => persona.id === event.target.value);
              if (next !== undefined) onPersonaChange(next.id);
            }}
            aria-describedby="business-help"
          >
            <optgroup label="Live demo">
              {PERSONAS.filter((persona) => persona.dataSource === "live").map((persona) => (
                <option value={persona.id} key={persona.id}>
                  {persona.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Example businesses">
              {PERSONAS.filter((persona) => persona.dataSource === "fixture").map((persona) => (
                <option value={persona.id} key={persona.id}>
                  {persona.label}
                </option>
              ))}
            </optgroup>
          </select>
          <p className="field-hint" id="business-help">
            {activePersona.description}
          </p>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="monthly-obligations">
            Monthly fixed costs
          </label>
          <div className={`money-input${obligationsError !== null ? " money-input--error" : ""}`}>
            <span className="money-prefix" aria-hidden="true">
              $
            </span>
            <input
              id="monthly-obligations"
              className="text-input text-input--money"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={obligationsInput}
              onChange={(event) => onObligationsInputChange(event.target.value)}
              aria-invalid={obligationsError !== null}
              aria-describedby="obligations-help"
            />
            <span className="money-suffix">USD / month</span>
          </div>
          <p
            className={`field-hint${obligationsError !== null ? " field-hint--error" : ""}`}
            id="obligations-help"
          >
            {obligationsError ??
              (obligationsSource === "TRAILING_3M_WITHDRAWAL_AVG"
                ? "Estimated from your last 3 months of withdrawals."
                : "Rent, software, insurance: what you pay every month.")}
          </p>
        </div>

        <div className="field">
          <span className="field-label" id="risk-label">
            How cautious?
          </span>
          <div className="segmented" role="group" aria-labelledby="risk-label">
            {RISK_PROFILES.map((option) => (
              <button
                type="button"
                key={option.id}
                className="segment"
                aria-pressed={option.id === riskProfile}
                title={option.description}
                onClick={() => onRiskProfileChange(option.id)}
              >
                <span>{option.label}</span>
                <small>
                  {option.id === "CONSERVATIVE" ? "6" : option.id === "BALANCED" ? "4" : "3"} steps
                </small>
              </button>
            ))}
          </div>
          <p className="field-hint">More cautious keeps more in cash and invests more slowly.</p>
        </div>

        <div className="field field--action">
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? "Updating…" : "Update"}
          </button>
        </div>
      </form>
    </section>
  );
}
