# Surplus

Explainable treasury runway and idle-cash allocation advisor for PayPal-paid freelancers and small merchants.

Surplus ingests 12 months of PayPal cash-flow history (transactions, balances, open disputes), deterministically computes a safe-to-invest surplus after reserving for income volatility, operating obligations, refund rates, and open disputes, then uses a tool-calling AI agent to explain the numbers and propose a staged, educational allocation plan. A grounding validator checks every number and policy rule before anything reaches the user. New PayPal webhooks update the plan live over SSE within seconds.

## Why

Freelancers and small merchants paid through PayPal often hold idle cash without knowing how much is truly safe to invest. Surplus turns lumpy PayPal cash flow into an explainable, defensible runway number and a staged plan — without the LLM ever doing money math.

## Core features

- **Deterministic engine** (`@surplus/engine`) computes cash-flow summary, surplus, allocation plan, and scenario comparisons. All money is signed integer cents; ratios are `round4`, buffer months `round2`.
- **Cash-flow summary** — 31-day-windowed transaction loading, full-calendar-month aggregation, median baseline, coefficient of variation, 90-day refund rate, open disputes.
- **Surplus calculator** — buffer target, risk reserve (open disputes + expected refund exposure), safe surplus, exact-sum staged tranches (3/4/6 by risk profile), allocation bands with a high-volatility CV shift rule.
- **Scenario engine** — income shock, delayed payments, one-off expenses; returns deltas vs. baseline.
- **AI advisor** (Gemini 2.5 Flash, fallback GPT-4o-mini) explains results and proposes staged allocations using read-only tools only.
- **Grounding validator** — allowed-number registry, citation check, prose scan, banned-ticker/security regex, banned promise/execution regex, mandatory educational disclaimer. Regenerates once, then falls back to a deterministic template.
- **Live updates** — verified PayPal webhooks (`PAYMENT.CAPTURE.COMPLETED`), idempotent by `event_id`, balance adjustment, recompute, SSE broadcast.
- **Hybrid merchant store** — 11 months of fixture baseline + live Sandbox current month so the engine always has ≥12 months.
- **AG Grid** audit table, Recharts trend, What-If scenario simulator, tool-trace drawer, validator badge, persona switcher.
- **Security** — payer identity stored as 8-hex SHA-256 prefix only; all free text (notes, memos, custom_id, subject, messages, payer names) stripped; no secrets in git (gitleaks in CI).

## Prize targets

Best Use of PayPal + AI, Best Use of AG Grid, Best Use of Render, plus grand/category prizes (Devpost).

## Personas

- `persona_steady_retainer`
- `persona_volatile_freelancer`
- `persona_seasonal_seller`
- `persona_dispute_spike`
- `live_sandbox` (hybrid: 11 months fixture + live Sandbox current month)

## Quickstart

Requirements: Node 20.19+ and pnpm 9 (`corepack enable`).

```bash
cp .env.example .env     # fill in Sandbox credentials
pnpm install
pnpm seed
pnpm dev                 # web: http://localhost:3000   api: http://localhost:4000/health
```

Other commands: `pnpm -r build`, `pnpm -r test`, `pnpm lint`, `pnpm typecheck`, `pnpm format`, `pnpm --filter @surplus/paypal test:token`.

## Environment variables

See `.env.example`. Key ones: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_API_BASE`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_API_KEY`, `ADMIN_RESET_TOKEN`, `DATABASE_PATH`, `WEB_ORIGIN`, `NEXT_PUBLIC_API_URL`.

## Architecture

```
Browser (Next.js 14)  --REST+SSE-->  Node API (Express/Fastify)
                                      routes, agent (AI SDK + MCP sanitizer + validator)
                                      packages: contracts, engine, paypal
                                      SQLite WAL (surplus.db)
External: PayPal Sandbox, @paypal/mcp (read-only), LLM provider
```

## Testing

Vitest, fast-check (property tests), supertest. Golden persona snapshots, 1,000-run property tests, adversarial/compliance suite (15 prompts), webhook idempotency tests.

## Deployment

Render via `render.yaml` Blueprint; local via `docker-compose.yml`. Seed runs on boot; `POST /api/admin/reset` protected by header token.

## Docs

- `docs/DATA_NOTES.md` — live vs. simulated data disclosure
- `docs/THREAT_MODEL.md` — trust boundaries
- `docs/decisions.md` — decisions log
- `AGENT_CONTEXT.md` — full project spec and rules

## License

Apache-2.0. See `LICENSE`.
