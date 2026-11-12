// Owner: R5. Week / month / year summary cards and risk-signal strip.
import type {
  AppEvent,
  CashFlowSummary,
  SurplusResult,
  WindowLabel,
  WindowTotals,
} from "@surplus/contracts";
import {
  describeIncomeSwings,
  formatCents,
  formatFriendlyPercent,
  formatIsoDate,
  formatIsoDateTime,
  formatMonths,
  formatSignedCents,
  formatWindowRange,
} from "@/lib/format";
import { appEventPresentation } from "@/lib/events";

interface SummaryCardsProps {
  summary: CashFlowSummary;
  surplus: SurplusResult;
  liveEvent: AppEvent | null;
  highlight: boolean;
}

const WINDOWS: { key: WindowLabel; label: string }[] = [
  { key: "week", label: "Last 7 days" },
  { key: "month", label: "Last 30 days" },
  { key: "year", label: "Last 12 months" },
];

function WindowCard({
  totals,
  label,
  highlight,
}: {
  totals: WindowTotals;
  label: string;
  highlight: boolean;
}) {
  // Zero-value rows are noise for a daily user; only show what happened.
  const rows = [
    { label: "Money in", cents: totals.grossIncomeCents },
    { label: "PayPal fees", cents: totals.feesCents },
    { label: "Refunds", cents: totals.refundsCents },
    { label: "Chargebacks", cents: totals.chargebacksCents },
    { label: "Paid out to you", cents: totals.withdrawalsCents },
  ].filter((row) => row.cents !== 0);

  return (
    <article className={`card summary-card${highlight ? " summary-card--live" : ""}`}>
      <div className="summary-card-head">
        <div>
          <p className="card-kicker">{formatWindowRange(totals.startDate, totals.endDate)}</p>
          <h3 className="card-title">{label}</h3>
        </div>
      </div>
      <p className="summary-value">{formatCents(totals.netCashFlowCents)}</p>
      <p className="summary-caption">
        {totals.transactionCount === 0
          ? "No payments in this period"
          : `Kept after fees and refunds · ${totals.transactionCount} ${
              totals.transactionCount === 1 ? "transaction" : "transactions"
            }`}
      </p>
      {rows.length > 0 ? (
        <dl className="summary-breakdown">
          {rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{formatCents(row.cents)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  );
}

export function SummaryCards({ summary, surplus, liveEvent, highlight }: SummaryCardsProps) {
  const eventCopy = liveEvent === null ? null : appEventPresentation(liveEvent.type);
  const showLiveRibbon = liveEvent !== null && liveEvent.type !== "plan.updated";

  return (
    <section className="summary-section" aria-labelledby="summary-heading">
      <div className="section-head section-head--compact">
        <div>
          <p className="section-kicker">Cash flow</p>
          <h2 className="section-title" id="summary-heading">
            Your cash flow
          </h2>
          <p className="section-sub">
            Based on your PayPal history up to {formatIsoDate(summary.asOf)} ·{" "}
            {summary.completedMonthsCount} full months
          </p>
        </div>
      </div>

      {showLiveRibbon && liveEvent !== null && eventCopy !== null ? (
        <div
          className={`live-ribbon live-ribbon--${eventCopy.tone}`}
          role="status"
          aria-live="polite"
        >
          <span className="live-ribbon-dot" aria-hidden="true" />
          <div>
            <strong>{eventCopy.label}</strong>
            <span className="live-ribbon-amount">{formatSignedCents(liveEvent.deltaNetCents)}</span>
            <span className="live-ribbon-time">at {formatIsoDateTime(liveEvent.at)}</span>
          </div>
        </div>
      ) : null}

      <div className="summary-grid">
        {WINDOWS.map((window) => (
          <WindowCard
            key={window.key}
            totals={summary.windows[window.key]}
            label={window.label}
            highlight={highlight}
          />
        ))}

        <article className="card summary-card summary-card--signals">
          <div className="summary-card-head">
            <div>
              <p className="card-kicker">What sizes your cushion</p>
              <h3 className="card-title">Your risk at a glance</h3>
            </div>
          </div>
          <dl className="signal-list">
            <div>
              <dt>Income</dt>
              <dd title={`Swing score ${summary.cv.toFixed(2)}`}>
                {describeIncomeSwings(summary.cv)}
              </dd>
            </div>
            <div>
              <dt>Typical month, after fees</dt>
              <dd>{formatCents(summary.baselineMonthlyNetCents)}</dd>
            </div>
            <div>
              <dt>Refunds (last 90 days)</dt>
              <dd>{formatFriendlyPercent(summary.refundRate90d)} of sales</dd>
            </div>
            <div>
              <dt>Open disputes</dt>
              <dd>
                {summary.openDisputes.count === 0
                  ? "None"
                  : `${summary.openDisputes.count} · ${formatCents(summary.openDisputes.totalAmountCents)}`}
              </dd>
            </div>
            <div>
              <dt>Safety cushion</dt>
              <dd>{formatMonths(surplus.bufferMonths)} of costs</dd>
            </div>
          </dl>
          <p className="summary-footnote">
            The more your income swings and the more refunds you get, the bigger the cushion we keep
            before anything is invested.
          </p>
        </article>
      </div>
    </section>
  );
}
