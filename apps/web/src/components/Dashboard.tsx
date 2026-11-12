"use client";

// Owner: R5. Dashboard shell for tasks F-10, C-8 and H-4.
// It orchestrates contract-validated API calls, the SSE live stream, persona
// controls, the advisor drawer, and the What-If simulator. No money math and no
// scenario math lives in this component.
import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import type { AppEvent, MerchantId, NormalizedTransaction, RiskProfile } from "@surplus/contracts";
import {
  API_BASE_URL,
  describeApiError,
  fetchPlan,
  fetchTransactions,
  subscribeToEvents,
  type EventStreamStatus,
  type PlanBundle,
} from "@/lib/api";
import { centsToDollarInput, formatCents, formatMonths, parseDollarsToCents } from "@/lib/format";
import { DEFAULT_PERSONA_ID, personaById } from "@/lib/personas";
import { appEventPresentation } from "@/lib/events";
import { AdvisorDrawer } from "./AdvisorDrawer";
import { AuditTable } from "./AuditTable";
import { CashFlowChart } from "./CashFlowChart";
import { LiveEventToast } from "./LiveEventToast";
import { PersonaBar } from "./PersonaBar";
import { ScenarioSimulator } from "./ScenarioSimulator";
import { RiskSignals, SummaryCards } from "./SummaryCards";
import { SurplusBreakdown } from "./SurplusBreakdown";
import { DashboardSkeleton, ErrorPanel, InlineError } from "./ui";

const DEFAULT_PERSONA = personaById(DEFAULT_PERSONA_ID);

const DETAIL_TABS = [
  { id: "cashflow", label: "Cash flow" },
  { id: "transactions", label: "Transactions" },
  { id: "whatif", label: "What if?" },
] as const;

type DetailTab = (typeof DETAIL_TABS)[number]["id"];

