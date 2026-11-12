"use client";

// Owner: R2 (C-10). Pay-merchant page used for the live Sandbox capture.
// Flow: create order -> buyer approves on PayPal (same tab) -> PayPal redirects
// back here with ?token=<orderId> -> the page captures the order automatically.
import { useEffect, useRef, useState } from "react";
import { formatCents } from "@/lib/format";

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:4000"
).replace(/\/+$/, "");

const REASON_TEXT: Record<string, string> = {
  ORDER_NOT_APPROVED: "PayPal has not approved this order yet. Approve it on PayPal first.",
  PAYPAL_UNAVAILABLE: "PayPal Sandbox did not respond. Try again in a moment.",
};

async function failureMessage(res: Response, step: string): Promise<string> {
  if (res.status === 404)
    return `${step} failed: demo checkout is disabled (PayPal credentials missing on the API).`;
  try {
    const body = (await res.json()) as { reason?: string };
    if (body.reason !== undefined && REASON_TEXT[body.reason] !== undefined) {
      return `${step} failed: ${REASON_TEXT[body.reason]}`;
    }
  } catch {
    // non-JSON error body
  }
  return `${step} failed: HTTP ${res.status}`;
}

type Phase = "idle" | "redirecting" | "capturing" | "done" | "error";

interface CaptureView {
  captureId: string;
  status: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
}

const DEMO_AMOUNT_CENTS = 120_000;

const STEPS = [
  {
    title: "Create order",
    copy: "The API creates a $1,200.00 Orders v2 order in the PayPal Sandbox.",
  },
  {
    title: "Approve on PayPal",
    copy: "Log in with a Sandbox personal account and approve the payment.",
  },
  {
    title: "Capture and webhook",
    copy: "Back here the order is captured and PayPal sends a signed webhook.",
  },
] as const;

function activeStep(phase: Phase): number {
  if (phase === "redirecting") return 1;
  if (phase === "capturing") return 2;
  if (phase === "done") return 3;
  return 0;
}

function buttonLabel(phase: Phase): string {
  if (phase === "redirecting") return "Redirecting to PayPal…";
  if (phase === "capturing") return "Capturing payment…";
  if (phase === "done") return "Pay another $1,200";
  return "Pay $1,200 with PayPal";
}

export default function PayMerchantPage() {
  const [orderId, setOrderId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [capture, setCapture] = useState<CaptureView | null>(null);
  const [error, setError] = useState<string>("");
  const captureStarted = useRef(false);

  async function captureOrder(id: string) {
    setError("");
    setPhase("capturing");
    try {
      const res = await fetch(`${API_BASE_URL}/api/demo/checkout/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: id }),
      });
      if (!res.ok) throw new Error(await failureMessage(res, "Capture"));
      setCapture((await res.json()) as CaptureView);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Capture failed");
      setPhase("error");
    }
  }

  // PayPal sends the buyer back with ?token=<orderId> after approval.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (params.get("cancelled") !== null) {
      setError("Payment was cancelled on PayPal. Nothing was charged.");
      setPhase("error");
    } else if (token !== null && !captureStarted.current) {
      captureStarted.current = true;
      setOrderId(token);
      void captureOrder(token);
    }
    if (token !== null || params.get("cancelled") !== null) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  async function createOrder() {
    setError("");
    setCapture(null);
    setPhase("redirecting");
    try {
      const res = await fetch(`${API_BASE_URL}/api/demo/checkout/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents: DEMO_AMOUNT_CENTS }),
      });
      if (!res.ok) throw new Error(await failureMessage(res, "Create"));
      const data = (await res.json()) as { orderId: string; status: string; approvalUrl?: string };
      setOrderId(data.orderId);
      if (data.approvalUrl === undefined)
        throw new Error("Create failed: PayPal returned no approval link.");
      window.location.assign(data.approvalUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
      setPhase("error");
    }
  }

  const busy = phase === "redirecting" || phase === "capturing";
  const step = activeStep(phase);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand pay-brand-link" href="/">
            <span className="brand-mark" aria-hidden="true">
              S
            </span>
            <div>
              <span className="brand-name">Surplus</span>
              <span className="brand-tag">Live demo checkout</span>
            </div>
          </a>
          <div className="topbar-actions">
            <span className="source-pill source-pill--live">PayPal Sandbox</span>
          </div>
        </div>
      </header>

      <main className="page pay-page">
        <section className="card pay-card">
          <p className="section-kicker">Pay the demo merchant</p>
          <h1 className="pay-title">Send a real Sandbox payment</h1>
          <p className="pay-sub">
            This creates a genuine PayPal Sandbox order. When it is captured, PayPal sends a signed
            webhook and the Demo Live Sandbox Merchant dashboard updates without a reload.
          </p>

          <div className="pay-summary">
            <div>
              <span className="pay-summary-label">Merchant</span>
              <strong>Demo Live Sandbox Merchant</strong>
            </div>
            <div className="pay-summary-amount">
              <span className="pay-summary-label">Amount</span>
              <strong>{formatCents(DEMO_AMOUNT_CENTS)}</strong>
            </div>
          </div>

          <ol className="pay-steps">
            {STEPS.map((item, index) => {
              const state = index < step ? "done" : index === step && busy ? "active" : "todo";
              return (
                <li key={item.title} className={`pay-step pay-step--${state}`}>
                  <span className="pay-step-num" aria-hidden="true">
                    {state === "done" ? "✓" : index + 1}
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.copy}</span>
                  </div>
                </li>
              );
            })}
          </ol>

          {phase === "done" && capture !== null ? (
            <div className="pay-result" role="status">
              <strong className="pay-result-title">✓ Payment {capture.status.toLowerCase()}</strong>
              <dl className="pay-result-grid">
                <div>
                  <dt>Gross</dt>
                  <dd>{formatCents(capture.grossCents)}</dd>
                </div>
                <div>
                  <dt>PayPal fee</dt>
                  <dd>{formatCents(capture.feeCents)}</dd>
                </div>
                <div>
                  <dt>Net to merchant</dt>
                  <dd className="positive">{formatCents(capture.netCents)}</dd>
                </div>
              </dl>
              <span className="pay-meta">Capture {capture.captureId}</span>
            </div>
          ) : null}

          {error !== "" ? (
            <p className="pay-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="pay-actions">
            <button
              type="button"
              className="button button--primary pay-button"
              onClick={createOrder}
              disabled={busy}
            >
              {buttonLabel(phase)}
            </button>
            <a className="button button--ghost" href="/">
              Back to dashboard
            </a>
          </div>

          {orderId !== null ? <p className="pay-meta">Order {orderId}</p> : null}
        </section>

        <p className="pay-footnote">
          Sandbox only: no real money moves. Log in with a PayPal Sandbox personal (buyer) account.
        </p>
      </main>
    </div>
  );
}
