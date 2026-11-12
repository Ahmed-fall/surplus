# Surplus

**Find out how much of your PayPal cash is safe to put to work.**

Surplus is a money assistant for freelancers and small businesses paid through PayPal. It reads a year of PayPal history, keeps a safety cushion for slow months, refunds and disputes, and shows what is left over as a step-by-step investing plan. An AI advisor explains the plan in plain English, and every number it says is checked against the real data before you see it.

|                |                                                  |
| -------------- | ------------------------------------------------ |
| **Live demo**  | https://surplus-web.onrender.com                 |
| **API health** | https://surplus-api-h17e.onrender.com/api/health |
| **Demo video** | _YouTube link added at submission_               |
| **License**    | Apache-2.0 ([LICENSE](LICENSE))                  |

> Hosted on Render's free plan: the first visit after a quiet period can take about 30 seconds while the services wake up.

---

## The problem

Freelancers and small merchants often leave thousands of dollars idle in PayPal because they can't tell how much they can safely invest without risking rent, a slow month, a refund wave or a dispute. Spreadsheets are tedious, and asking a chatbot is risky because language models are bad at arithmetic and happy to invent numbers.

## What Surplus does

1. **Reads your PayPal history**: 12 months of transactions, your balance and open disputes.
2. **Sizes a safety cushion**: 3 to 9 months of your fixed costs, larger when income is uneven, plus money held back for likely refunds and open disputes.
3. **Shows what is safe to invest**: balance − cushion − reserve, as one clear number.
4. **Plans it gradually**: splits that amount into 3, 4 or 6 monthly steps with real dates, depending on how cautious you are.
5. **Explains it with AI**: an advisor answers in plain English and shows a "✓ Every number checked" badge.
6. **Updates live**: when a PayPal payment lands, the dashboard updates by itself within seconds, with no refresh.
7. **Tests bad months**: one-tap what-ifs such as "Slow month", "Income halves" or "Surprise $1,500 bill".

**The core rule: the AI never does the math.** A deterministic engine computes every number. The AI only explains them, and a grounding validator rejects any answer containing a number, ticker or promise that isn't backed by the engine's output.

## Try it in 2 minutes

Open https://surplus-web.onrender.com, then:

