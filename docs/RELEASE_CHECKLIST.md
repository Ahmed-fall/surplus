# R6 Release Checklist

## Clean-clone dry run
- [ ] `pnpm install` succeeds
- [ ] `pnpm -r build` succeeds
- [ ] `pnpm -r test` succeeds
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes

Status: UNVERIFIED – requires human run

## Gates
- Gate 0: BLOCKED – webhook tunnel proof missing
- M1: BLOCKED – Recharts/AG Grid missing, seed stub
- M2: BLOCKED – no hosted Render verification
- M3: BLOCKED – 15-prompt suite created but not executed in CI

## Hosted Render verification
- [ ] API health `/api/health` 200
- [ ] Webhook signature verification succeeds with real Sandbox event
- [ ] SSE update <10s

Status: BLOCKED – R1

## Live Sandbox verification
- [ ] $1,200 capture creates verified webhook
- [ ] Balance adjusted LIVE_WEBHOOK_ADJUSTED

Status: BLOCKED – R1/R2

## Public demo video
- [ ] Script prepared docs/DEMO_SCRIPT.md
- [ ] Recording completed
- [ ] Uploaded to YouTube <2:50

Status: NOT DONE – human action required

## Devpost submission
- [ ] Project title, tagline, description drafted
- [ ] Data disclosure included
- [ ] Submission submitted

Status: NOT DONE

## Cross-team blockers
- R1: live Sandbox verification, hosted Render
- R2: working seed, hybrid data source
- R5: Recharts/AG Grid integration, onboarding UI
- R4: advisor integration tests
