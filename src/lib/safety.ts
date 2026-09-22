/** Safety gate — MUST run before any Azure call in /api/chat. */
export const SELF_HARM_PATTERN =
  /kill myself|suicide|self.?harm|end my life|hurt myself/i;

// Phrases that mention the words without self-harm intent (movie titles,
// song lyrics quoted without "I", past-tense accidents...). Checked first.
const SAFETY_EXCLUSIONS =
  /suicide squad|suicideboys|suicide silence/i;

export function isSafetyTriggered(message: string): boolean {
  if (SAFETY_EXCLUSIONS.test(message)) return false;
  return SELF_HARM_PATTERN.test(message);
}

export const SAFETY_REPLY = {
  reply: "I'm really glad you told me. You matter to me, and I want you to be safe. Please reach out right now to someone you trust, or your local helpline or emergency number. I'm here to listen — do you want to tell me what happened today?",
  mood: "sad",
  confidence: 1,
  cues: ["self-harm disclosure"],
  safety: true,
} as const;
