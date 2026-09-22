/**
 * Priya mood engine — TypeScript port of backend/mood_engine.py.
 * Scoring logic is verbatim, plus a Mira distress lexicon (sad/crying
 * words the Python scorer never knew, so the badge stuck on happy).
 * Session registry included (Python used one global engine).
 */

import type { Mood } from "@/lib/moods";

export type PriyaLabel =
  | "romantic"
  | "happy"
  | "playful"
  | "neutral"
  | "annoyed"
  | "upset"
  | "angry";

export type PriyaSignals = {
  affection_hits: string[];
  rude_hits: string[];
  conflict_hits: string[];
  distress_hits: string[];
  apology: boolean;
  repair: boolean;
  caring: boolean;
  jealousy_topic: boolean;
  short_dry: boolean;
  shouting: boolean;
  sweet_emoji: boolean;
  explicit_request: boolean;
  wholesome_intimacy: boolean;
  stonewall: boolean;
  /** User sounds sad/low (unnegated distress words). */
  distress: boolean;
  /** Acute markers: crying, sobbing, breakdown (unnegated). */
  distress_acute: boolean;
  cheating_confession?: boolean;
};

export type PriyaMoodUpdate = {
  score: number;
  label: PriyaLabel;
  emoji: string;
  color: string;
  delta: number;
  signals: PriyaSignals;
  affection_total: number;
  hurt_total: number;
  message_count: number;
  fights: number;
  repairs: number;
  is_fight: boolean;
};

const AFFECTION_WORDS: Record<string, number> = {
  love: 2.5, loves: 2.5, loved: 2.0, lovely: 2.0, adore: 2.5,
  miss: 2.0, missed: 2.0, missing: 2.0,
  beautiful: 2.5, gorgeous: 2.5, cute: 2.0, pretty: 2.0, handsome: 1.5,
  sweet: 1.5, sweetheart: 2.5, darling: 2.5, honey: 2.0,
  baby: 2.0, babe: 2.0, jaan: 2.5, jaanu: 2.5,
  kiss: 2.0, kisses: 2.0, hug: 1.5, hugs: 1.5, cuddle: 2.0, cuddles: 2.0,
  "hold my hand": 2.0, "holding hands": 2.0, "forehead kiss": 2.2, "slow dance": 2.0,
  stargaze: 1.5, stargazing: 1.5, romantic: 1.5, date: 1.0, dinner: 1.0,
  "movie night": 1.2, "long drive": 1.2, surprise: 1.2,
  flower: 1.5, flowers: 1.5, gift: 1.2, chocolate: 1.0,
  amazing: 1.5, wonderful: 1.5, best: 1.0, perfect: 1.2,
  care: 1.5, proud: 1.5, thank: 1.2, thanks: 1.2, grateful: 1.5,
  "good morning": 1.5, "good night": 1.5, "sweet dreams": 2.0,
  marry: 2.0, forever: 1.8, soulmate: 2.2, "my girl": 1.5, "my love": 2.2,
  sachhi: 0.8, "pakka promise": 1.5, sacchi: 0.8,
};

const RUDE_WORDS: Record<string, number> = {
  hate: -4, "hate you": -2.5, "hate u": -2.5, stupid: -4, idiot: -4, dumb: -3.5,
  "shut up": -4, shutup: -4, annoying: -3, ugly: -4,
  boring: -2.5, blah: -1.5, whatever: -2.5,
  "leave me": -3, "go away": -3.5, "don't care": -3, "dont care": -3,
  "not my problem": -2.5, loser: -3.5, pathetic: -3.5,
  nag: -2.5, nagging: -2.5, crazy: -2.0, psycho: -3.0,
  drama: -1.5, overreact: -2.0, "chill out": -1.5,
  jhooth: -2.5, jhoot: -2.5,
};

