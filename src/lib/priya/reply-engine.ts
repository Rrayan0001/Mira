/**
 * Priya reply engine — TypeScript port of backend/reply_engine.py
 * (template path only: template_critical + template_reply + helpers).
 * Regexes and ordering are verbatim; Python `re.search` → RegExp.test,
 * `re.fullmatch` → anchored ^…$, `random.choice` → Math.random.
 */

import {
  REPLIES, GREETINGS, REPAIR_SOFTENERS, JEALOUSY_REPLIES, ACCUSED_REPLIES,
  STONEWALL_REPLIES, STONEWALL_MILD, INTIMATE_WHOLESOME, BOUNDARY_REPLIES,
  RUDE_SHOUT, RUDE_CALM, CONFUSED, PLANS_REPLIES, DOING_REPLIES, BUSY_REPLIES,
  NIGHT_REPLIES, MORNING_REPLIES, CELEBRATE_REPLIES, SHE_ASKED_REPLIES,
  BREAKUP_REPLIES, TEASE_MONEY_REPLIES, SMARTASS_REPLIES, DEFIANT_REPLIES,
  DRY_MILD, ACK_REPLIES, IDENTITY_REPLIES, SELF_REPLIES, DATE_YES_REPLIES,
  JEALOUS_EX_REPLIES, FURIOUS_CHEAT_REPLIES, GUESS_REPLIES, KNOCK_REPLIES,
  JULIET_REPLIES, QUEEN_REPLIES, WHEN_REPLIES, TELLME_REPLIES, FUTURE_REPLIES,
  DREAM_REPLIES, LOVE_YOU_REPLIES, OPINION_YES_REPLIES, HURT_REPLIES,
  MAD_REPLIES, SIKE_RELIEF, MISSED_EVENT_REPLIES, DOING_ME_REPLIES,
  WHERE_LIVE_REPLIES, WORK_STUDY_REPLIES, JOKE_REPLIES, FAVORITE_REPLIES,
  FAV_SONG_REPLIES, LIKE_YES_REPLIES, BORED_REPLIES, SHORT_FRAG,
  QUESTION_FOLLOWUP, ECHO_FRAMES_WARM, ECHO_FRAMES_COLD, STORY_ENGAGED,
  MISS_REPLIES, COMFORT_REPLIES, CALL_REPLIES, FOOD_REPLIES, TOPIC_STARTERS,
  NICKNAMES, HARD_DRY, FIGHT_DEESCALATE, FALLBACK_NICK,
  type PriyaMood,
} from "./reply-banks";
import { SORE_NICKS, STOPWORDS, STORY_OPENERS, STORY_VERBS } from "./constants";
import type { PriyaSignals } from "./mood-engine";
import type { RagHit, TurnRecord } from "./rag-store";

export type { PriyaMood };

const SORE_SET = new Set(SORE_NICKS);
const STOP_SET = new Set(STOPWORDS);
const HARD_DRY_SET = new Set(HARD_DRY);

function pick<T>(bank: T[]): T {
  return bank[Math.floor(Math.random() * bank.length)];
}

