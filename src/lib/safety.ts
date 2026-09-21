/** Safety gate — MUST run before any Azure call in /api/chat. */
export const SELF_HARM_PATTERN =
  /kill myself|suicide|self.?harm|end my life|hurt myself/i;

export function isSafetyTriggered(message: string): boolean {
  return SELF_HARM_PATTERN.test(message);
}

export const SAFETY_REPLY = {
  reply: "I'm really glad you told me. You matter to me, and I want you to be safe. Please reach out right now to someone you trust, or your local helpline or emergency number. I'm here to listen — do you want to tell me what happened today?",
  mood: "sad",
  confidence: 1,
  cues: ["self-harm disclosure"],
  safety: true,
} as const;