export function Dashboard() {
  const [merchantId, setMerchantId] = useState<MerchantId>(DEFAULT_PERSONA_ID);
  const [obligationsInput, setObligationsInput] = useState(() =>
    centsToDollarInput(DEFAULT_PERSONA.defaultObligationsCents),
  );
  const [obligationsCents, setObligationsCents] = useState(DEFAULT_PERSONA.defaultObligationsCents);
  const [obligationsError, setObligationsError] = useState<string | null>(null);
  const [riskProfile, setRiskProfile] = useState<RiskProfile>("BALANCED");
  const [bundle, setBundle] = useState<PlanBundle | null>(null);
  const [transactions, setTransactions] = useState<NormalizedTransaction[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [lastEvent, setLastEvent] = useState<AppEvent | null>(null);
  const [lastRibbonEvent, setLastRibbonEvent] = useState<AppEvent | null>(null);
  const [toastEvent, setToastEvent] = useState<AppEvent | null>(null);
  const [highlight, setHighlight] = useState(false);
  const [sseStatus, setSseStatus] = useState<EventStreamStatus>("connecting");
  const [detailTab, setDetailTab] = useState<DetailTab>("cashflow");

  const activePersona = personaById(merchantId);

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const index = DETAIL_TABS.findIndex((tab) => tab.id === detailTab);
    const step = event.key === "ArrowRight" ? 1 : DETAIL_TABS.length - 1;
    const next = DETAIL_TABS[(index + step) % DETAIL_TABS.length];
    if (next === undefined) return;
    setDetailTab(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetchPlan(merchantId, obligationsCents, riskProfile),
      fetchTransactions(merchantId),
    ])
      .then(([nextBundle, nextTransactions]) => {
        if (cancelled) return;
        setBundle(nextBundle);
        setTransactions(nextTransactions);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeApiError(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [merchantId, obligationsCents, riskProfile, reloadToken]);

  useEffect(() => {
    const unsubscribe = subscribeToEvents(merchantId, {
      onStatus: (status) => setSseStatus(status),
      onEvent: (event) => {
        setBundle({
          summary: event.updatedSummary,
          surplus: event.updatedSurplus,
          plan: event.updatedPlan,
        });
        setError(null);
        setLoading(false);
        setLastEvent(event);
        // `plan.updated` is a recompute follow-up, not a cash event. Keep the
        // last payment/refund/dispute event so the summary ribbon and its amount
        // stay visible instead of being replaced by a neutral plan update.
        if (event.type !== "plan.updated") setLastRibbonEvent(event);
        setHighlight(true);
        setToastEvent((current) =>
          event.type === "plan.updated" && current !== null ? current : event,
        );

        // Reconcile the event payload with the currently selected obligations
        // and risk profile, and pull in the new normalized transaction row.
        void Promise.all([
          fetchPlan(merchantId, obligationsCents, riskProfile),
          fetchTransactions(merchantId),
        ])
          .then(([nextBundle, nextTransactions]) => {
            setBundle(nextBundle);
            setTransactions(nextTransactions);
          })
          .catch(() => {
            // Keep the validated event payload already on screen.
          });
      },
    });

    return unsubscribe;
  }, [merchantId, obligationsCents, riskProfile]);

  useEffect(() => {
    if (!highlight) return;
    const timer = window.setTimeout(() => setHighlight(false), 8_000);
    return () => window.clearTimeout(timer);
  }, [highlight]);

  useEffect(() => {
    if (toastEvent === null) return;
    const timer = window.setTimeout(() => setToastEvent(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [toastEvent]);

  const closeAdvisor = useCallback(() => setAdvisorOpen(false), []);

  function handlePersonaChange(nextMerchantId: MerchantId) {
    const nextPersona = personaById(nextMerchantId);
    setMerchantId(nextMerchantId);
    setObligationsCents(nextPersona.defaultObligationsCents);
    setObligationsInput(centsToDollarInput(nextPersona.defaultObligationsCents));
    setObligationsError(null);
    setBundle(null);
    setTransactions(null);
    setError(null);
    setLastEvent(null);
    setLastRibbonEvent(null);
    setToastEvent(null);
    setAdvisorOpen(false);
  }

  function handleApplyObligations() {
    const parsed = parseDollarsToCents(obligationsInput);
    if (parsed === null) {
      setObligationsError("Enter a non-negative dollar amount, for example 3000.00.");
      return;
    }
    setObligationsError(null);
    if (parsed === obligationsCents) {
      setReloadToken((current) => current + 1);
    } else {
      setObligationsCents(parsed);
    }
  }

  const sseLabel =
    sseStatus === "open"
      ? "Live updates on"
      : sseStatus === "error"
        ? "Reconnecting…"
        : "Connecting…";
  const eventCopy = lastEvent === null ? null : appEventPresentation(lastEvent.type);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              S
            </span>
            <div>
              <span className="brand-name">Surplus</span>
              <span className="brand-tag">Treasury runway, explained</span>
            </div>
          </div>
          <div className="topbar-actions">
            <span className={`status-chip status-chip--${sseStatus}`} title={API_BASE_URL}>
              <span className="sse-dot" aria-hidden="true" />
              {sseLabel}
            </span>
            <span className={`source-pill source-pill--${activePersona.dataSource}`}>
              {activePersona.dataSource === "live" ? "Live PayPal data" : "Example data"}
            </span>
          </div>
        </div>
      </header>

      <main className="page">
        <section className="hero">
          <div className="hero-copy">
            <p className="section-kicker">
              For freelancers and small businesses paid through PayPal
            </p>
            <h1 className="hero-title">
              Find out how much of your PayPal cash is safe to put to work.
            </h1>
            <p className="hero-sub">
              Surplus looks at a year of your PayPal income, sets aside a safety cushion for slow
              months, refunds and disputes, and shows what is left over. Every number is calculated
              from your data, never guessed by AI.
            </p>
          </div>
          <div className="hero-side">
            <div
              className={`hero-stat hero-stat--kpi${highlight ? " hero-stat--live" : ""}`}
              aria-live="polite"
            >
              <span className="hero-stat-label">Safe to invest now · {activePersona.label}</span>
              {bundle !== null ? (
                <>
                  <strong className="hero-kpi">
                    {formatCents(bundle.surplus.safeSurplusCents)}
                  </strong>
                  <span className="hero-stat-note">
                    {bundle.surplus.modelStatus === "NEGATIVE_CASH_FLOW"
                      ? "Keep it all for now: after refunds and chargebacks, your average month loses money"
                      : bundle.surplus.modelStatus !== "OK"
                        ? "We need a bit more history before suggesting anything"
                        : bundle.surplus.safeSurplusCents === 0
                          ? `Keep it all for now: your ${formatCents(bundle.surplus.availableBalanceCents)} balance doesn't yet cover a ${formatCents(bundle.surplus.bufferTargetCents)} cushion (${formatMonths(bundle.surplus.bufferMonths)} of costs)`
                          : `${formatCents(bundle.surplus.availableBalanceCents)} in PayPal, after keeping ${formatCents(bundle.surplus.bufferTargetCents)} (${formatMonths(bundle.surplus.bufferMonths)} of costs) as a cushion`}
                    {bundle.surplus.modelStatus === "OK" && bundle.surplus.riskReserveCents !== 0
                      ? ` plus ${formatCents(bundle.surplus.riskReserveCents)} for refunds and disputes`
                      : ""}
                    .
                  </span>
                </>
              ) : (
                <strong className="hero-kpi hero-kpi--pending">
                  {loading ? "Working it out…" : "—"}
                </strong>
              )}
            </div>
            <div className="hero-actions">
              <button
                type="button"
                className="button button--primary"
                onClick={() => setAdvisorOpen(true)}
                disabled={bundle === null}
              >
                Explain my plan with AI
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setReloadToken((current) => current + 1)}
                disabled={loading}
              >
                {loading ? "Refreshing…" : "Refresh data"}
              </button>
            </div>
            {lastEvent !== null && eventCopy !== null ? (
              <p className="hero-last-event">
                Last live event: <strong>{eventCopy.label}</strong> ·{" "}
                {appEventPresentation(lastEvent.type).shortLabel}
              </p>
            ) : (
              <p className="hero-last-event">New PayPal payments show up here automatically.</p>
            )}
          </div>
        </section>

        <PersonaBar
          merchantId={merchantId}
          obligationsInput={obligationsInput}
          obligationsError={obligationsError}
          obligationsSource={bundle?.surplus.obligationsSource ?? null}
          riskProfile={riskProfile}
          busy={loading}
          onPersonaChange={handlePersonaChange}
          onObligationsInputChange={(value) => {
            setObligationsInput(value);
            setObligationsError(null);
          }}
          onApplyObligations={handleApplyObligations}
          onRiskProfileChange={setRiskProfile}
        />

        {loading && bundle !== null ? (
          <div className="refresh-strip" role="status">
            <span className="refresh-spinner" aria-hidden="true" />
            Updating your numbers…
          </div>
        ) : null}

        {error !== null && bundle !== null ? (
          <InlineError message={error} onRetry={() => setReloadToken((current) => current + 1)} />
        ) : null}

        {bundle === null && loading ? <DashboardSkeleton /> : null}

        {bundle === null && !loading && error !== null ? (
          <ErrorPanel message={error} onRetry={() => setReloadToken((current) => current + 1)} />
        ) : null}

        {activePersona.dataSource === "live" &&
        transactions !== null &&
        transactions.length === 0 ? (
          <section className="card live-cta" aria-labelledby="live-cta-title">
            <div>
              <p className="section-kicker">Live demo</p>
              <h2 id="live-cta-title">Try a real test payment</h2>
              <p className="live-cta-copy">
                Pay this demo business $1,200 with a PayPal Sandbox test account, then come back
                here. Your safe-to-invest amount updates by itself within seconds.
              </p>
            </div>
            <a
              className="button button--primary"
              href="/pay-merchant"
              target="_blank"
              rel="noopener"
            >
              Make a Sandbox payment
            </a>
          </section>
        ) : null}

        {bundle !== null ? (
          <div className="dashboard-content">
            <div className="content-grid content-grid--answer">
              <SurplusBreakdown surplus={bundle.surplus} plan={bundle.plan} />
              <RiskSignals summary={bundle.summary} surplus={bundle.surplus} />
            </div>

            <section className="detail-tabs" aria-label="More details">
              <div className="tab-list" role="tablist" aria-label="More details">
                {DETAIL_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    id={`tab-${tab.id}`}
                    type="button"
                    role="tab"
                    className="tab"
                    aria-selected={detailTab === tab.id}
                    aria-controls={`panel-${tab.id}`}
                    tabIndex={detailTab === tab.id ? 0 : -1}
                    onClick={() => setDetailTab(tab.id)}
                    onKeyDown={handleTabKey}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Panels stay mounted so the what-if keeps its inputs between tabs. */}
              <div
                id="panel-cashflow"
                role="tabpanel"
                aria-labelledby="tab-cashflow"
                className="tab-panel"
                hidden={detailTab !== "cashflow"}
              >
                <SummaryCards
                  summary={bundle.summary}
                  liveEvent={lastRibbonEvent}
                  highlight={highlight}
                />
                <CashFlowChart summary={bundle.summary} />
              </div>
              <div
                id="panel-transactions"
                role="tabpanel"
                aria-labelledby="tab-transactions"
                className="tab-panel"
                hidden={detailTab !== "transactions"}
              >
                <AuditTable transactions={transactions} />
              </div>
              <div
                id="panel-whatif"
                role="tabpanel"
                aria-labelledby="tab-whatif"
                className="tab-panel"
                hidden={detailTab !== "whatif"}
              >
                <ScenarioSimulator
                  key={`${merchantId}-${obligationsCents}-${riskProfile}`}
                  merchantId={merchantId}
                  monthlyObligationsCents={obligationsCents}
                  riskProfile={riskProfile}
                />
              </div>
            </section>
          </div>
        ) : null}

        <footer className="page-footer">
          <p>
            About the data: the four example businesses use made-up 12-month histories. The live
            demo merchant uses only real PayPal Sandbox (test) payments.
          </p>
          <p>Educational information only — Surplus never moves money or recommends a security.</p>
        </footer>
      </main>

      <AdvisorDrawer
        open={advisorOpen}
        merchantId={merchantId}
        obligationsCents={obligationsCents}
        riskProfile={riskProfile}
        plan={bundle?.plan ?? null}
        onClose={closeAdvisor}
      />

      {toastEvent !== null ? (
        <LiveEventToast
          key={toastEvent.eventId}
          event={toastEvent}
          onDismiss={() => setToastEvent(null)}
        />
      ) : null}
    </div>
  );
}