export function pickUnique(bank: string[], lastReply: string, recents: string[] = []): string {
  const seen = new Set([...recents, ...(lastReply ? [lastReply] : [])]);
  let choice = pick(bank);
  for (let i = 0; i < 8; i++) {
    if (!seen.has(choice) || bank.length <= seen.size) break;
    choice = pick(bank);
  }
  return choice;
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function fillPlaceholders(
  text: string,
  vars: { nick?: string; nick_cap?: string; name?: string; snip?: string },
): string {
  let out = text;
  if (vars.nick_cap !== undefined) out = out.split("{nick_cap}").join(vars.nick_cap);
  if (vars.nick !== undefined) out = out.split("{nick}").join(vars.nick);
  if (vars.name !== undefined) out = out.split("{name}").join(vars.name);
  if (vars.snip !== undefined) out = out.split("{snip}").join(vars.snip);
  return out;
}

// ---------------- memory nicknames ----------------

export function memoryNickOrNone(
  memories: RagHit[] | null | undefined,
  mood: string = "neutral",
): string | null {
  for (const m of memories ?? []) {
    const t = (m.text ?? "").toLowerCase();
    for (const [key, nick] of NICKNAMES) {
      if (t.includes(key)) {
        if ((mood === "romantic" || mood === "happy" || mood === "playful") && SORE_SET.has(nick)) {
          continue;
        }
        return nick;
      }
    }
  }
  return null;
}

export function nickname(memories: RagHit[] | null | undefined, mood: string = "neutral"): string {
  const found = memoryNickOrNone(memories, mood);
  if (found) return found;
  if (mood === "romantic" || mood === "happy" || mood === "playful") {
    return "our rainy first date";
  }
  return FALLBACK_NICK;
}

// ---------------- greetings / stories ----------------

const GREETING_RE =
  /^(hey+y*|hi+i*|hello+|yo|hola)\b[\s,!.~]*(babe|baby|bae|jaan|jaanu|beautiful|darling|love|cutie)?[\s,!.?~❤️💖🥺]*$/i;

export function isGreeting(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length > 30) return false;
  if (GREETING_RE.test(t)) return true;
  const words = t.match(/[a-z]+/g) ?? [];
  const first = words[0];
  if (
    first !== undefined &&
    ["hey", "heyy", "heyyy", "hi", "hii", "hiii", "hello", "yo"].includes(first) &&
    words.length <= 5
  ) {
    return true;
  }
  return false;
}

