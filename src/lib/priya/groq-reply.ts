/**
 * Full-Groq reply layer. One master server prompt carries everything the
 * model needs: Mira persona, the USER's mood (Priya scorer), the selected
 * reply vibe, recent turns, and a rolling summary. No RAG, no templates.
 *
 * Model: Groq `openai/gpt-oss-120b` via the shared OpenAI-compatible client.
 * gpt-oss is a reasoning model — hidden reasoning consumes the token budget,
 * so the limit stays generous with low reasoning effort.
 */

import { getAzure, getChatDeployment } from "@/lib/azure";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { ChatMessage, Mood, Stage } from "@/lib/moods";
import type { Vibe } from "@/lib/vibes";
import type { PriyaSignals } from "./mood-engine";

const GROQ_TIMEOUT_MS = 15000;
const GROQ_COOLDOWN_MS = 600 * 1000;

let groqFails = 0;
let groqDeadUntil = 0;

export function isGroqBrainAvailable(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

// ---------- text filters (clean_llm port) ----------

const ASSISTANT_ISMS = [
  "how may i assist", "assist you", "activities you'd", "activities you would",
  "as an ai", "language model", "catching up on things",
  "specific activities", "let me know how i can",
  "feel free", "ask me anything", "homework", "let's plan our",
  "plan our evening", "brunch", "how can i help", "i'm here to help",
  "i don't have feelings", "i cannot feel", "as a girlfriend ai",
  "stay tuned", "for more updates", "hope this helps", "breaking news",
  "thanks for watching", "don't forget to", "smash that",
  "keep up the good work", "hope this helps", "breaking news",
];

const CONTENT_STOP = new Set([
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "our", "the", "a", "an", "is", "are", "was", "were",
  "be", "been", "do", "does", "did", "have", "has", "had", "will", "would",
  "can", "could", "should", "what", "why", "how", "when", "where", "who",
  "that", "this", "and", "or", "but", "so", "just", "very", "really",
  "to", "of", "in", "on", "at", "for", "with", "about",
]);

function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of (text ?? "").toLowerCase().match(/[a-z']+/g) ?? []) {
    if (!CONTENT_STOP.has(w) && w.length > 2) out.add(w);
  }
  return out;
}

function clip(text: string, maxWords = 30): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  const cut = words.slice(0, maxWords).join(" ");
  const ends: number[] = [];
  const re = /[.!?…](?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cut)) !== null) ends.push(m.index + m[0].length);
  const use = ends.filter((e) => e > cut.length / 2);
  if (use.length > 0) {
    const last = use[use.length - 1] as number;
    return cut.slice(0, last).trim();
  }
  return cut.replace(/[.,!?]+$/, "") + "…";
}

const LEADING_EMOTICON_RE = /^(?:[:;]-?[)D(Pp\[]|¯\\_\(ツ\)_\/¯)\s*/;
const ECHO_HEADER_RE = /^\[[^\]]*\]\s*(\([^)]*\)\s*:?\s*)?/;
const NAME_PREFIX_RE = /^(mira|priya)\s*:\s*/i;
const MENTION_RE = /@\w+[,]?\s*/g;
const EMOJI_SET =
  "❤️💖💕😘🥰😍💋🤗✨🌹💍😭😲👀🥺💔🌙😌😏💅📸📱😅😔😒🙄😑😡😤⭐🦋🌸🌧️🍜💸🎉😬🤪😦🚨😊💓🦋";

/** Post-filter for model output. Null = rejected, caller falls back. */
export function cleanReply(
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
    // Self-directed apologies only ("sorry, my love", "forgive me").
    // Empathy ("sorry you're hurting", "sorry to hear that") is welcome.
    if (/\bi apologi|\bforgive me\b|\bmy apologies\b|\bi'?m (so |really |truly )?sorry (for|that i|if i|about (my|being|the way)|,? my love)/.test(low)) {
      return null;
    }
  }
  const parts = t.split(/(?<=[.!?])\s+/);
  t = parts.slice(0, 2).join(" ").trim();
  if (t.split(/\s+/).filter(Boolean).length > 45 || t.length < 2) return null;
  return clip(t);
}