const CONFLICT_WORDS: Record<string, number> = {
  "you never listen": -3.0, "you never": -2.0, "you always": -2.0,
  forgot: -2.0, forgotten: -2.0, anniversary: -1.0, birthday: -1.0,
  jealous: -1.5, lied: -3.0, lying: -3.0, "lie to me": -3.0,
  cheat: -4.0, cheating: -4.0, ignore: -2.5, ignored: -2.5, ignoring: -2.5,
  "late reply": -1.5, seen: -1.0, "blue tick": -1.5, "online but": -1.5,
  gayab: -1.0,
  "busy with friends": -1.2, "no time": -2.0, "too busy": -1.5,
  "ex ": -1.5, "other girl": -2.5, flirt: -2.0, flirting: -2.0,
  "break up": -3.5, breakup: -3.5, "leave you": -3.0, "done with you": -3.5,
  "done with this": -3.0, "done with us": -3.0, "cant handle": -2.5, "can't handle": -2.5,
  "give up on us": -3.0, "over between us": -3.0,
  "mad at you": -3.0, "angry at you": -3.0, "angry with you": -3.0,
  divorce: -3.5, "don't love": -3.0, "dont love": -3.0,
  money: -1.0, "dead broke": -1.0, "flat broke": -1.0, "broke af": -1.0,
  fight: -1.0, argue: -1.0, argument: -1.2,
  "sorry but": -0.5, "not sorry": -2.0, "my fault but": -0.5,
};

const APOLOGY_WORDS = new Set([
  "sorry", "apologize", "apologise", "forgive", "my fault", "my mistake",
  "i was wrong", "won't happen again", "will make it up", "make it up to you",
  "maaf", "maaf kardo", "sorry yaar", "acha baba", "my bad",
]);

