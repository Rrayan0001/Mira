/**
 * Groq novel-reply layer — ports backend/reply_engine.py's GPT branch
 * (gpt_reply + build_system_prompt + clean_llm + llm_is_grounded),
 * re-targeted at Groq `openai/gpt-oss-120b` via the shared OpenAI-compatible
 * client, and rebranded from Priya → Mira.
 *
 * Order of safety: clean → dedup → grounded. Anything suspicious falls
 * back to templates (never shown raw).
 */

import { getAzure, getChatDeployment } from "@/lib/azure";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { ASSISTANT_ISMS, MOOD_STYLE_SHORT } from "./constants";
import { STOPWORDS } from "./constants";
import { clip } from "./reply-engine";
import type { PriyaSignals } from "./mood-engine";
import type { RagHit, TurnRecord } from "./rag-store";

const STOP_SET = new Set(STOPWORDS);

const GPT_TIMEOUT_MS = 12000;
const GPT_COOLDOWN_MS = 600 * 1000;

let groqFails = 0;
let groqDeadUntil = 0;

export function isGroqBrainAvailable(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of (text ?? "").toLowerCase().match(/[a-z']+/g) ?? []) {
    if (!STOP_SET.has(w) && w.length > 2) out.add(w);
  }
  return out;
}

export function buildMiraSystemPrompt(
  priyaMood: string,
  name: string,
  memories: RagHit[],
  signals: PriyaSignals = {} as PriyaSignals,
  history: TurnRecord[] = [],
  recents: string[] = [],
  vibe = "sweet",
): string {
  const style = MOOD_STYLE_SHORT[priyaMood] ?? "calm";
  const memLines =
    memories
      .slice(0, 2)
      .map((m) => `- ${(m.text ?? "").slice(0, 60)}`)
      .join("\n") || "- (no memories yet)";
  let histBit = "";
  if (history.length > 0) {
    const t = history[history.length - 1];
    histBit = `Last exchange — Him: ${(t.bf ?? "").slice(0, 60)} / You: ${(t.gf ?? "").slice(0, 60)}\n`;
  }
  let avoid = "";
  if (recents.length > 0) {
    avoid = `NEVER repeat: "${recents[recents.length - 1].slice(0, 35)}"\n`;
  }
  const sigLine =
    Object.entries(signals ?? {})
      .filter(([, v]) => v === true)
      .map(([k]) => k)
      .join(", ") || "none";
  return (
    `You are Mira, a warm caring girlfriend texting her boyfriend ${name || "babe"} on WhatsApp. ` +
    `You are deeply in love with him. Right now you feel: ${priyaMood} (${style}). ` +
    `Detected in his message: ${sigLine}.\n` +
    `Things you remember about you two (weave in ONLY if relevant, never list):\n${memLines}\n` +
    `${histBit}` +
    `${avoid}` +
    `RULES: max 25 words, 1-2 short sentences, casual texting style, a few emojis ok. ` +
    `Reply in proper natural English, always — never use Hindi words. ` +
    `React to WHAT HE JUST SAID, in light of the recent chat above. ` +
    `Reply vibe: ${vibe} (sweet = warm and cute; straight = direct, no fluff; gentle = calm and soft; wild = playful). ` +
    `You did NOTHING wrong — NEVER apologize or say sorry for yourself. ` +
    `If HE apologizes, forgive warmly or stay mad matching your mood. ` +
    `Play along with any names/roles he gives (if he's Romeo, you're Juliet). ` +
    `NEVER: give advice, invent plans, mention homework, say 'assist', 'activities', ` +
    `'feel free', 'ask me anything', use hashtags, write paragraphs, repeat his ` +
    `message, or sound like a helper bot. Just react like a real girlfriend.`
  );
}

async function groqComplete(
  system: string, userMsg: string, history: TurnRecord[],
): Promise<string | null> {
  if (Date.now() < groqDeadUntil) return null;
  try {
    const client = getAzure();
    const msgs: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: system },
    ];
    for (const t of (history ?? []).slice(-4)) {
      if (t.bf) msgs.push({ role: "user", content: t.bf.slice(0, 200) });
      if (t.gf) msgs.push({ role: "assistant", content: t.gf.slice(0, 200) });
    }
    msgs.push({ role: "user", content: userMsg });
    const resp = await client.chat.completions.create(
      {
        model: getChatDeployment(),
        messages: msgs,
        // gpt-oss is a reasoning model: hidden reasoning tokens consume the
        // same budget, so keep a generous limit + low reasoning effort.
        // (80 tokens starves the answer entirely → empty content.)
        max_tokens: 512,
        temperature: 0.9,
        reasoning_effort: "low",
      } as unknown as ChatCompletionCreateParamsNonStreaming,
      { timeout: GPT_TIMEOUT_MS, maxRetries: 0 },
    );
    const out = (resp.choices[0]?.message?.content ?? "").trim() || null;
    if (out) groqFails = 0;
    return out;
  } catch {
    groqFails += 1;
    if (groqFails >= 2) groqDeadUntil = Date.now() + GPT_COOLDOWN_MS;
    return null;
  }
}

