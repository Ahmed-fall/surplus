"use client";

// Owner: R5 (C-10). Minimal pay-merchant page used for the live Sandbox capture.
import { useState } from "react";

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:4000"
).replace(/\/+$/, "");

export default function PayMerchantPage() {
  const [orderId, setOrderId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  async function createOrder() {
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}/api/demo/checkout/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents: 120000 }),
      });
      if (!res.ok) throw new Error(`create failed: ${res.status}`);
      const data = (await res.json()) as { orderId: string; status: string };
      setOrderId(data.orderId);
      setStatus(data.status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "create failed");
    }
  }

  async function captureOrder() {
    if (!orderId) return;
    setError("");
    try {
      const res = await fetch(`${API_BASE_URL}/api/demo/checkout/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      if (!res.ok) throw new Error(`capture failed: ${res.status}`);
      const data = (await res.json()) as { status: string; captureId: string };
      setStatus(`${data.status} (${data.captureId})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "capture failed");
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>Pay Merchant (Sandbox)</h1>
      <p>Create and capture a $1,200.00 Sandbox order for live verification.</p>
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <button onClick={createOrder}>Create $1,200 order</button>
        <button onClick={captureOrder} disabled={!orderId}>
          Capture order
        </button>
      </div>
      {orderId && <p>Order: {orderId}</p>}
      {status && <p>Status: {status}</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
    </main>
  );
}
