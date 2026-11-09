# Demo Video Script – Surplus

Target duration: 2:45. Hard limit 2:50.

## 0:00-0:20 – Opening

Screen: Dashboard with persona_steady_retainer selected.
Narration: "Surplus is an explainable treasury advisor for PayPal-paid freelancers. It shows how much of your PayPal balance is safe to invest, and why."
Capture: persona bar, obligations input, risk profile.

## 0:20-0:50 – Data honesty

Screen: Summary cards, CV, 90-day refund rate, open disputes.
Narration: "We ingest 12 months of PayPal cash flow. Historical months are simulated for demonstration; current month is live Sandbox."
Capture: live vs fixture badge.

## 0:50-1:25 – Deterministic engine

Screen: Surplus breakdown 10 formula lines, AG Grid audit table placeholder.
Narration: "The engine never uses AI for math. Safe surplus = available minus buffer minus risk reserve."
Capture: breakdown lines AVAILABLE_BALANCE, BUFFER_MONTHS, TOTAL_RISK_RESERVE, SAFE_SURPLUS.

## 1:25-2:00 – AI explanation and grounding

Screen: Advisor drawer open, validator badge PASSED, tool trace panel.
Narration: "The AI explains results using tool outputs only. A grounding validator checks every number and blocks tickers or guarantees."
Capture: validator badge, disclaimer.

## 2:00-2:30 – Live webhook update

Screen: Split view with /pay-merchant. Create $1,200 Sandbox capture.
Narration: "A real Sandbox payment triggers a verified webhook. Balance updates and SSE pushes the new surplus without refresh."
Capture: webhook signature verification log, SSE toast, surplus animation.

## 2:30-2:50 – What-if and safety

Screen: What-If simulator -30% income shock.
Narration: "Stress test shows impact on surplus. Architecture: PayPal REST + MCP read-only, deterministic engine, validator, prompt injection defenses."
Capture: scenario delta, architecture slide.

### Capture checklist

- Persona selection
- Formula breakdown
- Validator PASSED badge
- Webhook verification evidence
- SSE update
- What-if slider

### Fallback plan

If PayPal Sandbox unavailable: use pre-recorded webhook replay with explicit label "simulated replay". Never present simulated data as live verified payment. If AI service fails, show deterministic template fallback with validator badge FALLBACK_TEMPLATE.

Public video recording/upload remains a human action. This script prepares all narration and screen actions.
