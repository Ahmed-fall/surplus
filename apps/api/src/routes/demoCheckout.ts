// Owner: R2. Task C-10: demo checkout endpoints that create and capture a
// PayPal Sandbox order for the live pay-merchant flow. Amounts are integer
// cents end to end; free text from PayPal is never stored or returned.
import type { Request, Response } from "express";
import { z } from "zod";
import { PayPalError } from "@surplus/paypal";
import type { PayPalOrdersClient } from "@surplus/paypal";

const CreateBodySchema = z.object({
  amountCents: z.number().int().positive().optional(),
});

const CaptureBodySchema = z.object({
  orderId: z.string().min(1),
});

export interface DemoCheckoutDeps {
  orders: Pick<PayPalOrdersClient, "createOrder" | "captureOrder">;
  /** Web origin PayPal redirects the buyer back to after approval. */
  webOrigin: string;
}

export type DemoCheckoutHandler = (req: Request, res: Response) => Promise<void>;

/**
 * Maps a failure to a fixed reason code. PayPal answers 422 when the buyer has
 * not approved the order yet, which is the usual demo mistake.
 */
function failureReason(err: unknown): "ORDER_NOT_APPROVED" | "PAYPAL_UNAVAILABLE" {
  return err instanceof PayPalError && err.statusCode === 422
    ? "ORDER_NOT_APPROVED"
    : "PAYPAL_UNAVAILABLE";
}

function logFailure(step: "create" | "capture", err: unknown): void {
  const code = err instanceof PayPalError ? err.code : "UNKNOWN";
  const status = err instanceof PayPalError ? err.statusCode : undefined;
  console.error(`demo checkout ${step} failed: ${code} ${status ?? ""}`.trim());
}

export function createDemoCheckoutHandlers(deps: DemoCheckoutDeps): {
  create: DemoCheckoutHandler;
  capture: DemoCheckoutHandler;
} {
  const { orders } = deps;
  const returnUrl = `${deps.webOrigin.replace(/\/+$/, "")}/pay-merchant`;

  const create: DemoCheckoutHandler = async (req, res) => {
    const parsed = CreateBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    const amountCents = parsed.data.amountCents ?? 120_000;
    try {
      const order = await orders.createOrder(amountCents, "USD", {
        returnUrl,
        cancelUrl: `${returnUrl}?cancelled=1`,
      });
      res.status(200).json(order);
    } catch (err) {
      logFailure("create", err);
      res.status(502).json({ error: "paypal_error", reason: failureReason(err) });
    }
  };

  const capture: DemoCheckoutHandler = async (req, res) => {
    const parsed = CaptureBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    try {
      const captureResult = await orders.captureOrder(parsed.data.orderId);
      res.status(200).json(captureResult);
    } catch (err) {
      logFailure("capture", err);
      res.status(502).json({ error: "paypal_error", reason: failureReason(err) });
    }
  };

  return { create, capture };
}
