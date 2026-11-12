"use client";

// Owner: R2 (C-10). Minimal pay-merchant page used for the live Sandbox capture.
// Flow: create order -> buyer approves on PayPal (same tab) -> PayPal redirects
// back here with ?token=<orderId> -> the page captures the order automatically.
import { useEffect, useRef, useState } from "react";

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

export default function PayMerchantPage() {
  const [orderId, setOrderId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const captureStarted = useRef(false);

  async function captureOrder(id: string) {
    setError("");
    setBusy(true);
    setStatus("Capturing payment...");
    try {
      const res = await fetch(`${API_BASE_URL}/api/demo/checkout/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: id }),
      });
      if (!res.ok) throw new Error(await failureMessage(res, "Capture"));
      const data = (await res.json()) as { status: string; captureId: string };
      setStatus(`${data.status} (${data.captureId})`);
    } catch (e) {
      setStatus("");
      setError(e instanceof Error ? e.message : "Capture failed");
    } finally {
      setBusy(false);
    }
  }

  // PayPal sends the buyer back with ?token=<orderId> after approval.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (params.get("cancelled") !== null) {
      setError("Payment was cancelled on PayPal.");
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
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/demo/checkout/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents: 120000 }),
      });
      if (!res.ok) throw new Error(await failureMessage(res, "Create"));
      const data = (await res.json()) as { orderId: string; status: string; approvalUrl?: string };
      setOrderId(data.orderId);
      if (data.approvalUrl === undefined)
        throw new Error("Create failed: PayPal returned no approval link.");
      setStatus("Redirecting to PayPal...");
      window.location.assign(data.approvalUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
      setBusy(false);
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>Pay Merchant (Sandbox)</h1>
      <p>
        Pay a $1,200.00 Sandbox order. You will log in with a Sandbox personal account on PayPal,
        then come back here and the payment is captured automatically.
      </p>
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <button onClick={createOrder} disabled={busy}>
          Pay $1,200 with PayPal
        </button>
      </div>
      {orderId && <p>Order: {orderId}</p>}
      {status && <p>Status: {status}</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
    </main>
  );
}