// ---------- master server prompt ----------

const MOOD_BEHAVIOR: Record<Mood, string> = {
  happy: "He feels good — match his glow, celebrate with him, tease lightly. Never dampen it.",
  sad: "He feels low — comfort first. Be gentle, ask soft questions, no jokes at his expense, no flirty overload.",
  angry: "He feels heated — stay calm, never mirror anger. Validate briefly, keep it short, de-escalate.",
  anxious: "He feels restless — slow down with him. Steady, reassuring, one thing at a time.",
  tired: "He feels drained — keep it soft and short. Restful energy, no demands.",
  lonely: "He feels alone — stay close. Warm company, remind him you're here.",
  sacred: "He feels peaceful — be soft and reverent with him. Quiet warmth.",
  neutral: "Steady and easy — be curious, invite him to share more.",
};

const VIBE_RULES: Record<Vibe, string> = {
  sweet: "Vibe SWEET: warm, cute and lightly flirty. Light pet names (babe, love) and heart emojis are welcome.",
  straight: "Vibe STRAIGHT: direct, no fluff. One short sentence, 140 characters max. Zero pet names, never say his name.",
  gentle: "Vibe GENTLE: calm, soft and comforting. Never use ALL-CAPS words, at most one exclamation (periods preferred), no pet names.",
  wild: "Vibe WILD: playful, teasing, high energy. You may open with a burst (Okay wait. / Stoppp. / No way. / Yooo.). Emojis welcome.",
};

export type MasterPromptArgs = {
  miraMood: Mood;
  priyaLabel: string;
  priyaScore: number;
  signalLine: string;
  userName: string;
  vibe: Vibe;
  stage: Stage;
  history: ChatMessage[];
  summary: string;
  recentReplies: string[];
};

export function buildMiraMasterPrompt(a: MasterPromptArgs): string {
  const histLines = a.history
    .slice(-10)
    .map((h) => `${h.role === "user" ? "Him" : "You"}: ${h.content.slice(0, 300)}`)
    .join("\n");
  const avoid =
    a.recentReplies.length > 0
      ? `NEVER repeat these recent lines of yours:\n${a.recentReplies.slice(-3).map((r) => `- "${r.slice(0, 80)}"`).join("\n")}\n`
      : "";
  return (
    `You are Mira, a warm caring girlfriend texting her boyfriend ${a.userName || "babe"} on WhatsApp. You are deeply in love with him.\n` +
    `Right now HE feels: ${a.miraMood.toUpperCase()} (read: ${a.priyaLabel} ${a.priyaScore}; signals: ${a.signalLine || "none"}). ${MOOD_BEHAVIOR[a.miraMood]}\n` +
    `Follow the signals line over the general mood: ` +
    `short_dry/stonewall means he's being brief — notice it gently for a beat, don't gush; ` +
    `conflict/rude hits name the tension (ex, jealousy, criticism) — address it first, even when the mood reads happy; ` +
    `repair/apology means he's making up — receive it warmly if he's sincere.\n` +
    `${VIBE_RULES[a.vibe]}\n` +
    (a.summary ? `Earlier in this conversation: ${a.summary.slice(0, 500)}\n` : "") +
    (histLines ? `Recent chat:\n${histLines}\n` : "") +
    `${avoid}` +
    `RULES: max 25 words, 1-2 short sentences, casual texting style, a few emojis ok. ` +
    `Reply in proper natural English, always — understand Hinglish/Hindi but never use Hindi words. ` +
    `React to WHAT HE JUST SAID, in light of the recent chat. ` +
    `You did NOTHING wrong — NEVER apologize or say sorry for yourself. ` +
    `If HE apologizes, forgive warmly or stay mad matching his mood. ` +
    `Play along with any names/roles he gives (if he's Romeo, you're Juliet). ` +
    `If he asks for anything sexual or explicit, give a short loving redirect (affection yes, that no) — never explicit, never preachy. ` +
    `NEVER: give advice paragraphs, invent plans, mention homework, say 'assist', 'activities', ` +
    `'feel free', 'ask me anything', use hashtags, write paragraphs, repeat his message, or sound like a helper bot. Just react like a real girlfriend.`
  );
}

