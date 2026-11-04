// Owner: R2 - F-3 PayPal transaction normalizer.
//
// Maps one raw PayPal Transaction Search record to the frozen
// `NormalizedTransaction` contract. Free text (subjects, notes, custom fields,
// item names, payer names) is never read. Payer email is hashed to the first
// 8 hex chars of SHA-256 and never leaves this module.
import { createHash } from "node:crypto";
import { NormalizedTransactionSchema } from "@surplus/contracts";
import type {
  DataSourceType,
  MerchantId,
  NormalizedTransaction,
  TransactionKind,
  TransactionStatus,
} from "@surplus/contracts";
import type { PayPalTransactionDetail } from "../client/index.js";

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;
const ZERO_HASH = "00000000";

/** PayPal decimal string -> signed integer cents. Returns undefined if malformed. */
export function decimalToSignedCents(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (match === null) return undefined;
  const whole = Number(match[2]);
  const fraction = Number((match[3] ?? "").padEnd(2, "0"));
  const sign = match[1] === "-" ? -1 : 1;
  const cents = sign * (whole * 100 + fraction);
  return Number.isSafeInteger(cents) ? cents : undefined;
}

/** First 8 hex chars of SHA-256 of the lowercased payer email. */
export function hashPayerEmail(email: string | undefined): string {
  if (email === undefined || email.length === 0) return ZERO_HASH;
  return createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 8);
}

/**
 * T-codes from the PayPal reference. Only the codes the team relies on are
 * special-cased; the fallback groups keep every other row classified.
 */
export function transactionKindFor(eventCode: string): TransactionKind {
  if (eventCode === "T1107") return "refund";
  if (eventCode === "T1106" || eventCode.startsWith("T12")) return "chargeback";
  if (eventCode.startsWith("T04")) return "withdrawal";
  if (eventCode === "T1108" || eventCode === "T1109" || eventCode.startsWith("T01")) {
    return "fee";
  }
  if (eventCode.startsWith("T00")) return "income";
  return "other";
}

/** PayPal short status -> contract status. Only "S" is completed. */
export function transactionStatusFor(transactionStatus: string): TransactionStatus {
  if (transactionStatus === "S") return "COMPLETED";
  if (transactionStatus === "P") return "PENDING";
  return "REVERSED";
}

function netCentsFor(kind: TransactionKind, grossCents: number, feeCents: number): number {
  switch (kind) {
    case "income":
      return grossCents - feeCents;
    case "fee":
      return -grossCents;
    case "refund":
    case "chargeback":
    case "withdrawal":
      return -(grossCents + feeCents);
    case "other":
      return grossCents - feeCents;
  }
}

/**
 * Normalizes one raw PayPal transaction detail. Returns null when the row is
 * not usable (non-USD, malformed amount or timestamp). Free text never reaches
 * the output.
 */
export function normalizeTransaction(
  detail: PayPalTransactionDetail,
  merchantId: MerchantId,
  source: DataSourceType,
): NormalizedTransaction | null {
  const info = detail.transaction_info;
  if (info === undefined || info.transaction_id.length === 0) return null;

  const amount = info.transaction_amount;
  if (amount === undefined || amount.currency_code !== "USD") return null;

  const signedCents = decimalToSignedCents(amount.value);
  if (signedCents === undefined) return null;

  const feeCents = Math.abs(decimalToSignedCents(info.fee_amount?.value) ?? 0);
  const grossCents = Math.abs(signedCents);
  const occurred = new Date(info.transaction_initiation_date);
  if (Number.isNaN(occurred.getTime())) return null;
  const occurredAt = occurred.toISOString();

  const kind = transactionKindFor(info.transaction_event_code);
  const transaction: NormalizedTransaction = {
    id: info.transaction_id,
    merchantId,
    occurredAt,
    monthBucket: occurredAt.slice(0, 7),
    kind,
    grossCents,
    feeCents,
    netCents: netCentsFor(kind, grossCents, feeCents),
    currency: "USD",
    status: transactionStatusFor(info.transaction_status),
    counterpartyHash: hashPayerEmail(detail.payer_info?.email_address),
    source,
  };

  // Defense in depth: never emit a row that violates the frozen contract.
  return NormalizedTransactionSchema.safeParse(transaction).success ? transaction : null;
}
