# R6 GitHub Issues Backlog Audit

Repository: ahmedeshazly/surplus
Audit date: 2026-11-10
Scope: Issues #46–#51, docs/R6_GITHUB_ISSUES_BACKLOG.md, AGENT_CONTEXT.md task matrix, .github/ownership.json, current source.

## Issue-by-issue audit

### #46 [R2][F-4] Replace pnpm seed stub with deterministic SQLite seeding
- **State:** Test/disposable duplicate
- **Finding:** Body is "Test issue body". Title duplicates #47. Created during gh issue create validation. No implementation details.
- **Verdict:** Disposable test issue. Do not use for execution. Does not represent real work.

### #47 [R2][F-4] Replace pnpm seed stub with deterministic four-persona SQLite seeding
- **Defect confirmed:** Yes
- **Evidence:**
  - `scripts/seed.ts` lines 1-3: `console.log("seed: nothing to seed yet (task F-4, owner R2).")`
  - `fixtures/` contains only `mcp/.gitkeep` and `.gitkeep`. No persona JSON.
  - `packages/paypal/src/sources/windowedLoader.ts` implements live loader only, no fixture path.
  - `packages/paypal/src/sources/index.ts` exports `getMerchantDataset` from windowedLoader.
- **Affected files/symbols:** `scripts/seed.ts`; `fixtures/persona_steady_retainer.json`, `persona_volatile_freelancer.json`, `persona_seasonal_seller.json`, `persona_dispute_spike.json`; `packages/paypal/src/sources/windowedLoader.getMerchantDataset`
- **Actionable:** Partially. Scope requires creating fixtures and seed implementation. Missing concrete fixture schema and golden snapshot references. Acceptance criteria "12 months rows per persona" is measurable but seed completion time <2s and exact row counts not defined per persona.
- **Ownership correct:** Yes. R2 owns scripts/seed.ts and packages/paypal/src/sources/** per ownership.json.
- **Dependencies real:** Yes. Blocks M1, F-12. Depends on R3 golden snapshots for fixture values.
- **Gaps:** Issue asks to export getMerchantDataset to return fixture data, but getMerchantDataset lives in R2 sources. Acceptable. Needs explicit fixture format spec from R3.

### #48 [R2][C-10] Wire live /pay-merchant demo checkout with real PayPal Orders v2 capture
- **Defect confirmed:** Partially
- **Evidence:**
  - `apps/web/src/app/pay-merchant/page.tsx` exists and calls `/api/demo/checkout/create` and `/api/demo/checkout/capture`
  - `apps/api/src/routes/demoCheckout.ts` defines `createDemoCheckoutHandlers` with PayPalOrdersClient dependency
  - `apps/api/src/app.ts` contains no route mounting for `/api/demo/checkout/*`. Grep for "demo" returns 0.
  - `packages/paypal/src/client/orders.ts` and `PaypalClient.ts` exist. Orders v2 client present.
- **Affected files:** `apps/api/src/app.ts`; `apps/api/src/routes/demoCheckout.ts`; `packages/paypal/src/client/orders.ts`
- **Actionable:** Yes, but ownership mismatch. Mounting routes in `apps/api/src/app.ts` is owned by R1 per ownership.json:
  - R1 include: `apps/api/src/routes/**`, `apps/api/src/app.ts`, `apps/api/src/server.ts`
  - R2 include: `apps/api/src/routes/demoCheckout.ts`, `apps/web/src/app/pay-merchant/**`
  Changing `app.ts` requires R1 approval/ownership. Issue assigns to R2.
- **Missing details:** No spec for PayPalOrdersClient integration point, error handling, idempotency.
- **Dependencies real:** Yes. Depends on R1 C-5 webhook verification and PaypalClient.

### #49 [R1][C-12] Verify hosted Render deployment with seed-on-boot and webhook verification
- **Defect confirmed:** Yes, verification pending
- **Evidence:**
  - `render.yaml` defines surplus-api and surplus-web with healthCheckPath /api/health
  - `apps/api/src/server.ts` seeds on boot via `seedOnBoot(store)`
  - `docs/decisions.md` 2026-11-05 entry: "Still manual and external (needs Render dashboard credentials): create Blueprint, set secrets plus WEB_ORIGIN/NEXT_PUBLIC_API_URL, then verify hosted /api/health, SUCCESS webhook verification, and SSE update under 10 seconds."
  - No hosted URL recorded in docs.
- **Affected files:** `render.yaml`, `apps/api/src/server.ts`, `apps/api/src/routes/seed.ts`, `apps/api/src/routes/admin.ts`, `docs/decisions.md`
- **Actionable:** Yes, as verification task. No code change required from R1 beyond documentation. Acceptable as R1 verification.
- **Ownership correct:** Yes. R1 owns render.yaml, server.ts, routes.
- **Dependencies real:** Yes. Depends on R2 F-4 seed and C-5 webhooks.

### #50 [R5][F-10] Add ag-grid-react, ag-grid-community, recharts to apps/web dependencies
- **Defect confirmed:** No
- **Evidence:**
  - `apps/web/package.json` dependencies: `@surplus/contracts`, `next`, `react`, `react-dom`. No ag-grid or recharts.
  - `apps/web/src/components/AuditTable.tsx` comment line 4-6: "The product stack calls for AG Grid Community; apps/web does not yet include ag-grid-react, so this dependency-free grid keeps the audit surface working"
  - `apps/web/src/components/CashFlowChart.tsx` comment line 1-3: "drawn with inline SVG so the dashboard ships with the dependencies already present"
  - Components are implemented without AG Grid/Recharts.
- **Finding:** Issue description claims components reference AG Grid/Recharts. Actual code uses custom table and inline SVG. The K-6 review note about adding dependencies is outdated relative to current implementation.
- **Actionable:** No. Adding dependencies would break current implementation or require refactoring. Issue is incorrectly scoped.
- **Ownership correct:** Yes, R5 owns apps/web/**.
- **Dependencies:** N/A.

### #51 [R4][C-2] Wire real runAdvisorTurn into POST /api/advisor with grounding validator
- **Defect confirmed:** Mischaracterized
- **Evidence:**
  - `apps/api/src/app.ts` lines 292-300: `const response = options.runAdvisorTurn ? await options.runAdvisorTurn(...) : advisorStub(...)`
  - `apps/api/src/server.ts` lines 80-81: passes `runAdvisorTurn` with `getMcpTools` injection.
  - `apps/api/src/agent/advisor.ts` exports `runAdvisorTurn` and imports `validateAdvisorOutput`.
  - `apps/api/src/agent/groundingValidator.ts` exports `validateAdvisorOutput`.
  - Wiring exists.
- **Finding:** The wiring is present. The gap is not missing wiring but lack of integration testing and live model credentials. The R6 C-4 suite `tests/e2e/advisor_evals.test.ts` uses `validateAdvisorOutput` directly with mock drafts, not via `runAdvisorTurn`. Issue incorrectly claims POST /api/advisor returns advisorStub.
- **Affected files:** `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/agent/advisor.ts`
- **Actionable:** Partially. Owner needs to ensure validator is exercised end-to-end and C-4 suite uses real endpoint. Not a wiring defect.
- **Ownership correct:** Yes, R4 owns apps/api/src/agent/**.
- **Dependencies real:** Yes, depends on R3 engine and R1 dataset loader.

## Task coverage matrix vs original R1–R5 task matrix

Based on AGENT_CONTEXT.md Section 8 and repository inspection:

**R1**
- K-2 Monorepo scaffold: Verified complete. CI present, root LICENSE exists.
- K-3 PayPal Sandbox setup: Unverified. No evidence of credentials or test:token run in repo.
- S-1 Token/Transaction Search spike: Unverified. Code exists, awaiting live run per decisions.md.
- S-4 Webhook signature spike: Unverified. Code exists, awaiting live run.
- F-1 PaypalClient: Verified complete. `packages/paypal/src/client/PaypalClient.ts` exists with token cache, backoff.
- F-9 API routes: Verified complete. `apps/api/src/app.ts` implements summary, surplus, plan, scenario, transactions, advisor.
- C-5 Webhook controller idempotency SSE: Verified complete. `apps/api/src/routes/webhooks.ts` implements verify, dedupe, recompute, broadcast.
- C-12 Render deployment: Existing issue #49. Verification pending.
- H-2 Security audit: Partially verified. Decisions.md records audit findings 2026-10-25.
- **New issue needed:** None. C-12 covered.

**R2**
- S-2 Orders v2 capture hybrid store proof: Unverified.
- F-2 SQLite schema windowed loader dedup: Verified complete. `packages/paypal/src/sources/db.ts` schema present, `windowedLoader.ts` implements windowed load.
- F-3 Normalizer prompt injection stripper: Verified complete. `packages/paypal/src/sources/normalizer.ts` exists.
- F-4 Fixture generator and seeder: Existing issue #47. Gap confirmed.
- C-10 /pay-merchant live demo checkout: Existing issue #48. Partial gap confirmed, ownership mismatch.
- H-8 Hosted seed and payment demo support: Unverified. Depends on F-4 and C-10.
- **New issue needed:** None.

**R3**
- K-4 Freeze contracts v1.0: Verified complete. Merge `95e8e8c`.
- F-6 Cash flow summary engine: Verified complete. Merged with K-4.
- F-7 Surplus calculator: Verified complete.
- F-8 Allocation and scenario engine: Verified complete.
- H-7 Golden snapshots 90% coverage: Unverified. No evidence of coverage report in repo.
- **New issue needed:** H-7 coverage verification.

**R4**
- S-5 MCP read-only allowlist sanitizer: Unverified. Code exists per decisions.md but live verification pending.
- F-11 Tool registry MCP integration: Partially verified. `apps/api/src/agent/tools.ts` exists.
- C-2 Advisor orchestrator grounding validator fallback: Existing issue #51. Wiring exists, integration testing missing.
- H-3 Agent hardening: Unverified.
- **New issue needed:** H-3 agent hardening verification.

**R5**
- K-6 Wireframes: Verified complete with action items. `docs/wireframes.md` exists, review recorded APPROVED WITH ACTION ITEMS.
- F-10 Dashboard AG Grid Recharts: Issue #50 exists but defect not confirmed. Implementation uses custom components.
- C-8 Advisor UI tool trace SSE: Verified complete. Components exist.
- H-4 UI polish: Unverified.
- **New issue needed:** None for F-10; issue #50 should be closed/revised.

## Duplicate / overlapping / incorrectly scoped issues

- #46 duplicates title of #47 with no body. Disposable test issue.
- #50 incorrectly scoped. Current UI does not use AG Grid/Recharts. Adding dependencies would require refactoring. Overlaps with K-6 action items but action items were about adding dependencies, now superseded by custom implementation.
- #48 ownership conflict: mounting routes in `apps/api/src/app.ts` is R1 owned. Issue assigned to R2.

## Corrections required before execution

1. Remove or close #46. Do not use.
2. Revise #50: Either close as not needed or change to verify UI meets wireframe requirements without AG Grid/Recharts. Current implementation is dependency-free by design.
3. Reassign ownership for route mounting in #48: R1 must mount demo checkout routes; R2 provides handler. Split issue or add ownership-approved label.
4. Clarify #47 acceptance criteria with exact fixture schema and golden snapshot references from R3.
5. Revise #51 description: Wiring exists. Change focus to integration testing and C-4 suite exercising real endpoint with validator, not stub.
6. Create missing issue for R3 H-7 engine coverage verification.
7. Create missing issue for R4 H-3 agent hardening verification.

## Tasks that can start immediately

- #47 R2 F-4 seeder implementation with fixture creation.
- #49 R1 C-12 hosted verification once credentials available.
- #48 R2 handler completion for demo checkout; R1 route mounting pending ownership approval.

## Revised R6 backlog completion verdict

Backlog is partially valid. Issues #47, #49 are actionable and correctly scoped. Issue #48 needs ownership clarification. Issue #50 is invalid based on current code. Issue #51 mischaracterizes defect. #46 is disposable.

Overall backlog completeness: 2 of 5 issues ready for execution; 3 require correction before start.