export function isStory(text: string): boolean {
  const t = (text ?? "").toLowerCase().trim();
  if (!t || t.includes("?") || isGreeting(text)) return false;
  const words: string[] = t.match(/[a-z']+/g) ?? [];
  if (words.length <= 4) return false;
  if (STORY_OPENERS.some((op) => t.includes(op))) return true;
  if (words.length >= 10 && STORY_VERBS.filter((v) => words.includes(v)).length >= 2) return true;
  return false;
}

// ---------------- relevance helpers ----------------

function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of (text ?? "").toLowerCase().match(/[a-z']+/g) ?? []) {
    if (!STOP_SET.has(w) && w.length > 2) out.add(w);
  }
  return out;
}

function relevanceScore(candidate: string, msg: string, history: TurnRecord[] = []): number {
  const cWords = contentWords(candidate);
  const mWords = contentWords(msg);
  let score = 0;
  if (mWords.size > 0 && cWords.size > 0) {
    let overlap = 0;
    for (const w of mWords) if (cWords.has(w)) overlap++;
    score += overlap * 2.0;
  }
  if ((msg ?? "").includes("?") && (candidate ?? "").includes("?")) score += 0.5;
  if (history.length > 0) {
    const histText = history.slice(-3).map((t) => `${t.bf} ${t.gf}`).join(" ").toLowerCase();
    const hWords = contentWords(histText);
    if (hWords.size > 0 && cWords.size > 0) {
      let overlap = 0;
      for (const w of hWords) if (cWords.has(w)) overlap++;
      score += overlap * 0.5;
    }
  }
  if (score === 0 && mWords.size >= 2) score -= 0.5;
  return score + Math.random() * 0.1;
}

export function pickBest(
  candidates: string[], msg: string,
  lastReply = "", recents: string[] = [], history: TurnRecord[] = [],
): string {
  const seen = new Set([...recents, ...(lastReply ? [lastReply] : [])]);
  const fresh = candidates.filter((c) => !seen.has(c));
  const pool = fresh.length > 0 ? fresh : candidates;
  const scored = pool.map((c) => [relevanceScore(c, msg, history), c] as [number, string]);
  scored.sort((a, b) => b[0] - a[0]);
  const top = scored[0];
  if (!top) return candidates[0] ?? "";
  return top[1];
}

const SNIPPET_SKIP = new Set([
  ...STOPWORDS,
  "let", "tell", "told", "say", "said", "happened", "happen",
  "today", "yesterday", "tomorrow", "day", "time", "thing", "things",
  "really", "just", "quite", "much", "many", "some", "there", "here",
  "then", "than", "also", "even", "still", "back", "every",
  "hmm", "hm", "ok", "k", "know", "uhh", "uhm", "well", "like",
  "real", "true", "tru", "exactly", "exact", "same", "turn",
  // discourse + negation openers are never the topic ("no, what's your idea")
  "no", "not", "nor",
  // texting pronouns + contraction fragments ("u", "don't" → don/t)
  "u", "ur", "re", "ve", "ll",
  "don", "can", "won", "isn", "aren", "wasn", "weren", "didn", "doesn",
  "couldn", "shouldn", "wouldn", "hasn", "haven", "hadn",
  "im", "ive", "ill", "id", "whats", "wheres", "whos", "hows", "thats", "theres",
]);

export function snippet(msg: string, maxWords = 4): string {
  // Split contractions too ("what's" → what + s) and drop letter fragments —
  // single letters like "u"/"s" are never topics ("u think night").
  const words = ((msg ?? "").toLowerCase().match(/[a-z]+/g) ?? []).filter(
    (w) => w.length >= 2 && !SNIPPET_SKIP.has(w),
  );
  if (words.length === 0) return "that";
  return words.slice(0, maxWords).join(" ");
}

export function detectTopic(msg: string): string {
  const low = (msg ?? "").toLowerCase();
  if (/\bdate\b|dinner|movie|meet\b|trip|plan|go out|when.*go|where.*go/.test(low)) return "date";
  if (/sorry|forgive|maaf|apolog/.test(low)) return "repair";
  if (/fight|argue|shout|angry|hate|breakup|break up|shut up|stupid|idiot/.test(low)) return "fight";
  if (/\blove\b|miss|kiss|hug|cuddle|cute|beautiful/.test(low)) return "love";
  if (/exam|interview|work|tired|sad|sick|stress|day/.test(low)) return "life";
  return "";
}

export function isExplicitRequest(text: string): boolean {
  const t = (text ?? "").toLowerCase();
  return /\bnudes?\b|strip|undress|horny|sex (chat|call|video)|dirty (talk|pic)|show me your (body|boobs|chest)|send.*(naked|bedroom)/.test(t);
}

export function isSimpleQuestion(text: string): boolean {
  const low = (text ?? "").toLowerCase().trim();
  if (low.length > 60) return false;
  return /plan.*(today|tonight|tomorrow|weekend)|what.*(ur|your|you'?re?) plans?|\bwyd\b|what('re| are) (you|u) doing|where are you|you there|u there|\bgood\s*(night|morning)\b|\bi miss (you|u)\b|call (me|na)|did (you|u) eat|had (lunch|dinner)|tell me a joke|make me laugh|favorite|favourite|do you like|\bbored\b|go for a (walk|drive|coffee|chai)|come over|lets meet|what do (you|u) do|where do you live|do you (work|study)|promoted|failed|went bad|new job/.test(low);
}

// ---------------- scenario + clip ----------------

function pickScenario(
  signals: PriyaSignals, lastReply = "", recents: string[] = [],
): string | null {
  if (signals.explicit_request) return pick(BOUNDARY_REPLIES);
  if (signals.stonewall) return pickUnique(STONEWALL_REPLIES, lastReply, recents);
  if (signals.jealousy_topic) return pickUnique(JEALOUSY_REPLIES, lastReply, recents);
  if (signals.wholesome_intimacy) return pickUnique(INTIMATE_WHOLESOME, lastReply, recents);
  if (signals.repair || signals.apology) return pickUnique(REPAIR_SOFTENERS, lastReply, recents);
  return null;
}

export function clip(text: string, maxWords = 30): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  const cut = words.slice(0, maxWords).join(" ");
  const ends: number[] = [];
  const re = /[.!?…](?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cut)) !== null) ends.push(m.index + m[0].length);
  const use = ends.filter((e) => e > cut.length / 2);
  if (use.length > 0) return cut.slice(0, use[use.length - 1]).trim();
  return cut.replace(/[.,!?]+$/, "") + "…";
}

// ---------------- template_critical ----------------

export type TemplateCtx = {
  mood: PriyaMood;
  name: string;
  memories: RagHit[];
  signals: PriyaSignals;
  msg: string;
  lastReply: string;
  recents: string[];
  lastTopic: string;
  history: TurnRecord[];
};

