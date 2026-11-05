# Surplus threat model

Last reviewed: November 5, 2026 (Africa/Cairo).

## Scope and security goals

This document covers the public web application, Node API, SQLite data store, PayPal REST and
MCP connections, deterministic engine, AI advisor, grounding validator, webhooks, SSE, and the
protected reset endpoint.

The primary goals are:

- never expose credentials, bearer tokens, payer identity, or untrusted PayPal free text;
- never let the model move money or call a write tool;
- never present an unsupported number, named security, return promise, or execution claim;
- verify webhook authenticity before mutation and deduplicate replayed events;
- preserve a useful deterministic response when an external AI or MCP service fails.

## Trust boundaries

| Boundary                  | Untrusted input                                            | Required control                                                                                        |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Browser to API            | Merchant ids, obligations, scenario inputs, admin requests | Contract-backed validation, bounded request bodies, restricted CORS, protected admin header             |
| PayPal webhook to API     | Headers and event payload                                  | PayPal signature verification before any write, event-id deduplication, USD/completed-status guards     |
| PayPal REST to data layer | Transaction and payer fields                               | USD normalization, integer cents, free-text removal, counterparty hashing                               |
| PayPal MCP to advisor     | Remote tool discovery and tool output                      | Read-only allowlist, output projection through `sanitizeMcpOutput`, no raw records in prompts or traces |
| Model to user             | Narrative and citations                                    | Grounding validator, one regeneration, deterministic template fallback, mandatory disclaimer            |
| CI and logs               | Environment values and test fixtures                       | Placeholder-only examples, offline mocks, gitleaks, no secret or token logging                          |

## PayPal MCP controls

PayPal MCP is allowed only for the `live_sandbox` merchant. The four fixture personas use the
deterministic internal engine tools and never open an MCP connection.

The MCP connection uses the approved PayPal Sandbox HTTPS/SSE endpoint with a short-lived bearer
Sandbox access token. The token is supplied at runtime from ignored environment configuration. It
must never be included in source, tests, tool traces, error messages, application logs, screenshots,
or documentation.

The application applies a second client-side allowlist after remote discovery. Only these read-only
tools may reach the model:

- `paypal_mcp_list_transactions`
- `paypal_mcp_list_disputes`

`get_merchant_insights` may be checked during discovery, but it is intentionally not exposed to the
model or the frozen `ToolTraceEntry` contract. Order creation, capture, refund, transfer, payout, and
all other write-capable tools are excluded.

Every MCP result passes through `sanitizeMcpOutput`. The sanitizer projects only numeric pagination
or record counts. It drops raw records and strings, including notes, memos, `custom_id`, subjects,
messages, payer names, identifiers, links, and amount strings. Consequently, malicious strings such
as ticker instructions, fabricated balances, or claims that funds were transferred cannot enter the
prompt, validator evidence, API response, or UI.

The tool trace contains an allowed tool name, elapsed duration, and a numeric or short-enum summary.
It never contains a raw MCP payload. The model receives deterministic engine results plus sanitized
MCP counts; the model does not calculate money.

## Prompt-injection and hallucination defense

Defense is layered:

1. R2's normalizer strips PayPal free text before database persistence.
2. The MCP sanitizer strips remote free text before it reaches model evidence.
3. The model can access only the internal deterministic tools and approved read-only MCP tools.
4. `validateAdvisorOutput` checks cited numbers, prose currency and percentages, banned tickers and
   named instruments, banned promises and execution claims, and the mandatory disclaimer id.
5. A failed draft is regenerated once with the exact rejected tokens.
6. A second failure or model timeout returns `buildDeterministicTemplateNarrative`.

The advisor never names a security, guarantees a return, or claims that an investment, transfer, or
trade was executed.

## Availability and failure behavior

MCP is optional. If connection, discovery, tool execution, or session shutdown fails, the request
continues with internal deterministic tools. If model generation fails or exceeds the timeout, the
API returns the validated deterministic template. The last contract-valid allocation plan is cached
per merchant so the UI retains a usable plan during model failure.

MCP sessions must close on success and error paths. Tests inject mocked sessions; CI never requires
network access or real credentials.

## Other material threats

| Threat                     | Mitigation                                                                  |
| -------------------------- | --------------------------------------------------------------------------- |
| Webhook spoofing           | Verify with PayPal before DB mutation; reject failure with zero mutation    |
| Webhook replay             | Unique `event_id`; duplicates return success without applying twice         |
| Secret disclosure          | Git-ignored `.env`, placeholder `.env.example`, gitleaks, no token logging  |
| Admin reset abuse          | Secret request header, restricted CORS, no public credential                |
| Cross-origin API abuse     | Explicit allowed web origin and bounded JSON body                           |
| SQL injection              | Parameterized SQLite statements and validated inputs                        |
| Personal-data leakage      | No email/name/memo storage; counterparty email becomes an 8-hex hash prefix |
| Financial hallucination    | Deterministic engine, allowed-number registry, citation/prose validation    |
| Dependency/network failure | Internal-tool and deterministic-template fallbacks                          |

## Verification required before public claims

Do not claim hosted PayPal MCP or tool calling in the video, Devpost entry, or presentation until R1
records a hosted `live_sandbox` advisor response containing real
`paypal_mcp_list_transactions` and `paypal_mcp_list_disputes` trace entries. Verification must also
confirm that no token or raw MCP text appears in logs or the response.

R1 reviews webhook, CORS, admin, secret, and MCP transport controls. R4 reviews the agent allowlist,
sanitizer, timeout, validator, and fallback behavior. R6 confirms the compliance suite and public
claims match the verified implementation.
