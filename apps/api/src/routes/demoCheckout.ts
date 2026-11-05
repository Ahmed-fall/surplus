// Owner: R2. Task C-10: demo checkout endpoints that create and capture a
// PayPal Sandbox order for the live pay-merchant flow. Amounts are integer
// cents end to end; free text from PayPal is never stored or returned.
import type { Request, Response } from "express";
import { z } from "zod";
import type { PayPalOrdersClient } from "@surplus/paypal";

const CreateBodySchema = z.object({
  amountCents: z.number().int().positive().optional(),
  returnUrl: z.string().url().optional(),
});

const CaptureBodySchema = z.object({
  orderId: z.string().min(1),
});

export interface DemoCheckoutDeps {
  orders: PayPalOrdersClient;
}

export type DemoCheckoutHandler = (req: Request, res: Response) => Promise<void>;

export function createDemoCheckoutHandlers(deps: DemoCheckoutDeps): {
  create: DemoCheckoutHandler;
  capture: DemoCheckoutHandler;
} {
  const { orders } = deps;

  const create: DemoCheckoutHandler = async (req, res) => {
    const parsed = CreateBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    const amountCents = parsed.data.amountCents ?? 120_000;
    try {
      const order = await orders.createOrder(amountCents, "USD", parsed.data.returnUrl);
      res.status(200).json(order);
    } catch {
      res.status(502).json({ error: "paypal_error" });
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
    } catch {
      res.status(502).json({ error: "paypal_error" });
    }
  };

  return { create, capture };
}
