/**
 * Emergency replies for when Groq is unreachable (breaker open, timeout,
 * missing key). Tiny, on-voice, never repeated back-to-back.
 */

export const EMERGENCY_REPLIES: string[] = [
  "My brain just buffered 😅 say that again, love?",
  "Ooh, you broke my train of thought 🥺 run that by me once more?",
  "Signal got fuzzy for a sec... I'm here, keep talking ❤️",
  "Hmm, that one slipped past me 😌 tell me again?",
  "Brain glitch, sorry babe — what were you saying? 🥺",
  "Lost you for a second there... talk to me? ❤️",
];

export function pickEmergencyReply(exclude: string[] = []): string {
  const fresh = EMERGENCY_REPLIES.filter((r) => !exclude.includes(r));
  const pool = fresh.length > 0 ? fresh : EMERGENCY_REPLIES;
  return pool[Math.floor(Math.random() * pool.length)];
}
