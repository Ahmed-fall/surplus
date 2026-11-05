"use client";

// Owner: R5 (C-10). pay-merchant page: create a $1,200 Sandbox order, redirect
// the buyer to PayPal for approval, then capture on return and show the result.
import { useEffect, useState } from "react";

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:4000"
).replace(/\/+$/, "");

export default function PayMerchantPage() {
  const [orderId, setOrderId] = useState<string | null>(null);
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  async function createOrder() {
    setError("");
    setStatus("");
    const returnUrl = window.location.href.split("?")[0];
    try {
      const res = await fetch(`${API_BASE_URL}/api/demo/checkout/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents: 120000, returnUrl }),
      });
      if (!res.ok) throw new Error(`create failed: ${res.status}`);
      const data = (await res.json()) as {
        orderId: string;
        status: string;
        approvalUrl: string | null;
      };
      setOrderId(data.orderId);
      setStatus(data.status);
      if (data.approvalUrl) {
        setApprovalUrl(data.approvalUrl);
      } else {
        setError("No approval URL returned by PayPal");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "create failed");
    }
  }

  async function captureOrder(id: string) {
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}/api/demo/checkout/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: id }),
      });
      if (!res.ok) throw new Error(`capture failed: ${res.status}`);
      const data = (await res.json()) as { status: string; captureId: string };
      setStatus(`COMPLETED: ${data.captureId}`);
      setApprovalUrl(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "capture failed");
    }
  }

  // On return from PayPal, ?token=<orderId> is present; auto-capture.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      setOrderId(token);
      void captureOrder(token);
    }
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>Pay Merchant (Sandbox)</h1>
      <p>Create and capture a $1,200.00 Sandbox order for live verification.</p>
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <button onClick={createOrder}>Create $1,200 order</button>
        {approvalUrl && (
          <a href={approvalUrl}>
            <button>Approve on PayPal</button>
          </a>
        )}
        <button onClick={() => orderId && void captureOrder(orderId)} disabled={!orderId}>
          Capture order
        </button>
      </div>
      {orderId && <p>Order: {orderId}</p>}
      {status && <p>Status: {status}</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
    </main>
  );
}