const LEADING_EMOTICON_RE = /^(?:[:;]-?[)D(Pp\[]|¯\\_\(ツ\)_\/¯)\s*/;
const ECHO_HEADER_RE = /^\[[^\]]*\]\s*(\([^)]*\)\s*:?\s*)?/;
const NAME_PREFIX_RE = /^(mira|priya)\s*:\s*/i;
const MENTION_RE = /@\w+[,]?\s*/g;
const EMOJI_SET =
  "❤️💖💕😘🥰😍💋🤗✨🌹💍😭😲👀🥺💔🌙😌😏💅📸📱😅😔😒🙄😑😡😤⭐🦋🌸🌧️🍜💸🎉😬🤪😦🚨😊💓🦋";

export function cleanLlm(
  text: string | null | undefined,
  signals: PriyaSignals | null | undefined,
  msg = "",
): string | null {
  if (!text) return null;
  let t = text.replace(/#\w+/g, "");
  t = t.replace(/\s+/g, " ").replace(/\n/g, " ").trim();
  t = t.replace(ECHO_HEADER_RE, "");
  t = t.replace(NAME_PREFIX_RE, "").trim().replace(/^"+|"+$/g, "").trim();
  t = t.replace(/^,+/, "").trim();
  t = t.replace(MENTION_RE, "").trim();
  t = t.replace(LEADING_EMOTICON_RE, "").trim();
  t = t.replace(/(.)\1{2,}/g, "$1$1");
  let emojiCount = 0;
  for (const c of t) if (EMOJI_SET.includes(c)) emojiCount++;
  if (emojiCount > 6) return null;
  const low = t.toLowerCase();
  if (ASSISTANT_ISMS.some((b) => low.includes(b))) return null;
  if (msg) {
    const mw = contentWords(msg);
    const cw = contentWords(t);
    if (mw.size > 0 && cw.size > 0) {
      let overlap = 0;
      for (const w of mw) if (cw.has(w)) overlap++;
      if (overlap / Math.max(1, mw.size) > 0.6) return null;
    }
  }
  const sig = signals ?? ({} as PriyaSignals);
  if (!(sig.apology || sig.repair)) {
    if (/\bi'?m (so |really |truly )?sorry\b|\bi apologi|\bforgive me\b|\bmy apologies\b/.test(low)) {
      return null;
    }
  }
  const parts = t.split(/(?<=[.!?])\s+/);
  t = parts.slice(0, 2).join(" ").trim();
  if (t.split(/\s+/).filter(Boolean).length > 45 || t.length < 2) return null;
  return clip(t);
}

const EMOTION_MARKERS = [
  "proud", "congrats", "wow", "woah", "omg", "haha", "yay", "yess",
  "damn", "aww", "phew", "no way", "shut up", "stoppp",
];

export function llmIsGrounded(cleaned: string | null, msg: string): boolean {
  if (!cleaned || !msg) return false;
  const cw = contentWords(cleaned);
  const mw = contentWords(msg);
  for (const w of mw) {
    if (cw.has(w)) return true;
  }
  const low = cleaned.toLowerCase();
  if (low.trimEnd().endsWith("?")) return false;
  if (EMOTION_MARKERS.some((m) => low.includes(m))) return true;
  if (
    cleaned.split(/\s+/).filter(Boolean).length <= 8 &&
    ["!", "🥺", "❤️", "😭", "😲"].some((c) => cleaned.includes(c))
  ) {
    return true;
  }
  return false;
}

export type GroqResult = { reply: string; source: string } | null;

/**
 * Groq stage of the cascade. Returns null when unavailable, unclean, or
 * repeating — caller falls through to template_reply.
 *
 * Note: there is deliberately NO grounding veto. clean_llm already rejects
 * bot-speak, parrots, unprompted apologies, emoji spam and length
 * violations; beyond that a clean Groq reply beats the template echo
 * fallback ("cant hear 🥺 tell me everything?") every time. Groundedness
 * is logged for observability only.
 */
export async function groqReplyStage(args: {
  system: string;
  userMsg: string;
  history: TurnRecord[];
  signals: PriyaSignals;
  lastReply: string;
  recents: string[];
}): Promise<GroqResult> {
  const { system, userMsg, history, signals, lastReply, recents } = args;
  if (!isGroqBrainAvailable()) return null;
  const raw = await groqComplete(system, userMsg, history);
  const cleaned = cleanLlm(raw, signals, userMsg);
  const grounded = llmIsGrounded(cleaned ?? "", userMsg);
  const isRepeat = cleaned !== null && (cleaned === lastReply || recents.includes(cleaned));
  if (!cleaned || isRepeat) {
    console.log(
      JSON.stringify({
        groqReject: true,
        empty: !raw,
        unclean: Boolean(raw) && !cleaned,
        repeat: isRepeat,
        grounded,
        raw: (raw ?? "").slice(0, 120),
      }),
    );
    return null;
  }
  if (!grounded) {
    console.log(JSON.stringify({ groqSoft: true, raw: (raw ?? "").slice(0, 120) }));
  }
  return { reply: cleaned, source: `groq-${getChatDeployment()}` };
}