export function templateCritical(ctx: TemplateCtx): string | null {
  const { mood, name, signals, msg, lastReply, recents, lastTopic } = ctx;
  if (signals.cheating_confession) {
    return pickUnique(FURIOUS_CHEAT_REPLIES, lastReply, recents);
  }
  if (!msg) return null;
  const low = msg.toLowerCase().trim();

  if (/\bhate (you|u)\b/.test(low)) {
    return pickUnique(HURT_REPLIES, lastReply, recents);
  }
  if (/\bsike\b|\bsikke\b|\bjk\b|just kidding|just joking|sike na|mazak/.test(low)) {
    return pickUnique(SIKE_RELIEF, lastReply, recents);
  }
  if (signals.rude_hits.length > 0) {
    const bank = signals.shouting ? RUDE_SHOUT : RUDE_CALM;
    return pickUnique(bank, lastReply, recents);
  }
  if (signals.repair || signals.apology) {
    return pickUnique(REPAIR_SOFTENERS, lastReply, recents);
  }
  if (/\bmy ex\b|ex-boyfriend|ex boyfriend|saw my ex|miss my ex|my ex (texted|called|came|met)|met my ex|new girls?|another girls?|other girls?|this girl|some girl|that girl|got a girl/.test(low)) {
    return pickUnique(JEALOUS_EX_REPLIES, lastReply, recents);
  }
  if (/\bromeo\b/.test(low)) return pickUnique(JULIET_REPLIES, lastReply, recents);
  if (/\bking\b/.test(low)) return pickUnique(QUEEN_REPLIES, lastReply, recents);
  if (/go (for|on) a date|date (tomorrow|tonight|friday|saturday|sunday|night)|take you out|dinner date|movie date|wanna go.*date|go out (tonight|tomorrow|friday|saturday|sunday)|go for a (walk|drive|coffee|chai|movie|dinner)|go on a (walk|drive)|let'?s (go out|meet|go for)|let us (meet|go)|wanna meet|come over|meet (tomorrow|tonight|today|this weekend|on sunday)/.test(low)) {
    if (mood !== "angry") return pickUnique(DATE_YES_REPLIES, lastReply, recents);
  }
  if (/^\s*knock knock[.!?]*\s*$/i.test(msg)) {
    return pickUnique(KNOCK_REPLIES, lastReply, recents);
  }
  if (/who am i\b|whoami|do you know me|my name|whose (boyfriend|bf) am i/.test(low)) {
    return fillPlaceholders(pickUnique(IDENTITY_REPLIES, lastReply, recents), { name: name || "babe" });
  }
  if (/tell me about yourself|who are you|who are u\b|who r u|about yourself|ur name|your name|how old are you|your age|who u are/.test(low)) {
    return pickUnique(SELF_REPLIES, lastReply, recents);
  }
  if (/^tell me[.!?]*$/.test(low)) {
    return pickUnique(TELLME_REPLIES, lastReply, recents);
  }
  if (/guess wha?t\b|guess who\b/.test(low)) {
    return pickUnique(GUESS_REPLIES, lastReply, recents);
  }
  if (/^\s*(when|where|what time)\??\s*$/i.test(msg)) {
    if (lastTopic === "date") {
      return pickUnique(
        ["whenever you want 😌 you pick the day?", "you tell me when 🥺 I'm free for you"],
        lastReply, recents,
      );
    }
    return pickUnique(WHEN_REPLIES, lastReply, recents);
  }
  return null;
}

// ---------------- template_reply ----------------

