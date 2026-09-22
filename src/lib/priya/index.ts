/**
 * Priya → Mira cascade. Mirrors backend/app.py chat() + reply_engine.py
 * generate_reply(), with the GPT stage re-targeted at Groq and the final
 * reply adapted to Mira's vibe + English-only policy.
 */

import type { Mood } from "@/lib/moods";
import type { Vibe } from "@/lib/vibes";
import { getMoodEngine, type PriyaMoodUpdate, type PriyaSignals } from "./mood-engine";
import { priyaRag, type RagHit } from "./rag-store";
import {
  templateCritical,
  templateReply,
  isGreeting,
  isSimpleQuestion,
  isExplicitRequest,
  detectTopic,
  type TemplateCtx,
} from "./reply-engine";
import { BOUNDARY_REPLIES } from "./reply-banks";
import { buildMiraSystemPrompt, groqReplyStage } from "./groq-reply";

export type PriyaChatResult = {
  reply: string;
  source: string;
  miraMood: Mood;
  confidence: number;
  cues: string[];
  priyaLabel: string;
  priyaScore: number;
  priyaEmoji: string;
  memories: RagHit[];
};

// ---------- Mira mapping ----------

const SIGNAL_LABELS: [keyof PriyaSignals, string][] = [
  ["cheating_confession", "cheating confession"],
  ["explicit_request", "boundary crossed"],
  ["stonewall", "short reply"],
  ["short_dry", "dry tone"],
  ["shouting", "shouting"],
  ["jealousy_topic", "jealousy"],
  ["repair", "repairing"],
  ["apology", "apologizing"],
  ["caring", "being cared for"],
  ["sweet_emoji", "sweet emoji"],
  ["wholesome_intimacy", "tender moment"],
  ["distress_acute", "acute distress"],
  ["distress", "feeling low"],
];

export function mapPriyaToMira(update: PriyaMoodUpdate): {
  mood: Mood;
  confidence: number;
  cues: string[];
} {
  const { label, delta, signals } = update;
  const cues = SIGNAL_LABELS.filter(([k]) => (signals as Record<string, unknown>)[k] === true)
    .map(([, labelText]) => labelText)
    .slice(0, 3);
  const fallbackCues = cues.length > 0 ? cues : ["steady tone"];
  const noHostility = signals.rude_hits.length === 0 && signals.conflict_hits.length === 0;

  // The badge shows the USER's mood (that's what Mira's UI has always meant).
  // Her internal score drifts gradually, but explicit distress must reflect
  // immediately — otherwise "crying" shows a happy badge.
  if (signals.distress_acute && noHostility) {
    return {
      mood: "sad",
      confidence: 0.9,
      cues: cues.length > 0 ? cues : ["crying", "needs comfort"],
    };
  }
  if (
    signals.distress &&
    noHostility &&
    (label === "happy" || label === "playful" || label === "neutral")
  ) {
    const distressCues =
      signals.distress_hits.length > 0
        ? [...signals.distress_hits.slice(0, 2), "needs comfort"].slice(0, 3)
        : ["feeling low", "needs comfort"];
    return { mood: "sad", confidence: 0.8, cues: distressCues };
  }

  switch (label) {
    case "romantic":
    case "happy":
    case "playful":
      return { mood: "happy", confidence: delta >= 2 ? 0.9 : 0.85, cues: fallbackCues };
    case "neutral":
      return { mood: "neutral", confidence: 0.6, cues: fallbackCues };
    case "annoyed":
      return { mood: "angry", confidence: 0.8, cues };
    case "upset":
      return { mood: "sad", confidence: 0.8, cues };
    case "angry":
      return { mood: "angry", confidence: 0.9, cues };
  }
}

// ---------- vibe transforms (light, voice-preserving) ----------

