Surplus
Explainable Treasury Runway & Idle-Cash Allocation Advisor for PayPal-Paid Freelancers and Small Merchants

Surplus helps freelancers and small merchants understand how much of their PayPal cash balance may be safely available after accounting for operating needs, income volatility, expected refunds, and open disputes. A deterministic financial engine calculates the figures; an AI advisor explains the results and suggests an educational, staged allocation plan. A grounding validator checks the response before it is shown.
Important — Sandbox demonstration: Surplus is an educational prototype, not a bank, broker, investment adviser, or production financial account. PayPal Sandbox activity and simulated historical fixtures are demonstration data. Surplus does not execute investments, trades, transfers, payouts, or refunds.

Project status and verification
The repository includes the application, deterministic engine, PayPal integration packages, fixtures, tests, deployment configuration, and release documentation.

The latest team execution report (November 10, 2026) records the following status:
- Implemented: core documentation, deterministic persona fixtures and golden-value tests, risk-onboarding copy, threat model, data notes, and a 15-prompt advisor evaluation suite.
- Not independently verified: clean-clone setup, full end-to-end acceptance, real Advisor execution against the evaluation suite, and hosted deployment.
- Blocked / outstanding at report time: public Render verification, live Sandbox payment-to-webhook-to-SSE demonstration, and recording/uploading the public demo video.
Do not interpret the presence of deployment files or test cases as proof that a public deployment or live payment journey has been verified. See [`docs/R6_FINAL_EXECUTION_REPORT.md`](docs/R6_FINAL_EXECUTION_REPORT.md) and [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) for the detailed gate status.
The problem
PayPal-paid freelancers and small merchants often see a balance without knowing how much is genuinely available after upcoming obligations and cash-flow risks. A high balance can be misleading when income is irregular, refunds are likely, or disputes are still open.

Surplus turns transaction history into an explainable runway estimate and a cautious staged allocation plan. The language model does not calculate financial values or decide what money is safe to use.
Core features
- Deterministic cash-flow engine — calculates cash-flow summaries, safe surplus, allocation bands, and scenario comparisons using integer cents for monetary values.
- 12-month analysis — combines historical monthly data with current activity to provide a consistent analysis window.
- Risk-aware reserves — accounts for operating buffers, income volatility, expected refund exposure, and open disputes before calculating safe surplus.
- Staged allocation plan — proposes staged amounts based on the merchant's risk profile, with allocation bands and a high-volatility adjustment.
- What-if scenario engine — models income shocks, delayed payments, and one-off expenses, then compares the results with the baseline.
- AI advisor — uses Gemini 2.5 Flash as the primary model and GPT-4o-mini as a fallback (when the corresponding API keys are configured). The advisor explains deterministic tool outputs and can use read-only tools; it does not perform money calculations.
- Grounding and safety validation — checks numbers against an allowed evidence registry, checks citations and policy language, blocks named securities/tickers and promises of execution, and requires an educational disclaimer. An invalid response is regenerated once before a deterministic template fallback is used.
- PayPal updates — supports PayPal Sandbox data and verified payment webhooks. A verified PAYMENT.CAPTURE.COMPLETED event can update the cached balance, trigger recomputation, and broadcast an update over Server-Sent Events (SSE).
- PayPal MCP boundary — read-only access is restricted to approved transaction, dispute, and merchant-insight tools. MCP output is sanitized; raw PayPal free text and personal details are not passed to the model.
- Dashboard and audit UI — includes persona selection, cash-flow trends, an audit table, scenario controls, advisor trace information, and validation status. Some UI/release acceptance items remain subject to the verification status above.
- Privacy-conscious storage — stores a short SHA-256 counterparty hash prefix rather than payer names or email addresses; free-text fields such as notes, memos, subjects, and messages are excluded.
Architecture overview
┌───────────────────────────────────────────────────────────────┐
│                    NEXT.JS WEB APPLICATION                     │
│                 apps/web — React / TypeScript                  │
│        Dashboard • Personas • Trends • Audit • What-if          │
└──────────────────────────────┬────────────────────────────────┘
                               │ REST + Server-Sent Events
                               ▼
┌───────────────────────────────────────────────────────────────┐
│                       NODE.JS API                              │
│                    apps/api — Express                           │
│  Routes • AI Advisor • Tool orchestration • MCP sanitization   │
│                    • Grounding validator                        │
└───────────────┬───────────────────────────────┬────────────────┘
                │                               │
                ▼                               ▼