export function templateReply(ctx: TemplateCtx): string {
  const { mood, name, memories, signals, lastReply, recents, lastTopic, history } = ctx;
  const msg = ctx.msg ?? "";
  const nick = nickname(memories, mood);

  if (signals.explicit_request) return pick(BOUNDARY_REPLIES);

  const hit = templateCritical(ctx);
  if (hit) return hit;

  if (msg && isGreeting(msg)) {
    const bank =
      mood === "annoyed" || mood === "upset" || mood === "angry"
        ? GREETINGS.cold : GREETINGS.warm;
    return pickUnique(bank, lastReply, recents);
  }

  if (msg) {
    const low = msg.toLowerCase().trim();

    if (/break\s?up|breakup|let'?s end|khatam|end this|i don'?t love you|dont love you|don'?t like you|go to hell|hate you|ca ?n'?t handle (you|this|us)|done with (you|this|us)|give up on us|over between us|end of us|leaving you/.test(low)) {
      return pickUnique(BREAKUP_REPLIES, lastReply, recents);
    }
    if (/on your face|say it again|what (will|would|can) you do|try me|whatever you say/.test(low)) {
      const bank =
        mood === "annoyed" || mood === "upset" || mood === "angry" || mood === "neutral"
          ? DEFIANT_REPLIES : RUDE_CALM;
      return pickUnique(bank, lastReply, recents);
    }
    if (/\bmad at (you|u)\b|\bangry at (you|u)\b|\bangry with (you|u)\b|naraz (ho|hun|hu)\b/.test(low)) {
      return pickUnique(MAD_REPLIES, lastReply, recents);
    }
    if (/\bmoney\b|send me.*(money|cash|rs|₹)|broke(?! down)|no money|paisa|pocket money|loan/.test(low)) {
      if (mood !== "angry" && mood !== "upset") {
        return pickUnique(TEASE_MONEY_REPLIES, lastReply, recents);
      }
    }
    if (/\d+\s*[+\-*/×÷]\s*\d+|what('s| is) (1\s*\+\s*1|the (capital|meaning|time))|who is .*president|solve this/.test(low)) {
      return pickUnique(SMARTASS_REPLIES, lastReply, recents);
    }
    if (/how (was|is) (your|ur|u'?r) (day|exam|interview|health|mood|presentation)|how are you|how('re|r) (you|u)\b|how did .*go|tell me about your day/.test(low)) {
      if (mood !== "angry") return pickUnique(SHE_ASKED_REPLIES, lastReply, recents);
    }

    const single = low.match(/^[a-z]{1,6}[.!?]?$/);
    if (single && low.split(/\s+/).length === 1) {
      const bare = low.replace(/[.?!]+$/, "");
      if (!["wassup", "whatsup", "sup", "wud", "wyd"].includes(bare)) {
        if (["true", "tru", "exactly", "exact", "same", "real", "really"].includes(bare)) {
          return pickUnique(ACK_REPLIES, lastReply, recents);
        }
        if (["umm", "ummm", "hmm", "hmmm", "soo", "sooo", "uh", "uhh", "err"].includes(bare)) {
          return pickUnique(SHORT_FRAG, lastReply, recents);
        }
        if (HARD_DRY_SET.has(bare)) {
          if (mood === "romantic" || mood === "happy") {
            return pickUnique(STONEWALL_MILD, lastReply, recents);
          }
          return pickUnique(STONEWALL_REPLIES, lastReply, recents);
        }
        return pickUnique(DRY_MILD, lastReply, recents);
      }
    }
    if (msg.includes("??") && msg.trim().length <= 20) {
      return pickUnique(CONFUSED, lastReply, recents);
    }
    if (/seen|gayab|blue tick|late repl|reply.*(late|der se)|online.*(ignor|but|at \d)|left me|phone.*(dinner|table)/.test(low)) {
      return pickUnique(ACCUSED_REPLIES, lastReply, recents);
    }
    if (/weren'?t at|werent at|didn'?t come|didnt come|weren'?t there|not at my|missed my (party|birthday|match|game|show|function)|didn'?t show up/.test(low)) {
      return pickUnique(MISSED_EVENT_REPLIES, lastReply, recents);
    }
    if (/\bnot a story\b|\blisten\b|lemme explain|let me explain|no wait\b/.test(low) && !isStory(msg)) {
      return pickUnique(QUESTION_FOLLOWUP, lastReply, recents);
    }
    if (/^\s*my day\s*[.!?~]*$/.test(low)) {
      return pickUnique(
        ["how was your day? tell me everything 🥺",
         "your day?? tell me all about it 🥺❤️",
         "aww, how did your day go? 👀"],
        lastReply, recents,
      );
    }
    if (/^\s*no way\s*[.!?~]*$/.test(low)) {
      return pickUnique(GUESS_REPLIES, lastReply, recents);
    }
    if (/^\s*(exactly|for real|oh really|you know what|so yeah|like what|then what|well yeah|same here|haha nice)\s*[.!?~]*$/.test(low)) {
      return pickUnique(SHORT_FRAG, lastReply, recents);
    }
    if (/\bgood\s*night\b|\bgn\b|goodnight/.test(low)) {
      if (mood !== "angry") return pickUnique(NIGHT_REPLIES, lastReply, recents);
    }
    if (/\bgood\s*morning\b|goodmorning|\bgm\b|\bmg\b/.test(low)) {
      if (mood !== "angry" && mood !== "upset") {
        return pickUnique(MORNING_REPLIES, lastReply, recents);
      }
    }
    if (/\bi miss (you|u)\b|missed you|missing you/.test(low)) {
      if (mood !== "angry") return pickUnique(MISS_REPLIES, lastReply, recents);
    }
    if (/\bcall (me|na|kar|karo)\b|pick up|video call|call pe aao|phone karo/.test(low)) {
      if (mood !== "angry" && mood !== "upset") {
        return pickUnique(CALL_REPLIES, lastReply, recents);
      }
    }
    if (/did (you|u) eat|had (lunch|dinner|breakfast|your)|khana|\bkha|eat something|(lunch|dinner) (done|kar|kiya|ho gaya)/.test(low)) {
      if (mood !== "angry" && mood !== "upset") {
        return pickUnique(FOOD_REPLIES, lastReply, recents);
      }
    }
    if (/\b(tired|tiring|exhausted|exhausting|stressed|stressful|hectic|tension|sad|depressed|headache|fever|crying|bad day|worst day|tough day|long day|can't sleep|neend|nervous|scared|fear|darr)\b|rula|cried|crying|sob|tears|\bcry\b|bakwas|dhokha|\bugly\b|tired of|rona\b|periods?|dard|\bpain\b|wish me luck|overthinking|not in (the )?mood|no mood|low mood|feel(ing)? (low|down)|went (really |so )?bad|failed|failure|flunked|flunk|backlog|atkt|suppli/.test(low)) {
      if (mood !== "angry") return pickUnique(COMFORT_REPLIES, lastReply, recents);
    }
    if (/promotion|promoted|good news|achha gaya|acha gaya|accha gaya|selected|pass ho|\bwon\b|jeet|mil gayi?!|kamaal|congrat|party .*(mila|hua)|increment|hike|appraisal|new job|offer letter/.test(low)) {
      if (mood !== "angry" && mood !== "upset") {
        return pickUnique(CELEBRATE_REPLIES, lastReply, recents);
      }
    }
    if (/\b(busy|work|meeting|office|study|exam)\b/.test(low) &&
        /\b(have|got|have to|need to|busy|tomorrow|today|late|kal)\b/.test(low)) {
      if (mood !== "angry" && mood !== "upset" && !isStory(msg) &&
          !/\b(bad|worst|terrible|failed|fail|flunk|sad|cry|tough|guilt)\b/.test(low)) {
        return pickUnique(BUSY_REPLIES, lastReply, recents);
      }
    }
    if (low.includes("plan") && ["today", "tonight", "tomorrow", "weekend", "sunday"].some((w) => low.includes(w))) {
      if (mood !== "angry" && mood !== "upset") {
        return pickUnique(PLANS_REPLIES, lastReply, recents);
      }
    }
    if (/\bwyd\b|what('re| are) (you|u) doing|what.*doing now|where are you|what'?s up\b|whats+'?s?\s*up|whatsup|wassup|\bsup\b|\bwud\b/.test(low)) {
      if (mood !== "angry" && mood !== "upset") {
        return pickUnique(DOING_REPLIES, lastReply, recents);
      }
    }
    if (/^(haa+|yaa+|yeah+|yep+|yes+|yess+|okay+|ok+|achha+|aacha+|hm+|hmm+|nope+|huh+)[!?.~]*$/.test(low)) {
      return pickUnique(ACK_REPLIES, lastReply, recents);
    }

    // ---- topic-aware sync branches ----
    if (/\b(married|marry|shaadi|wedding|kids|baby|babies|future|family|together forever|gonna be (yours|mine))\b|had kids|our kids|marry me/.test(low)) {
      if (mood !== "angry") return pickUnique(FUTURE_REPLIES, lastReply, recents);
    }
    if (/\bdream(ed|t)?\b|sapna/.test(low)) {
      if (mood !== "angry" && mood !== "upset") {
        return pickUnique(DREAM_REPLIES, lastReply, recents);
      }
    }
    if (/\bi love (you|u)\b|love you (so|yaar|na)\b|lob you|ilove you/.test(low)) {
      if (mood !== "angry") return pickUnique(LOVE_YOU_REPLIES, lastReply, recents);
    }
    if (/\bdo you (love|miss|like|care|trust) me\b|do you remember|do you wanna/.test(low)) {
      if (mood !== "angry") return pickUnique(OPINION_YES_REPLIES, lastReply, recents);
    }
    if (/\bdo you like\b|\bdo u like\b/.test(low)) {
      if (mood !== "angry") return pickUnique(LIKE_YES_REPLIES, lastReply, recents);
    }
    if (/tell me a joke|make me laugh|say something funny|joke sunao|a joke please|one joke/.test(low)) {
      if (mood !== "angry") return pickUnique(JOKE_REPLIES, lastReply, recents);
    }
    if (/favorite (movie|food|song|color|colour|dish|actor|show|game)|favourite (movie|food|song|color|colour)|fav (movie|song|food)/.test(low)) {
      if (mood !== "angry") {
        if (low.includes("song")) return pickUnique(FAV_SONG_REPLIES, lastReply, recents);
        return pickUnique(FAVORITE_REPLIES, lastReply, recents);
      }
    }
    if (/\bi'?m bored\b|i am bored|bore ho raha|nothing to do|so boring today|boring (day|evening)/.test(low)) {
      if (mood !== "angry" && mood !== "upset") {
        return pickUnique(BORED_REPLIES, lastReply, recents);
      }
    }
    // Asking what to talk about — propose concrete topics with substance,
    // never an empty counter-question ("talk? go on!"). Works with or
    // without a question mark (the ?-gated branches miss unpunctuated asks).
    if (/what (should|can|do|shall) (i|we) talk|what to talk about|talk about (something|anything)|give me a topic|need a topic|conversation starter|what to (talk|say|discuss)|suggest.*(topic|talk)|nothing to (talk|say|discuss)|dont know what to (talk|say)|know what to (talk|say)/.test(low)) {
      if (mood !== "angry") return pickUnique(TOPIC_STARTERS, lastReply, recents);
    }
    if (/what do (you|u) do\b|what are you upto|\bwud\b/.test(low)) {
      if (mood !== "angry") return pickUnique(DOING_ME_REPLIES, lastReply, recents);
    }
    if (/where do (you|u) (live|stay)|where are you from|which city|where do you put up/.test(low)) {
      if (mood !== "angry") return pickUnique(WHERE_LIVE_REPLIES, lastReply, recents);
    }
    if (/\bdo you (work|study)\b|\bdo u (work|study)\b|which college|what do you study/.test(low)) {
      if (mood !== "angry") return pickUnique(WORK_STUDY_REPLIES, lastReply, recents);
    }
    if (!msg.includes("?") && low.split(/\s+/).length >= 2 && low.split(/\s+/).length <= 4 &&
        snippet(msg) === "that") {
      return pickUnique(SHORT_FRAG, lastReply, recents);
    }
    if (/what does that mean|what do you mean|means\?|why\?*$|really\?*$|seriously\?*$|sachi\?*$/.test(low)) {
      if (history.length > 0) {
        let lastHim = "";
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].bf) {
            lastHim = history[i].bf.slice(0, 60);
            break;
          }
        }
        if (lastHim) {
          const cands = [
            `y'know... ${snippet(lastHim)}... I just feel it 🥺`,
            "I mean us 🥺 you know what I mean na?",
            `that ${snippet(lastHim)} thing... it got me thinking 🥺`,
          ];
          return pickBest(cands, msg, lastReply, recents, history);
        }
      }
      return pickUnique(QUESTION_FOLLOWUP, lastReply, recents);
    }
    // "what's your idea / what do you think" (often unpunctuated) — answer
    // from context instead of echoing ("idea?? tell me more?").
    if (/what'?s your (idea|plan|opinion)|what do you think|any ideas?|your idea/.test(low)) {
      if (lastTopic === "date") return pickUnique(PLANS_REPLIES, lastReply, recents);
      return pickUnique(QUESTION_FOLLOWUP, lastReply, recents);
    }
        if (msg.includes("?") && low.split(/\s+/).length >= 3) {
          // Date planning context: answer the plan directly instead of
          // parroting the question back ("think night?? ooh tell me more?").
          if (lastTopic === "date") {
            return pickUnique(PLANS_REPLIES, lastReply, recents);
          }
          const snip = snippet(msg);
          const cands = [
            `hmm ${snippet(msg)}?? 😅 tell me more?`,
            pickUnique(QUESTION_FOLLOWUP, lastReply, recents),
            pickUnique(STORY_ENGAGED, lastReply, recents),
          ];
      if (snip !== "that") cands[0] = `${snip}?? 👀 ooh tell me more?`;
      return pickBest(cands, msg, lastReply, recents, history);
    }
    if (isStory(msg)) {
      if (mood !== "angry") {
        const snip = snippet(msg);
        const cands = [
          pickUnique(STORY_ENGAGED, lastReply, recents),
          pickUnique(STORY_ENGAGED, lastReply, recents),
        ];
        if (snip !== "that") {
          cands.push(`${snip}?? 😲 wait, tell me everything!!`);
        } else {
          cands.push(pickUnique(STORY_ENGAGED, lastReply, [...recents, ...cands]));
        }
        const out = pickBest(cands, msg, lastReply, recents, history);
        return clip(fillPlaceholders(out, { nick, nick_cap: cap(nick), name: name || "babe" }));
      }
    }
    if (/\b(i (had|did|saw|met|went|got|feel|felt|think|want)|we (got|should|will|had|need)|my day|today i)\b/.test(low)) {
      if (mood !== "angry") {
        // Plan-question in date context ("what will we do…?") — answer the
        // plan instead of echoing ("think night?? tell me more?").
        if (lastTopic === "date" && msg.includes("?")) {
          return pickUnique(PLANS_REPLIES, lastReply, recents);
        }
        const snip = snippet(msg);
        const echo = snip !== "that" ? `${snip}?? 👀 ooh tell me more?` : null;
        const cands = [
          pickUnique(STORY_ENGAGED, lastReply, recents),
          pickUnique(STORY_ENGAGED, lastReply, recents),
        ];
        if (echo) cands.push(echo);
        else cands.push(pickUnique(STORY_ENGAGED, lastReply, [...recents, ...cands]));
        return pickBest(cands, msg, lastReply, recents, history);
      }
    }
  }

  const scenario = pickScenario(signals, lastReply, recents);
  if (scenario && signals.stonewall && (mood === "romantic" || mood === "happy")) {
    return pickUnique(STONEWALL_MILD, lastReply, recents);
  }
  let out: string;
  if (scenario) {
    out = scenario;
    if (out === lastReply && (REPLIES[mood] ?? []).length > 1) {
      out = pick(REPLIES[mood]);
    }
  } else {
    const snip = snippet(msg ?? "");
    const warm = mood === "romantic" || mood === "happy" || mood === "playful";
    if (snip !== "that") {
      const frames = warm ? ECHO_FRAMES_WARM : ECHO_FRAMES_COLD;
      const cands = frames.map((f) => fillPlaceholders(f, { snip }));
      const realNick = memoryNickOrNone(memories, mood);
      if (realNick) cands.push(`aww 🥺 ${realNick} vibes... tell me more?`);
      out = pickBest(cands, msg ?? "", lastReply, recents, history);
    } else if (warm) {
      const realNick = memoryNickOrNone(memories, mood);
      out = realNick
        ? `aww 🥺 ${realNick} vibes... tell me more?`
        : pickUnique(QUESTION_FOLLOWUP, lastReply, recents);
    } else {
      out = pickUnique(ACK_REPLIES, lastReply, recents);
    }
  }

  out = fillPlaceholders(out, { nick, nick_cap: cap(nick), name: name || "babe" });
  if ((mood === "angry" || mood === "upset") && signals.rude_hits.length > 0 && Math.random() < 0.4) {
    out += FIGHT_DEESCALATE;
  }
  return clip(out);
}
