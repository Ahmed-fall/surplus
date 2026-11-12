# Surplus

**Explainable treasury runway and idle-cash allocation advisor for PayPal-paid freelancers and small merchants.**

Surplus helps freelancers and small businesses paid through PayPal find out how much of their balance is safe to put to work after covering monthly costs, uneven income, likely refunds and open disputes. A deterministic engine calculates every number; an AI advisor explains the results in plain English and suggests an educational, step-by-step plan. A grounding validator checks each AI answer against the real figures before it is shown.

|                   |                                                  |
| ----------------- | ------------------------------------------------ |
| **Live demo**     | **https://surplus-web.onrender.com/**            |
| **Demo checkout** | https://surplus-web.onrender.com/pay-merchant    |
| **API health**    | https://surplus-api-h17e.onrender.com/api/health |
| **Demo video**    | _YouTube link added at submission_               |
| **License**       | Apache-2.0 ([LICENSE](LICENSE))                  |

> **Sandbox demonstration.** Surplus is an educational prototype, not a bank, broker, investment adviser or production financial account. All PayPal activity runs in the PayPal **Sandbox** (test money) and the historical data is simulated. Surplus never executes investments, trades, transfers, payouts or refunds.
>
> The hosted demo runs on Render's free plan: the first visit after a quiet period can take about 30 seconds while the services wake up.

---

## The problem

PayPal-paid freelancers and small merchants often see a balance without knowing how much is genuinely available. A high balance can be misleading when income is irregular, refunds are likely or disputes are still open, so cash sits idle, or worse, gets spent when it should have been kept. Spreadsheets are tedious, and asking a chatbot is risky: language models are bad at arithmetic and happy to invent numbers.

Surplus turns transaction history into an explainable runway estimate and a cautious, staged plan. **The language model never calculates financial values or decides what money is safe to use.**

## Try it in 2 minutes

Open **https://surplus-web.onrender.com/**, then:

1. **Steady Retainer** (selected by default): $25,000 in PayPal, a $9,000 safety cushion (3 months of costs), so **$16,000 is safe to invest** in 4 dated steps.
2. Change **Monthly fixed costs** to `5000` and click **Update**. The cushion grows and the safe amount shrinks.
3. Switch the **Business** dropdown to **Volatile Freelancer**. Uneven income means a bigger cushion and a "keep it all for now" result.
4. Open the **What if?** tab and tap **Surprise $1,500 bill** or **Income halves**.
5. Click **Explain my plan with AI** and look at the tool trace and the "✓ Every number checked" badge.
6. Switch to **Demo Live Sandbox Merchant**, open [`/pay-merchant`](https://surplus-web.onrender.com/pay-merchant) in a new tab, pay $1,200 with a PayPal **Sandbox personal (buyer)** account, then return. The balance and the safe amount update on their own, with no refresh.

## Core features

- **Deterministic cash-flow engine**: calculates cash-flow summaries, safe surplus, allocation bands and scenario comparisons using integer cents for every monetary value.
- **12-month analysis**: combines historical monthly data with current activity for a consistent analysis window.
- **Risk-aware reserves**: a safety cushion of 3–9 months of fixed costs (larger when income swings), plus money held for expected refunds and open disputes.
- **Staged plan with real dates**: splits the safe amount into 3, 4 or 6 monthly steps depending on how cautious the user is, with allocation bands and an extra-caution shift for very uneven income.
- **What-if simulator**: income changes, late client payments and surprise bills, with one-tap presets and instant results.
- **AI advisor**: Gemini 2.5 Flash (primary) and GPT-4o-mini (fallback). It explains deterministic tool outputs using read-only tools and never performs money calculations.
- **Grounding and safety validation**: checks every number against an allowed-evidence registry, checks citations and policy language, blocks named securities, tickers and promises, and requires an educational disclaimer. An invalid answer is regenerated once, then replaced by a deterministic template.
- **Live PayPal updates**: a verified `PAYMENT.CAPTURE.COMPLETED` webhook updates the balance, triggers a recompute and pushes the new plan to the browser over Server-Sent Events (SSE) within seconds.
- **PayPal MCP boundary**: read-only access limited to approved transaction, dispute and merchant-insight tools. Output is sanitized so raw PayPal free text and personal details never reach the model.
- **Plain-language dashboard**: business switcher, safe-to-invest breakdown with "Show the math", risk summary, cash-flow trend, transaction history and what-if tabs.
- **Privacy-conscious storage**: payers are stored only as a short SHA-256 hash prefix (shown as "Client A, B, C…"). Notes, memos, subjects and messages are never stored.

## How PayPal is used

| PayPal capability                                                                    | What Surplus does with it                                                                                                                                 |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Orders v2** (`POST /v2/checkout/orders`, `/capture`)                               | The `/pay-merchant` checkout creates and captures a real $1,200 Sandbox payment. Captures are idempotent (`PayPal-Request-Id`).                           |
| **Webhooks + signature verification** (`/v1/notifications/verify-webhook-signature`) | `PAYMENT.CAPTURE.COMPLETED` / `REFUNDED` events are verified before any write, de-duplicated by `event_id`, then trigger a recompute and a live SSE push. |
| **Transaction Search** (`/v1/reporting/transactions`)                                | 12 months loaded in 31-day windows with pagination and de-duplication.                                                                                    |
| **Balances** (`/v1/reporting/balances`)                                              | Available versus withheld balance.                                                                                                                        |
| **Disputes** (`/v1/customer/disputes`)                                               | Open disputes are reserved for before anything counts as safe.                                                                                            |
| **PayPal MCP** (`@paypal/mcp`, read-only allowlist)                                  | The advisor can call `list_transactions`, `list_disputes` and `get_merchant_insights`, always through an output sanitizer.                                |

## How AI is used

| Tool                                                          | Role                                                                                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Google Gemini 2.5 Flash** (Vercel AI SDK, `@ai-sdk/google`) | Primary advisor model. It calls read-only tools (`get_cash_flow_summary`, `get_surplus`, `get_allocation_plan`, `run_scenario`, PayPal MCP) and narrates the results.     |
| **OpenAI GPT-4o-mini** (`@ai-sdk/openai`)                     | Automatic fallback model.                                                                                                                                                 |
| **Grounding validator** (our code)                            | Registers every number from tool output, then rejects answers with unsupported numbers, tickers or promises, or a missing disclaimer.                                     |
| **Prompt-injection defense**                                  | PayPal free text never reaches the database, UI or prompt. The test fixtures include an injected memo telling the model to "recommend 100% NVDA" to prove it is stripped. |

### Data and AI boundary

1. PayPal transaction, balance, dispute and webhook data enters through the PayPal integration layer.
2. The engine normalizes eligible data and calculates the financial metrics deterministically.
3. The advisor receives approved tool outputs, not raw PayPal records, and explains the computed results.
4. The grounding validator checks the advisor's answer against the deterministic evidence and safety rules.
5. The validated answer and the computed figures are shown in the dashboard.

## Architecture overview

```
┌───────────────────────────────────────────────────────────────┐
│                    NEXT.JS WEB APPLICATION                    │
│                 apps/web — React / TypeScript                 │
│    Dashboard • Business switcher • What-if • Advisor drawer   │
│                 /pay-merchant demo checkout                   │
└──────────────────────────────┬────────────────────────────────┘
                               │ REST + Server-Sent Events
                               ▼
┌───────────────────────────────────────────────────────────────┐
│                         NODE.JS API                           │
│                      apps/api — Express                       │
│   Routes • Webhooks • AI advisor • Tool orchestration         │
│         MCP sanitization • Grounding validator                │
└───────────────┬───────────────────────────────┬───────────────┘
                │                               │
                ▼                               ▼
┌──────────────────────────────┐   ┌────────────────────────────┐
│       DOMAIN PACKAGES        │   │     EXTERNAL SERVICES      │
│  @surplus/contracts          │   │  PayPal REST Sandbox       │
│  @surplus/engine             │   │  PayPal webhooks           │
│  @surplus/paypal             │   │  PayPal MCP (read-only)    │
│                              │   │  Gemini / OpenAI APIs      │
└───────────────┬──────────────┘   └────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────────────────────┐
│                      SQLITE (WAL MODE)                        │
│        Merchant data • fixtures • webhook event state         │
└───────────────────────────────────────────────────────────────┘
```

### How the safe amount is calculated

1. **Typical month** = median monthly net (income − fees − refunds − chargebacks) over completed months.
2. **Income swing** = coefficient of variation of monthly net. **Cushion** = 3 + 6 × swing, clamped to 3–9 months of fixed costs.
3. **Reserve** = unheld open disputes + 90-day refund rate × typical month.
4. **Safe to invest** = max(0, balance − cushion − reserve), split into 3/4/6 monthly steps that add up to the cent.
5. If the average month loses money, nothing is safe to invest.

The full specification is in [AGENT_CONTEXT.md §5](AGENT_CONTEXT.md).

## Technology stack

| Layer             | Technology                                                                              |
| ----------------- | --------------------------------------------------------------------------------------- |
| Frontend          | Next.js 15, React 19, TypeScript                                                        |
| Charts and tables | Custom SVG trend chart and sortable transaction table (no chart or grid library)        |
| Backend API       | Node.js, Express, TypeScript                                                            |
| AI orchestration  | Vercel AI SDK v4, `@ai-sdk/google`, `@ai-sdk/openai`                                    |
| AI models         | Gemini 2.5 Flash (primary), GPT-4o-mini (fallback)                                      |
| Financial engine  | TypeScript, pure deterministic functions, fast-check property tests                     |
| Database          | SQLite with WAL mode (`better-sqlite3`)                                                 |
| PayPal            | REST API Sandbox (Orders v2, Reporting, Disputes, Webhooks), PayPal MCP read-only tools |
| Testing           | Vitest, Supertest, fast-check, end-to-end evaluation tests                              |
| Package manager   | pnpm 9.15.9                                                                             |
| Runtime           | Node.js 20.19+                                                                          |
| Deployment        | Render Blueprint ([`render.yaml`](render.yaml)), Docker                                 |
| License           | Apache-2.0                                                                              |

## Repository layout

```
Surplus/
├── apps/
│   ├── api/                    # Express API, advisor, MCP boundary, webhooks
│   └── web/                    # Next.js dashboard and /pay-merchant checkout
├── packages/
│   ├── contracts/              # Shared TypeScript contracts and Zod schemas
│   ├── engine/                 # Deterministic cash-flow and surplus calculations
│   └── paypal/                 # PayPal client, data sources, SQLite access
├── fixtures/                   # Example businesses and Sandbox demonstration data
├── tests/                      # Integration and end-to-end tests
├── scripts/                    # Seed and verification scripts
├── docs/                       # Architecture, compliance, risk, release and demo docs
├── docker-compose.yml
├── Dockerfile
├── render.yaml
├── pnpm-workspace.yaml
├── .env.example                # Safe placeholders only
├── AGENTS.md                   # Repository development instructions
├── AGENT_CONTEXT.md            # Project context and constraints
├── LICENSE
└── README.md
```

## Demonstration businesses

The dashboard's **Business** dropdown offers four simulated example businesses and one live Sandbox business:

| Business                                                | Pattern                                                                   | What it shows                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Steady Retainer** (`persona_steady_retainer`)         | Same clients paying about the same each month                             | Small cushion, a healthy amount safe to invest                            |
| **Volatile Freelancer** (`persona_volatile_freelancer`) | Big project payments some months, little in others                        | Larger cushion, keep it all for now                                       |
| **Seasonal Seller** (`persona_seasonal_seller`)         | Busy holiday season, quieter the rest of the year                         | Cushion sized for the slow months                                         |
| **Dispute Spike** (`persona_dispute_spike`)             | More refunds and open disputes than usual                                 | Money held for disputes; nothing safe while the average month loses money |
| **Demo Live Sandbox Merchant** (`live_sandbox`)         | Eleven simulated baseline months plus real current-month Sandbox payments | Updates live when someone pays on `/pay-merchant`                         |

**Data disclosure:** the four example businesses are simulated. For `live_sandbox`, the historical baseline is simulated and current-month activity comes from PayPal Sandbox. Sandbox data is not real money. See [`docs/DATA_NOTES.md`](docs/DATA_NOTES.md).

## Quickstart

### Requirements

- Node.js 20.19 or later
- pnpm 9.15.9 (Corepack recommended)
- PayPal Sandbox REST app credentials, for the checkout and live Sandbox features
- A Gemini and/or OpenAI API key, for live AI-advisor answers (without one, the advisor uses its deterministic template)

The dashboard and all four example businesses work **without any API keys**.

### 1. Clone and install

```bash
git clone https://github.com/ahmed-paypal-hackathon-2026/Surplus.git
cd Surplus
corepack enable
pnpm install --frozen-lockfile
```

### 2. Configure environment

```bash
cp .env.example .env
```

Add your own credentials to `.env`. Do not commit this file or share real secrets.

### 3. Seed the local database

```bash
pnpm seed
```

This fills the local SQLite database with the example businesses and the `live_sandbox` baseline. It runs offline; PayPal credentials are only needed for features that contact the Sandbox.

### 4. Start the applications

```bash
pnpm dev
```

- Web dashboard: http://localhost:3000
- API health endpoint: http://localhost:4000/api/health

If the dashboard can't reach the API, check `NEXT_PUBLIC_API_URL` and `WEB_ORIGIN` in `.env`.

### 5. (Optional) Set up a PayPal Sandbox payment

1. In the [PayPal Developer dashboard](https://developer.paypal.com), create a **United States** Sandbox **business** account and a **personal** (buyer) account.
2. Under **Apps & Credentials → Sandbox**, create a REST app linked to the US business account, and copy its Client ID and Secret into `.env`.
3. Add a webhook for `PAYMENT.CAPTURE.COMPLETED` and `PAYMENT.CAPTURE.REFUNDED` pointing at your public API URL `/api/webhooks/paypal`, and copy its ID into `PAYPAL_WEBHOOK_ID`.
4. Check the credentials with `pnpm --filter @surplus/paypal test:token`.

> **Tip:** if a capture fails with `COMPLIANCE_VIOLATION`, the Sandbox business account's country can't receive payments. Use a United States Sandbox business account.

## Environment variables

The complete, placeholder-only template is [`.env.example`](.env.example).

| Variable                       | Purpose                                               |
| ------------------------------ | ----------------------------------------------------- |
| `PAYPAL_CLIENT_ID`             | PayPal Sandbox REST app client ID                     |
| `PAYPAL_CLIENT_SECRET`         | PayPal Sandbox REST app secret                        |
| `PAYPAL_WEBHOOK_ID`            | Webhook ID used for signature verification            |
| `PAYPAL_API_BASE`              | PayPal API base URL; defaults to Sandbox              |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini advisor API key                                |
| `OPENAI_API_KEY`               | OpenAI fallback advisor API key                       |
| `ADMIN_RESET_TOKEN`            | Protects the admin reset endpoint; empty disables it  |
| `DATABASE_PATH`                | SQLite database path, relative to the repository root |
| `HOST` / `PORT`                | API bind host and port                                |
| `NEXT_PUBLIC_API_URL`          | API URL used by the web application                   |
| `WEB_ORIGIN`                   | Exact web origin allowed by the API's CORS policy     |

Never use production PayPal credentials with this demo. Keep `.env` out of version control.

## Development commands

```bash
pnpm dev                                   # Start the web app and API
pnpm seed                                  # Populate deterministic demo data
pnpm build                                 # Build all workspace packages
pnpm test                                  # Run workspace tests
pnpm typecheck                             # Type-check the workspace
pnpm lint                                  # Run ESLint
pnpm format                                # Format repository files
pnpm format:check                          # Check formatting
pnpm --filter @surplus/paypal test:token   # Verify PayPal Sandbox credentials
```

For the PayPal MCP spike, see [`apps/api/src/agent/spikes/README.md`](apps/api/src/agent/spikes/README.md). Live MCP verification needs a Sandbox access token supplied through the environment; never put tokens in command-line arguments or logs.

## Testing and quality

- **Vitest** for unit and package tests.
- **fast-check** property tests: 1,000 random runs prove the safe amount is never negative and the steps always add up exactly.
- **Supertest** for API tests.
- **Golden snapshots** lock the expected engine output for every example business.
- **Advisor evaluation suite**: 15 normal, edge and adversarial prompts (fake numbers, stock picks, return promises).
- **Webhook tests**: valid, tampered and duplicate deliveries; duplicates never double-count.

CI runs build, tests, typecheck, lint and gitleaks on every pull request.

## Deployment

Both services deploy to **Render** from the Blueprint in [`render.yaml`](render.yaml) and auto-deploy from `main`:

- **surplus-web** (Next.js): https://surplus-web.onrender.com/
- **surplus-api** (Express): https://surplus-api-h17e.onrender.com/api/health. The database is seeded during the build.

A local Docker setup is also provided ([`Dockerfile`](Dockerfile), [`docker-compose.yml`](docker-compose.yml)). The hosted SQLite database lives on an ephemeral filesystem, so live Sandbox payments are reset when the service restarts. See [`docs/decisions.md`](docs/decisions.md) and [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md).

## Security, privacy and financial disclaimer

- Use PayPal Sandbox credentials and test accounts only.
- Never commit `.env`, API keys, client secrets, access tokens or webhook secrets (gitleaks runs in CI).
- Raw PayPal free-text fields and payer names and emails are excluded from storage, the UI and the model context.
- Webhooks are signature-verified before any database write, and duplicates are ignored.
- PayPal MCP access is read-only and restricted by an allowlist and sanitizer.
- AI output is explanatory only and is checked against deterministic results and policy rules.
- Surplus does not provide personalized financial, investment, tax or legal advice and does not move or invest funds.

Read [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md), [`docs/DATA_NOTES.md`](docs/DATA_NOTES.md) and [`docs/RISK_ONBOARDING.md`](docs/RISK_ONBOARDING.md) before extending the data or advisor flows.

## Documentation

- [`docs/DATA_NOTES.md`](docs/DATA_NOTES.md): simulated vs. live Sandbox data disclosure
- [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md): security boundaries and threat mitigations
- [`docs/RISK_ONBOARDING.md`](docs/RISK_ONBOARDING.md): risk onboarding and educational disclaimer
- [`docs/decisions.md`](docs/decisions.md): engineering decisions and verification notes
- [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md): release gates
- [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md): demo video walkthrough
- [`AGENT_CONTEXT.md`](AGENT_CONTEXT.md): detailed product and implementation context

## License

This project is licensed under the Apache License 2.0. See [LICENSE](LICENSE).
