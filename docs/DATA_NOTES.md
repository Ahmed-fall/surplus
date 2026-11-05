# Surplus data notes

Last reviewed: November 5, 2026 (Africa/Cairo).

## Honest data disclosure

Surplus is a Sandbox demonstration, not a production financial account. It combines live PayPal
Sandbox activity with deterministic simulated history so the cash-flow engine can demonstrate a
full twelve-month analysis.

| Merchant                      | Data represented                                                        | PayPal MCP use                                      |
| ----------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------- |
| `live_sandbox`                | Current-month PayPal Sandbox activity plus 11 simulated baseline months | Read-only MCP may be used after hosted verification |
| `persona_steady_retainer`     | Fully simulated 12-month fixture                                        | Never                                               |
| `persona_volatile_freelancer` | Fully simulated 12-month fixture                                        | Never                                               |
| `persona_seasonal_seller`     | Fully simulated 12-month fixture                                        | Never                                               |
| `persona_dispute_spike`       | Fully simulated 12-month fixture                                        | Never                                               |

The four personas are designed test cases, not real merchants. The eleven historical baseline months
for `live_sandbox` are also simulated because PayPal Sandbox transactions cannot be backdated across
twelve prior months. Current live captures enter through verified PayPal webhooks.

## What is stored

Normalized transactions contain integer-cent USD amounts, event time, kind, status, source, and an
8-hex-character hash prefix for the counterparty. The database does not store payer email addresses,
payer names, notes, memos, `custom_id`, subjects, messages, or other PayPal free text. Non-USD rows
are excluded and counted.

Balances distinguish their source:

- `PAYPAL_REPORTING_API` for a reporting snapshot;
- `LIVE_WEBHOOK_ADJUSTED` after a verified live event updates the cached balance;
- `FIXTURE` for deterministic demonstration data.

## What the model sees

The model does not receive raw PayPal records and does not calculate money. It receives:

- deterministic `CashFlowSummary`, `SurplusResult`, and `AllocationPlan` tool output;
- optional sanitized PayPal MCP counts for `live_sandbox` only.

MCP output is reduced to safe numeric fields such as records on page, total items, and total pages.
Raw notes, names, identifiers, amount strings, messages, subjects, and links are removed before prompt
construction. The four fixture personas never connect to MCP.

Every advisor response is checked against the deterministic evidence. Unsupported numbers, named
securities, promise language, and claims that money was moved cause regeneration or a deterministic
template fallback. Every response includes the educational-only disclaimer.

## Known limitations

- Sandbox balances and transactions are test data and must not be represented as production funds.
- Simulated historical months demonstrate behavior but do not predict a real merchant's future cash
  flow or investment outcome.
- PayPal reporting can be delayed; verified webhooks provide the immediate demo update.
- An MCP connection or model may be unavailable. The application continues with deterministic
  internal tools and a template fallback.
- No advisor output executes a trade, transfer, payout, refund, or investment.

## Public-claim gate

Until R1 records hosted verification showing real `paypal_mcp_list_transactions` and
`paypal_mcp_list_disputes` trace entries for `live_sandbox`, public materials must describe PayPal MCP
as pending verification rather than a demonstrated hosted feature.