┌──────────────────────────────┐   ┌────────────────────────────┐
│       DOMAIN PACKAGES        │   │       EXTERNAL SERVICES     │
│  @surplus/contracts          │   │  PayPal REST Sandbox        │
│  @surplus/engine             │   │  PayPal MCP (read-only)     │
│  @surplus/paypal             │   │  Gemini / OpenAI APIs       │
└───────────────┬──────────────┘   └────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────────────────────┐
│                  SQLITE (WAL MODE)                              │
│          Local merchant data • fixtures • event state          │
└───────────────────────────────────────────────────────────────┘
Data and AI boundary
1. PayPal transaction, balance, dispute, and webhook data enters through the PayPal integration layer.
2. The engine normalizes eligible data and calculates the financial metrics deterministically.
3. The advisor receives approved tool outputs, not raw PayPal records, and explains the computed results.
4. The grounding validator checks the advisor response against the deterministic evidence and safety rules.
5. The validated response and computed figures are presented in the dashboard.
Technology stack
Layer	Technology
Frontend	Next.js, React, TypeScript
Data visualization	Recharts
Data grid	AG Grid Community
Backend API	Node.js, Express, TypeScript
AI orchestration	Vercel AI SDK v4, @ai-sdk/google, @ai-sdk/openai
AI models	Gemini 2.5 Flash (primary), GPT-4o-mini (fallback)
Financial engine	TypeScript, deterministic calculations, fast-check property testing
Database	SQLite with WAL mode (better-sqlite3)
PayPal	PayPal REST API Sandbox, PayPal AI Toolkit / MCP read-only tools, webhooks
Testing	Vitest, Supertest, fast-check, end-to-end evaluation tests
Package manager	pnpm 9.15.9
Runtime	Node.js 20.19+
Deployment configuration	Render Blueprint, Docker
License	Apache-2.0


Repository layout
Surplus/
├── apps/
│   ├── api/                    # Express API, advisor, MCP boundary, webhooks
│   └── web/                    # Next.js dashboard
├── packages/
│   ├── contracts/              # Shared TypeScript contracts
│   ├── engine/                 # Deterministic cash-flow and surplus calculations
│   └── paypal/                 # PayPal integration, data sources, SQLite access
├── fixtures/                   # Merchant personas and Sandbox demonstration data
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
Demonstration personas
The repository includes four deterministic test personas and one hybrid Sandbox persona:
- persona_steady_retainer — relatively consistent recurring income.
- persona_volatile_freelancer — irregular income and higher volatility.
- persona_seasonal_seller — seasonal revenue patterns.
- persona_dispute_spike — elevated dispute exposure.
- live_sandbox — current-month PayPal Sandbox activity combined with eleven simulated historical baseline months.
Data disclosure: the four named personas are simulated test cases. For live_sandbox, the historical baseline is simulated; current-month activity can come from PayPal Sandbox. Sandbox data is not real production money. See [`docs/DATA_NOTES.md`](docs/DATA_NOTES.md).
Quickstart
Requirements
- Node.js 20.19 or later
- pnpm 9.15.9 (Corepack is recommended)
- PayPal Sandbox REST app credentials for live Sandbox integration features
- Gemini and/or OpenAI API key for live AI-advisor responses
1. Clone and install
git clone <YOUR_PUBLIC_REPOSITORY_URL>
cd Surplus
corepack enable
pnpm install --frozen-lockfile
2. Configure environment
cp .env.example .env
Add your own credentials to .env. Do not commit this file or share real secrets.
3. Seed the local database
pnpm seed
The seed script populates the local SQLite database with the deterministic personas and the hybrid live_sandbox baseline. It is intended to run offline; live PayPal credentials are needed only for features that contact PayPal Sandbox.
4. Start the applications
pnpm dev
By default:
- Web dashboard: http://localhost:3000
- API health endpoint: http://localhost:4000/api/health
If the dashboard cannot reach the API, verify NEXT_PUBLIC_API_URL and WEB_ORIGIN in .env.
Environment variables
The complete, placeholder-only template is .env.example.
Variable	Purpose
PAYPAL_CLIENT_ID	PayPal Sandbox REST application client ID
PAYPAL_CLIENT_SECRET	PayPal Sandbox REST application secret
PAYPAL_WEBHOOK_ID	Webhook ID used for signature verification
PAYPAL_API_BASE	PayPal API base URL; defaults to Sandbox
GOOGLE_GENERATIVE_AI_API_KEY	Gemini advisor API key
OPENAI_API_KEY	OpenAI fallback advisor API key
ADMIN_RESET_TOKEN	Protects the local/admin reset endpoint; empty disables it
DATABASE_PATH	SQLite database path, relative to repository root
HOST / PORT	API bind host and port
NEXT_PUBLIC_API_URL	API URL used by the web application
WEB_ORIGIN	Exact web origin allowed by API CORS