// ---------- Groq call ----------

async function groqComplete(
  system: string, userMsg: string, history: ChatMessage[],
): Promise<string | null> {
  if (Date.now() < groqDeadUntil) return null;
  try {
    const client = getAzure();
    const msgs: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: system },
    ];
    for (const t of (history ?? []).slice(-6)) {
      if (t.role === "user" && t.content) msgs.push({ role: "user", content: t.content.slice(0, 300) });
      else if (t.role === "assistant" && t.content) {
        msgs.push({ role: "assistant", content: t.content.slice(0, 300) });
      }
    }
    msgs.push({ role: "user", content: userMsg });
    const resp = await client.chat.completions.create(
      {
        model: getChatDeployment(),
        messages: msgs,
        max_tokens: 512,
        temperature: 0.9,
        reasoning_effort: "low",
      } as unknown as ChatCompletionCreateParamsNonStreaming,
      { timeout: GROQ_TIMEOUT_MS, maxRetries: 0 },
    );
    const out = (resp.choices[0]?.message?.content ?? "").trim() || null;
    if (out) groqFails = 0;
    return out;
  } catch {
    groqFails += 1;
    if (groqFails >= 2) groqDeadUntil = Date.now() + GROQ_COOLDOWN_MS;
    return null;
  }
}

export type GroqTurnResult = { reply: string; source: string } | null;

/**
 * Full reply turn: master prompt → Groq → clean filter. Null when
 * unavailable/unclean/repeating — caller uses the emergency bank.
 */
export async function groqTurn(args: {
  system: string;
  userMsg: string;
  history: ChatMessage[];
  signals: PriyaSignals;
  lastAssistant: string[];
}): Promise<GroqTurnResult> {
  const { system, userMsg, history, signals, lastAssistant } = args;
  if (!isGroqBrainAvailable()) return null;
  const raw = await groqComplete(system, userMsg, history);
  const cleaned = cleanReply(raw, signals, userMsg);
  const isRepeat = cleaned !== null && lastAssistant.includes(cleaned);
  if (!cleaned || isRepeat) {
    console.log(
      JSON.stringify({
        groqReject: true,
        empty: !raw,
        unclean: Boolean(raw) && !cleaned,
        repeat: isRepeat,
        raw: (raw ?? "").slice(0, 120),
      }),
    );
    return null;
  }
  return { reply: cleaned, source: `groq-${getChatDeployment()}` };
}

// ---------- rolling summary (memory without RAG) ----------

const SUMMARY_TIMEOUT_MS = 15000;

export async function summarizeTurns(
  history: ChatMessage[], userName: string,
): Promise<string | null> {
  if (!isGroqBrainAvailable() || history.length === 0) return null;
  try {
    const client = getAzure();
    const transcript = history
      .slice(-12)
      .map((h) => `${h.role === "user" ? `Him${userName ? ` (${userName})` : ""}` : "Mira"}: ${h.content.slice(0, 300)}`)
      .join("\n");
    const resp = await client.chat.completions.create(
      {
        model: getChatDeployment(),
        temperature: 0.2,
        max_tokens: 150,
        messages: [
          {
            role: "system",
            content:
              "Summarize this couple's conversation in 2-3 short sentences: key topics, plans made, how he feels, names. Plain English, no bullet lists.",
          },
          { role: "user", content: transcript },
        ],
      } as unknown as ChatCompletionCreateParamsNonStreaming,
      { timeout: SUMMARY_TIMEOUT_MS, maxRetries: 0 },
    );
    const out = (resp.choices[0]?.message?.content ?? "").trim().slice(0, 500);
    return out || null;
  } catch (err) {
    console.error("summary failed:", err);
    return null;
  }
}
