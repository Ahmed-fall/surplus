// Owner: R5. Persona and risk-profile presentation metadata. Merchant ids come
// from the frozen @surplus/contracts enum; no contract types are redefined.
import type { MerchantId, RiskProfile } from "@surplus/contracts";

export interface PersonaOption {
  id: MerchantId;
  label: string;
  shortLabel: string;
  description: string;
  dataSource: "live" | "fixture";
  defaultObligationsCents: number;
}

export const PERSONAS = [
  {
    id: "live_sandbox",
    label: "Demo Live Sandbox Merchant",
    shortLabel: "Live",
    description: "Connected to PayPal Sandbox. Make a test payment and watch it update.",
    dataSource: "live",
    defaultObligationsCents: 300_000,
  },
  {
    id: "persona_steady_retainer",
    label: "Steady Retainer",
    shortLabel: "Steady",
    description: "Same clients paying about the same amount every month.",
    dataSource: "fixture",
    defaultObligationsCents: 300_000,
  },
  {
    id: "persona_volatile_freelancer",
    label: "Volatile Freelancer",
    shortLabel: "Volatile",
    description: "Big project payments some months, very little in others.",
    dataSource: "fixture",
    defaultObligationsCents: 300_000,
  },
  {
    id: "persona_seasonal_seller",
    label: "Seasonal Seller",
    shortLabel: "Seasonal",
    description: "Busy holiday season, quieter the rest of the year.",
    dataSource: "fixture",
    defaultObligationsCents: 300_000,
  },
  {
    id: "persona_dispute_spike",
    label: "Dispute Spike",
    shortLabel: "Disputes",
    description: "More refunds and open disputes than usual.",
    dataSource: "fixture",
    defaultObligationsCents: 300_000,
  },
] as const satisfies readonly PersonaOption[];

// Open on a populated fixture persona so the first screen shows a full model;
// the live merchant starts empty until a Sandbox payment arrives.
export const DEFAULT_PERSONA_ID: MerchantId = "persona_steady_retainer";

export function personaById(id: MerchantId): PersonaOption {
  return PERSONAS.find((persona) => persona.id === id) ?? PERSONAS[0];
}

export interface RiskProfileOption {
  id: RiskProfile;
  label: string;
  description: string;
}

export const RISK_PROFILES = [
  {
    id: "CONSERVATIVE",
    label: "Conservative",
    description: "6 staged tranches · wider cash and bond bands",
  },
  {
    id: "BALANCED",
    label: "Balanced",
    description: "4 staged tranches · balanced asset-class bands",
  },
  {
    id: "GROWTH",
    label: "Growth",
    description: "3 staged tranches · larger equity index band",
  },
] as const satisfies readonly RiskProfileOption[];

export function riskProfileLabel(profile: RiskProfile): string {
  return RISK_PROFILES.find((option) => option.id === profile)?.label ?? profile;
}