Never use production PayPal credentials in this hackathon demo configuration. Keep .env out of version control.
Development commands
pnpm dev                         # Start workspace applications
pnpm seed                        # Populate deterministic demo data
pnpm build                       # Build all workspace packages
pnpm test                        # Run workspace tests
pnpm typecheck                   # Type-check the workspace
pnpm lint                        # Run ESLint
pnpm format                      # Format repository files
pnpm format:check                # Check formatting
pnpm --filter @surplus/paypal test:token  # Run PayPal token test helper
For the PayPal MCP spike, see [`apps/api/src/agent/spikes/README.md`](apps/api/src/agent/spikes/README.md). Live MCP verification requires a PayPal Sandbox access token supplied through the environment; never place tokens in command-line arguments or logs.
Testing and quality
The repository uses:
- Vitest for unit and package tests.
- fast-check for property-based tests of financial calculations.
- Supertest for API tests.
- Golden persona snapshots to protect expected deterministic engine outputs.
- Advisor evaluation cases covering grounded responses and adversarial/compliance prompts.
- Webhook idempotency tests to ensure duplicate event delivery does not double-apply an update.
Run the checks with:
pnpm build
pnpm test
pnpm typecheck
pnpm lint
The November 10 execution report says the clean-clone run and several integrated acceptance gates had not yet been independently verified. Review the release checklist before treating these commands or test files as evidence of a release-ready deployment.
Deployment
A Render Blueprint is provided in [`render.yaml`](render.yaml), and a local Docker configuration is provided in Dockerfile and [`docker-compose.yml`](docker-compose.yml).

Deployment configuration is not equivalent to a verified public deployment. Before presenting a hosted demo as working, verify the API health endpoint, PayPal Sandbox webhook signature, payment-to-balance update, and SSE delivery on the deployed services. The current SQLite deployment configuration uses an ephemeral filesystem; live webhook rows may not persist across service restarts. See [`docs/decisions.md`](docs/decisions.md) and [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md).
Security, privacy, and financial disclaimer
- Use PayPal Sandbox credentials and test accounts only.
- Do not commit .env, API keys, client secrets, access tokens, or webhook secrets.
- Raw PayPal free-text fields and payer names/emails are excluded from the model context and normalized storage.
- PayPal MCP access is read-only and restricted by an application allowlist and sanitizer.
- AI output is explanatory only and is checked against deterministic results and policy rules.
- Surplus does not provide personalized financial, investment, tax, or legal advice and does not move or invest funds.
Read [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md), [`docs/DATA_NOTES.md`](docs/DATA_NOTES.md), and [`docs/RISK_ONBOARDING.md`](docs/RISK_ONBOARDING.md) before extending the data or advisor flows.
Documentation
- [`docs/DATA_NOTES.md`](docs/DATA_NOTES.md) — simulated vs. live Sandbox data disclosure.
- [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) — security boundaries and threat mitigations.
- [`docs/RISK_ONBOARDING.md`](docs/RISK_ONBOARDING.md) — risk onboarding and educational disclaimer.
- [`docs/decisions.md`](docs/decisions.md) — engineering decisions and verification notes.
- [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) — release gates and outstanding checks.
- [`docs/R6_FINAL_EXECUTION_REPORT.md`](docs/R6_FINAL_EXECUTION_REPORT.md) — latest consolidated execution status.
- [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) — planned public demo walkthrough.
- [`AGENT_CONTEXT.md`](AGENT_CONTEXT.md) — detailed product and implementation context.
License
This project is licensed under the Apache License 2.0. See LICENSE.