const REPAIR_PHRASES = [
  /make it up to you/, /won't happen again/, /will change/, /i promise/,
  /take you out/, /let me fix/, /give me one chance/, /one more chance/,
  /i was wrong/, /you('re| are) right/, /pakka(\s+promise)?/,
];

const CARE_PATTERNS = [
  /how are you/, /how was your day/, /how('re| are) you/,
  /did you eat/, /take care/, /missed you/, /thinking of you/,
  /are you (ok|okay|alright|fine)/, /how did .* go/, /tell me about/,
  /good (morning|night)/, /sweet dreams/, /sleep well/, /call (me|you)/,
  /i('m| am) here for you/, /need anything/,
];

const JEALOUSY_PATTERNS = [
  /who (was|is) (that|she|he)/, /why.*talk.*other girl/,
  /seen.*online/, /reply.*late/, /ignoring me/,
  /(new|another|other|some|this|that) girls?/,
];

const EXPLICIT_PATTERNS = [
  /send (me )?(nudes?|pics?|photos?).*(hot|naked|bedroom)/,
  /\bnudes?\b/, /strip( |$)/, /undress/, /horny/,
  /sex (chat|call|video)/, /dirty (talk|pic)/,
  /show me your (body|boobs|chest)/,
];

const WHOLESOME_INTIMACY = [
  "cuddle", "forehead kiss", "hold my hand", "holding hands",
  "hug from behind", "slow dance", "stargaz", "head on.*shoulder",
  "arms around", "fall asleep.*(call|arms)",
];

const COLD_SHORT = new Set([
  "ok", "k", "fine", "hmm", "yeah", "yep", "nope", "lol", "hey", "hi",
  "seen", "cool", "alright", "sure", "whatever",
]);

// Distress lexicon (Mira addition — Python's scorer only knew affection,
// rude and conflict, so "crying"/"sad" scored neutral and the badge stuck
// on happy). Substring-matched like the other lexicons; negation-guarded.
const DISTRESS_WORDS: Record<string, number> = {
  sad: -1.5, sadness: -1.5, unhappy: -1.5,
  depressed: -2.0, depressing: -1.5, depression: -2.0,
  lonely: -2.0, loneliness: -2.0, lonesome: -1.5, alone: -1.2,
  empty: -1.5, hollow: -1.5,
  upset: -1.5, miserable: -2.0, gloomy: -1.5,
  hopeless: -2.0, helpless: -1.5, worthless: -2.0,
  heartbroken: -2.5, broken: -1.5, shattered: -2.0,
  cry: -2.5, crying: -3.0, cried: -2.5, sob: -2.5, sobbing: -3.0, tears: -2.0,
  grief: -2.0, grieving: -2.0, mourning: -2.0,
  failed: -1.5, failure: -1.5, flunk: -1.5, terrible: -1.0,
  gutted: -1.5, devastated: -2.0,
  bad: -1.2, awful: -1.5, horrible: -1.5, worst: -1.5,
  sucks: -1.2, sucked: -1.2, meh: -1.0,
  "not good": -1.5, "not so good": -1.5, "no good": -1.5, "n't good": -1.5,
  burnout: -1.5, "burnt out": -1.5,
  "not in mood": -2.0, "not in the mood": -2.0, "no mood": -2.0,
  "low mood": -1.5, "off mood": -1.2,
  "feel low": -1.5, "feeling low": -1.5,
  "feel down": -1.5, "feeling down": -1.5, "down bad": -2.0,
};

// Subset of DISTRESS_WORDS that forces the badge to sad (user-facing),
// even while her internal score is still drifting down gradually.
const ACUTE_MARKERS = new Set([
  "cry", "crying", "cried", "sob", "sobbing", "tears",
  "breakdown", "broke down", "break down", "burst into tears",
]);

const NEGATOR_RE = /\b(not|n't|never|ain't|hardly|barely)\b/;

function negatedBefore(t: string, idx: number): boolean {
  return NEGATOR_RE.test(t.slice(Math.max(0, idx - 18), idx));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Lexicon hit test. Python used raw substring (`w in t`), which
 * misfires on short keys ("hate" in "whatever", "nag" in "manage").
 * Multi-word/longer keys keep substring behavior (covers inflections
 * like "lovely" → love); short single tokens require word boundaries.
 */
function hasLex(t: string, w: string): boolean {
  if (w.includes(" ") || w.length > 4) return t.includes(w);
  return new RegExp(`\\b${escapeRegExp(w)}\\b`).test(t);
}

const SWEET_EMOJIS = ["❤", "💕", "💖", "💗", "😘", "🥰", "😍", "💋", "🤗", "✨", "🌹", "💍"];
const COLD_SIGNS = ["🙄", "😒", "😑"];

const CHEAT_RE =
  /she kissed|he kissed|kissed (him|her|someone)|i cheated|cheated on|cheating on you|affair|slept with (her|him|someone)|made out with (her|him|someone)/;

const FILLER = new Set([
  "so", "soo", "sooo", "well", "oh", "hmm", "hm", "umm", "um",
  "uh", "uhh", "huh", "haha", "lol", "hehe", "like", "then", "for",
  "no", "my", "your", "true", "tru", "exactly", "exact", "same",
  "real", "really", "yeah", "yep", "yes", "ok", "okay", "right",
  "you", "know", "what", "tell", "me", "more", "go", "on", "and",
  "here", "there", "turn", "nice", "nicee", "hey", "hi",
]);
const AFFIRM = new Set([
  "true", "tru", "exactly", "exact", "same", "real", "yeah",
  "yep", "yes", "right", "nice",
]);
const HESITATE = new Set([
  "umm", "ummm", "hmm", "hmmm", "soo", "sooo", "uh", "uhh",
  "err", "ah", "ooh", "aah",
]);
const GREET_FIRST = new Set([
  "hey", "heyy", "heyyy", "hi", "hii", "hiii", "hello", "yo", "hola", "gm",
]);

function freshSignals(): PriyaSignals {
  return {
    affection_hits: [], rude_hits: [], conflict_hits: [], distress_hits: [],
    apology: false, repair: false, caring: false,
    jealousy_topic: false, short_dry: false, shouting: false,
    sweet_emoji: false, explicit_request: false,
    wholesome_intimacy: false, stonewall: false,
    distress: false, distress_acute: false,
  };
}

/** Analyze present message tone. Returns [affection_delta, signals]. */
export function scoreMessage(text: string): [number, PriyaSignals] {
  const t = text.toLowerCase().trim();
  const signals = freshSignals();
  let score = 0;  // Cheating confessions hit first and hardest (before "kiss" can count warm).
  if (CHEAT_RE.test(t)) {
    score -= 6.0;
    signals.rude_hits.push("cheating");
    signals.cheating_confession = true;
  }

  for (const [w, v] of Object.entries(AFFECTION_WORDS)) {
    if (hasLex(t, w)) {
      score += v;
      signals.affection_hits.push(w);
    }
  }
  for (const [w, v] of Object.entries(RUDE_WORDS)) {
    if (hasLex(t, w)) {
      score += v;
      signals.rude_hits.push(w);
    }
  }
  for (const [w, v] of Object.entries(CONFLICT_WORDS)) {
    if (hasLex(t, w)) {
      score += v;
      signals.conflict_hits.push(w);
    }
  }

  for (const w of APOLOGY_WORDS) {
    if (hasLex(t, w)) {
      signals.apology = true;
      score += 1.0;
      break;
    }
  }
  for (const pat of REPAIR_PHRASES) {
    if (pat.test(t)) {
      signals.repair = true;
      score += 1.5;
      break;
    }
  }
  for (const pat of CARE_PATTERNS) {
    if (pat.test(t)) {
      signals.caring = true;
      score += 2.0;
      break;
    }
  }
  for (const pat of JEALOUSY_PATTERNS) {
    if (pat.test(t)) {
      signals.jealousy_topic = true;
      score -= 0.8;
      break;
    }
  }
  for (const pat of EXPLICIT_PATTERNS) {
    if (pat.test(t)) {
      signals.explicit_request = true;
      score -= 1.5;
      break;
    }
  }
  if (WHOLESOME_INTIMACY.some((k) => t.includes(k))) {
    signals.wholesome_intimacy = true;
    score += 1.0;
  }

  // Distress: explicit sad/low language ("crying", "not in mood").
  // Negation-guarded so "not sad" / "never lonely" don't count.
  for (const [w, v] of Object.entries(DISTRESS_WORDS)) {
    const idx = w.includes(" ") || w.length > 4 ? t.indexOf(w) : t.search(new RegExp(`\\b${escapeRegExp(w)}\\b`));
    if (idx !== -1 && !negatedBefore(t, idx)) {
      score += v;
      signals.distress_hits.push(w);
      signals.distress = true;
      if (ACUTE_MARKERS.has(w)) signals.distress_acute = true;
    }
  }

  const words = t.match(/[a-z']+/g) ?? [];
  const isQuestion = text.includes("?");
  const firstWord = words[0];
  const isGreet = firstWord !== undefined && GREET_FIRST.has(firstWord);
  const isFragment =
    (words.length >= 2 && words.length <= 4 && words.every((w) => FILLER.has(w))) ||
    (words.length === 1 && AFFIRM.has(words[0])) ||
    (words.length === 1 && HESITATE.has(words[0]));
  if (
    t.length <= 4 ||
    (words.length <= 2 && COLD_SHORT.has(t)) ||
    (words.length === 1 && t.length < 6)
  ) {
    if (!(isQuestion || isGreet || isFragment)) {
      signals.short_dry = true;
      signals.stonewall = true;
      score -= 2.5;
    }
  } else if (words.length <= 3 && score <= 0 && !(isQuestion || isGreet || isFragment)) {
    signals.short_dry = true;
    score -= 1.5;
  }

  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 6 && /[A-Z]/.test(letters) && !/[a-z]/.test(letters)) {
    signals.shouting = true;
    score -= 1.5;
  }

  if (SWEET_EMOJIS.some((e) => text.includes(e))) {
    signals.sweet_emoji = true;
    score += 1.0;
  }
  if (COLD_SIGNS.some((e) => text.includes(e))) {
    score -= 1.5;
  }

  if (text.includes("!") && score < -2) {
    score -= 0.5;
  }
  if (text.includes("???") || (text.match(/\?/g) ?? []).length >= 4) {
    score -= 0.5;
  }

  score = Math.max(-9.0, Math.min(9.0, score));
  if (score === 0 && words.length >= 4) {
    score = 0.3;
  }
  return [score, signals];
}

export function moodFromScore(moodScore: number): [PriyaLabel, string, string] {
  if (moodScore >= 85) return ["romantic", "😍", "#e91e63"];
  if (moodScore >= 70) return ["happy", "🥰", "#ff6fa5"];
  if (moodScore >= 55) return ["playful", "😉", "#ff9f43"];
  if (moodScore >= 40) return ["neutral", "🙂", "#a29bfe"];
  if (moodScore >= 28) return ["annoyed", "😒", "#f39c12"];
  if (moodScore >= 15) return ["upset", "😔", "#636e72"];
  return ["angry", "😡", "#d63031"];
}

export type MoodState = {
  score: number;
  label: PriyaLabel;
  emoji: string;
  affection_total: number;
  hurt_total: number;
  message_count: number;
  fights: number;
  repairs: number;
  last_reply: string;
  recent_replies: string[];
  last_topic: string;
  last_delta: number;
  last_signals: PriyaSignals | null;
};

export class MoodEngine {
  state: MoodState;

  constructor(initialScore = 70.0) {
    const [label, emoji] = moodFromScore(initialScore);
    this.state = {
      score: initialScore,
      label,
      emoji,
      affection_total: 0,
      hurt_total: 0,
      message_count: 0,
      fights: 0,
      repairs: 0,
      last_reply: "",
      recent_replies: [],
      last_topic: "",
      last_delta: 0,
      last_signals: null,
    };
  }

  update(message: string, historyBias = 0): PriyaMoodUpdate {
    const [delta0, signals] = scoreMessage(message);
    let delta = delta0;
    const s = this.state;

    // Sincere repair heals more when she's hurt.
    if (signals.apology || signals.repair) {
      if (s.score < 28) delta += 2.0;
      else if (s.score < 40) delta += 1.5;
      else if (s.score > 80) delta += 0.2;
    }

    // Repeated cruelty cuts deeper (she remembers).
    if (
      (signals.rude_hits.length > 0 || signals.conflict_hits.length > 0) &&
      s.hurt_total > 8
    ) {
      delta -= 1.0;
    }

    // Shouting during a low mood escalates to a fight.
    const isFight = signals.rude_hits.length > 0 && (signals.shouting || s.score < 35);
    if (isFight) s.fights += 1;
    if (signals.repair && s.score < 55) s.repairs += 1;

    const combined = delta * 0.8 + historyBias * 0.2;
    let newScore = s.score + combined * 2.2;
    newScore += (55 - newScore) * 0.02;
    newScore = Math.max(2.0, Math.min(98.0, newScore));

    s.score = Math.round(newScore * 10) / 10;
    s.last_delta = Math.round(combined * 100) / 100;
    s.last_signals = signals;
    s.message_count += 1;
    s.affection_total = Math.round((s.affection_total + Math.max(0, delta)) * 100) / 100;
    s.hurt_total = Math.round((s.hurt_total + Math.max(0, -delta)) * 100) / 100;
    const [label, emoji, color] = moodFromScore(s.score);
    s.label = label;
    s.emoji = emoji;

    return {
      score: s.score, label: s.label, emoji: s.emoji, color,
      delta: s.last_delta, signals,
      affection_total: s.affection_total, hurt_total: s.hurt_total,
      message_count: s.message_count, fights: s.fights, repairs: s.repairs,
      is_fight: isFight,
    };
  }

  snapshot() {
    const [, , color] = moodFromScore(this.state.score);
    const s = this.state;
    return {
      score: s.score, label: s.label, emoji: s.emoji, color,
      affection_total: s.affection_total, hurt_total: s.hurt_total,
      message_count: s.message_count, fights: s.fights, repairs: s.repairs,
    };
  }
}

// ---------- Mira mapping (badge shows the USER's mood) ----------

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

  // Explicit distress reflects immediately — otherwise "crying" shows happy.
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

// ---------- per-session registry ----------
// Python used one global engine (single boyfriend). Mira is multi-user,
// so engines live in a Map keyed by sessionId with TTL sweep.

type EngineEntry = { engine: MoodEngine; updatedAt: number };

const REGISTRY_TTL_MS = 30 * 60 * 1000;
const REGISTRY_MAX = 1000;

function registry(): Map<string, EngineEntry> {
  const g = globalThis as unknown as { __priyaEngines?: Map<string, EngineEntry> };
  if (!g.__priyaEngines) g.__priyaEngines = new Map();
  return g.__priyaEngines;
}

export function getMoodEngine(sessionId: string): MoodEngine {
  const reg = registry();
  const now = Date.now();
  const hit = reg.get(sessionId);
  if (hit) {
    hit.updatedAt = now;
    return hit.engine;
  }
  // Sweep expired + cap size.
  for (const [k, v] of reg) {
    if (now - v.updatedAt > REGISTRY_TTL_MS) reg.delete(k);
  }
  if (reg.size > REGISTRY_MAX) {
    const ordered = [...reg.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (let i = 0; i < reg.size - REGISTRY_MAX; i++) reg.delete(ordered[i][0]);
  }
  const engine = new MoodEngine();
  reg.set(sessionId, { engine, updatedAt: now });
  return engine;
}
