/** User-chosen reply vibe. Picked in the name popup, shown in the navbar,
 * changeable at any time. Stored on the session, sent with every chat turn. */

export const VIBES = ["gentle", "straight", "wild", "sweet"] as const;
export type Vibe = (typeof VIBES)[number];

export function isVibe(v: unknown): v is Vibe {
  return typeof v === "string" && (VIBES as readonly string[]).includes(v);
}

export const DEFAULT_VIBE: Vibe = "sweet";

export const VIBE_META: Record<
  Vibe,
  { label: string; tagline: string; dot: string }
> = {
  gentle: {
    label: "Gentle",
    tagline: "Calm, soft & comforting",
    dot: "#8fcebf",
  },
  straight: {
    label: "Straight",
    tagline: "Direct, no fluff",
    dot: "#e0a100",
  },
  wild: {
    label: "Wild",
    tagline: "Mad, crazy & playful",
    dot: "#ff2e88",
  },
  sweet: {
    label: "Sweet",
    tagline: "Warm, cute & flirty",
    dot: "#ff9dc4",
  },
};