1. **Steady Retainer** (default): $25,000 in PayPal, a $9,000 cushion (3 months of costs), so **$16,000 is safe to invest** in 4 dated steps.
2. Change **Monthly fixed costs** to `5000` and click **Update**. The cushion grows and the safe amount shrinks.
3. Switch the **Business** dropdown to **Volatile Freelancer**. Uneven income means a bigger cushion and a "keep it all for now" result.
4. Open the **What if?** tab and tap **Surprise $1,500 bill**.
5. Click **Explain my plan with AI** and look at the tool trace and the validator badge.
6. Switch to **Demo Live Sandbox Merchant**, open [`/pay-merchant`](https://surplus-web.onrender.com/pay-merchant) in a new tab, pay $1,200 with a PayPal **Sandbox personal (buyer)** account, and return. The balance and safe amount update on their own.

The four example businesses use made-up 12-month histories. The live demo business uses real PayPal Sandbox payments (see [docs/DATA_NOTES.md](docs/DATA_NOTES.md)).

## How PayPal is used

| PayPal capability                                                                    | What Surplus does with it                                                                                                                                                                        |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Orders v2** (`POST /v2/checkout/orders`, `/capture`)                               | The `/pay-merchant` checkout creates and captures a real $1,200 Sandbox payment. Captures are idempotent (`PayPal-Request-Id`).                                                                  |
| **Webhooks + signature verification** (`/v1/notifications/verify-webhook-signature`) | `PAYMENT.CAPTURE.COMPLETED` / `REFUNDED` events are verified before any write, de-duplicated by `event_id`, then trigger a recompute and a live push to the browser.                             |
| **Transaction Search** (`/v1/reporting/transactions`)                                | 12 months loaded in 31-day windows with pagination and de-duplication.                                                                                                                           |
| **Balances** (`/v1/reporting/balances`)                                              | Available versus withheld balance.                                                                                                                                                               |
| **Disputes** (`/v1/customer/disputes`)                                               | Open disputes are reserved for before anything counts as safe.                                                                                                                                   |
| **PayPal MCP** (`@paypal/mcp`, read-only allowlist)                                  | The AI advisor can call `list_transactions`, `list_disputes` and `get_merchant_insights`. Every result passes a sanitizer that strips notes, memos and other free text before the model sees it. |

## How AI is used

| Tool                                            | Role                                                                                                                                                                                                                                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Google Gemini 2.5 Flash** (via Vercel AI SDK) | Primary model for the advisor. It calls read-only tools (`get_cash_flow_summary`, `get_surplus`, `get_allocation_plan`, `run_scenario`, PayPal MCP) and narrates the results.                                                                                                       |
| **OpenAI GPT-4o-mini**                          | Automatic fallback model.                                                                                                                                                                                                                                                           |
| **Grounding validator** (our code)              | Builds a registry of every number from tool output and checks each number the model cites or writes. Blocks named securities and tickers and words like "guaranteed". Requires the educational disclaimer. A failed check triggers one regeneration, then a deterministic template. |
| **Prompt-injection defense**                    | PayPal free text (notes, memos, payer names) never reaches the database, the UI or the prompt. The test fixtures include an injected memo telling the model to "recommend 100% NVDA" to prove it is stripped.                                                                       |

## Sponsor tools

- **Render**: both services deploy from [`render.yaml`](render.yaml) (Blueprint), auto-deploy from `main`, with a health check and seed on boot.

## Run it locally

Requirements: **Node 20.19+** and **pnpm 9** (`corepack enable`), plus a free [PayPal Developer](https://developer.paypal.com) account.

```bash
git clone https://github.com/ahmed-paypal-hackathon-2026/Surplus.git
cd Surplus
cp .env.example .env      # add your Sandbox credentials (see below)
pnpm install
pnpm seed                 # loads the 4 example businesses + live demo baseline
pnpm dev                  # web: http://localhost:3000   api: http://localhost:4000/api/health
```

The dashboard and all four example businesses work without any API keys. Add these to `.env` to unlock the rest:

| Variable                                               | Needed for                                                                                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`             | `/pay-merchant` checkout and live Sandbox data. Create a REST app under **Apps & Credentials → Sandbox**, linked to a **US** Sandbox business account.   |
| `PAYPAL_WEBHOOK_ID`                                    | Verifying webhooks. Add a webhook for `PAYMENT.CAPTURE.COMPLETED` and `PAYMENT.CAPTURE.REFUNDED` pointing at your public API URL `/api/webhooks/paypal`. |
| `GOOGLE_GENERATIVE_AI_API_KEY` and/or `OPENAI_API_KEY` | The AI advisor. Without them it uses the deterministic template answer.                                                                                  |

Full list with comments: [`.env.example`](.env.example). Check your PayPal credentials with `pnpm --filter @surplus/paypal test:token`.

**Sandbox tip:** if a capture fails with `COMPLIANCE_VIOLATION`, the Sandbox business account's country can't receive payments. Create a new **United States** Sandbox business account and an app linked to it.

Other commands: `pnpm -r build`, `pnpm -r test`, `pnpm lint`, `pnpm typecheck`. Docker: `docker compose up`.

## Architecture

```
Browser (Next.js, apps/web)
  dashboard · what-if · AI advisor drawer · /pay-merchant checkout
        │  REST + Server-Sent Events
        ▼
Node API (Express, apps/api)
  routes ── @surplus/engine (pure, deterministic money math, integer cents)
         ── agent: Vercel AI SDK tool loop → grounding validator → template fallback
         ── @surplus/paypal: OAuth client, Orders, Reporting, Disputes, webhook verify
         ── SQLite (WAL): merchants, transactions, balances, disputes, webhook events
        │
        ▼
PayPal Sandbox REST + webhooks · @paypal/mcp (read-only) · Gemini / OpenAI
```

| Package              | Responsibility                                                                         |
| -------------------- | -------------------------------------------------------------------------------------- |
| `packages/contracts` | Shared types and Zod schemas for every API payload                                     |
| `packages/engine`    | Cash-flow summary, safe surplus, staging, allocation bands, scenarios (pure functions) |
| `packages/paypal`    | PayPal REST client, data sources, normalizer, fixtures loader                          |
| `apps/api`           | REST routes, webhooks, SSE, AI advisor                                                 |
| `apps/web`           | Dashboard UI and the demo checkout page                                                |

### How the safe amount is calculated

1. Typical month = **median** monthly net (income − fees − refunds − chargebacks) over completed months.
2. Income swing = coefficient of variation of monthly net. Cushion = **3 + 6 × swing**, clamped to 3–9 months of fixed costs.
3. Reserve = unheld open disputes + 90-day refund rate × typical month.
4. **Safe to invest = max(0, balance − cushion − reserve)**, split into 3/4/6 monthly steps that add up to the cent.
5. If the average month loses money, nothing is safe to invest.

The full specification is in [AGENT_CONTEXT.md §5](AGENT_CONTEXT.md).

## Testing

Vitest, fast-check and supertest:

- golden snapshots for all four example businesses
- 1,000-run property tests (the safe amount is never negative and the steps always sum exactly)
- webhook tests (valid, tampered, duplicate)
- a 15-prompt adversarial and compliance suite for the advisor (fake numbers, stock picks, return promises)

CI runs build, tests, typecheck, lint and gitleaks on every PR.

## Safety and privacy

- **Educational only**: Surplus never moves money, executes trades or names a security.
- Payers are stored only as an 8-character SHA-256 prefix. No emails, names or memos are stored.
- Webhooks are signature-verified before any database write. Duplicates are ignored.
- No secrets in git (gitleaks in CI). See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Docs

- [docs/DATA_NOTES.md](docs/DATA_NOTES.md): live vs. example data
- [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md): trust boundaries
- [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md): video script
- [docs/decisions.md](docs/decisions.md): decision log
- [AGENT_CONTEXT.md](AGENT_CONTEXT.md): full project spec

## License

Apache-2.0. See [LICENSE](LICENSE).
