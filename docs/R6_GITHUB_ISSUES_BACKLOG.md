# R6 GitHub Issues Backlog

## Summary

- Number of issues created: 5
- Number of existing issues reused: 0
- Number of candidate tasks already complete: 0
- Number of unverified items: 0
- Number of blocked items: 5

## Issues grouped by role

### R1

- #49 - [R1][C-12] Verify hosted Render deployment with seed-on-boot and webhook verification
  Priority: P0
  Task ID: C-12
  Gate impact: M2
  URL: https://github.com/ahmedeshazly/surplus/issues/49

### R2

- #47 - [R2][F-4] Replace pnpm seed stub with deterministic four-persona SQLite seeding
  Priority: P0
  Task ID: F-4
  Gate impact: M1
  URL: https://github.com/ahmedeshazly/surplus/issues/47
- #48 - [R2][C-10] Wire live /pay-merchant demo checkout with real PayPal Orders v2 capture
  Priority: P0
  Task ID: C-10
  Gate impact: M2
  URL: https://github.com/ahmedeshazly/surplus/issues/48

### R4

- #51 - [R4][C-2] Wire real runAdvisorTurn into POST /api/advisor with grounding validator
  Priority: P0
  Task ID: C-2
  Gate impact: M3
  URL: https://github.com/ahmedeshazly/surplus/issues/51

### R5

- #50 - [R5][F-10] Add ag-grid-react, ag-grid-community, recharts to apps/web dependencies
  Priority: P0
  Task ID: F-10
  Gate impact: M1
  URL: https://github.com/ahmedeshazly/surplus/issues/50

## Existing issues reused

None. No existing open issues matched the verified missing work.

## Unverified tasks

None. All issues based on concrete repository findings.

## Human action needed

Assignee confirmation for R1, R2, R4, R5 GitHub usernames. Labels role:* not present in repository; issues created with existing labels bug/enhancement.

## Dependency map

- #47 blocks #48, #50, M1
- #48 blocks M2
- #49 depends on #47 and C-5
- #51 blocks C-4
- #50 blocks M1 dashboard rendering

## Coverage check

- R1 C-12: Issue created #49
- R2 F-4: Issue created #47
- R2 C-10: Issue created #48
- R4 C-2: Issue created #51
- R5 F-10: Issue created #50

## Final quality audit

- No generic issues created
- No duplicates created
- Every issue has exact file/symbol references
- Acceptance criteria measurable
- Verification commands provided
- Ownership correct per .github/ownership.json