const WILD_OPENERS = ["Okay wait.", "Stoppp.", "No way.", "Okay okay.", "Listen.", "Ohh.", "Yooo."];

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function applyVibe(reply: string, vibe: Vibe, sessionId: string, turnCount: number): string {
  if (vibe === "straight") {
    // Direct, no fluff: first sentence only.
    const first = reply.split(/(?<=[.!?])\s+/)[0]?.trim() ?? reply;
    return first || reply;
  }
  if (vibe === "gentle") {
    // No caps shouting: soften fully-uppercase tokens, collapse bang runs.
    return reply
      .split(/(\s+)/)
      .map((tok) =>
        tok.length >= 2 && /^[A-Z!?.'"(),-]+$/.test(tok) && /[A-Z]/.test(tok)
          ? tok.toLowerCase()
          : tok,
      )
      .join("")
      .replace(/!{2,}/g, "!")
      .replace(/\?{2,}/g, "?");
  }
  if (vibe === "wild") {
    // Seeded ~60% opener prepend — reproducible per session+turn (eval-stable).
    const rng = mulberry32(hashSeed(`${sessionId}:${turnCount}`));
    if (rng() < 0.6) {
      const opener = WILD_OPENERS[Math.floor(rng() * WILD_OPENERS.length)];
      if (!reply.startsWith(opener)) return `${opener} ${reply}`;
    }
  }
  return reply;
}

// ---------- cascade ----------

export async function priyaChat(args: {
  sessionId: string;
  message: string;
  userName?: string;
  vibe?: Vibe;
  turnCount?: number;
}): Promise<PriyaChatResult> {
  const { sessionId } = args;
  let msg = (args.message ?? "").trim();
  if (msg.length > 500) msg = msg.slice(0, 500);
  const name = (args.userName ?? "").trim() || "babe";
  const vibe: Vibe = args.vibe ?? "sweet";
  const turnCount = args.turnCount ?? 1;

  // 1) RAG: retrieve top 5 — top 3 shown as memories, episodes nudge mood.
  const hits = priyaRag.retrieve(msg, 5, sessionId);
  const memories = hits.slice(0, 3);
  const epis = hits.filter((h) => h.kind === "episode");
  const bias =
    epis.length > 0
      ? Math.max(-2.0, Math.min(2.0, epis.reduce((s, h) => s + (h.delta ?? 0), 0) / epis.length))
      : 0;

  // 2) Mood update: present tone + past bias.
  const engine = getMoodEngine(sessionId);
  const mood = engine.update(msg, bias);
  const st = engine.state;
  const recents = Array.isArray(st.recent_replies) ? st.recent_replies : [];
  const prevTopic = st.last_topic || "";
  const history = priyaRag.recentTurns(6, sessionId);

  const ctx: TemplateCtx = {
    mood: mood.label,
    name,
    memories,
    signals: mood.signals,
    msg,
    lastReply: st.last_reply || "",
    recents,
    lastTopic: prevTopic,
    history,
  };

  // 3) Cascade: boundary → critical → fastpath → Groq → smart templates.
  let reply: string;
  let source: string;
  if (mood.signals.explicit_request || isExplicitRequest(msg)) {
    reply = BOUNDARY_REPLIES[Math.floor(Math.random() * BOUNDARY_REPLIES.length)];
    source = "boundary-template";
  } else {
    const critical = templateCritical(ctx);
    if (critical) {
      reply = critical;
      source = "template-critical";
    } else if (isSimpleQuestion(msg) || isGreeting(msg)) {
      reply = templateReply(ctx);
      source = "template-fastpath";
    } else {
      const system = buildMiraSystemPrompt(
        mood.label, name, memories, mood.signals, history, recents, vibe,
      );
      const groq = await groqReplyStage({
        system,
        userMsg: msg,
        history,
        signals: mood.signals,
        lastReply: st.last_reply || "",
        recents,
      });
      if (groq) {
        reply = groq.reply;
        source = groq.source;
      } else {
        reply = templateReply(ctx);
        source = "template-smart";
      }
    }
  }

  // 4) Vibe transform (post-hoc, light touch).
  reply = applyVibe(reply, vibe, sessionId, turnCount);

  // 5) Update engine memory + store episode.
  st.last_reply = reply;
  st.recent_replies = [...recents, reply].slice(-10);
  st.last_topic = detectTopic(msg) || prevTopic;
  priyaRag.addTurn(msg, reply, mood.label, mood.delta, { sessionId });

  const mapped = mapPriyaToMira(mood);
  return {
    reply,
    source,
    miraMood: mapped.mood,
    confidence: mapped.confidence,
    cues: mapped.cues,
    priyaLabel: mood.label,
    priyaScore: mood.score,
    priyaEmoji: mood.emoji,
    memories,
  };
}
