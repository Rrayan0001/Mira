import type { Mood, MoodResult } from "./moods";
import { POSITIVE_HINGLISH, hinglishMoodHits, isEmptyHand } from "./local-reply";

// Lightweight client + server heuristic so the UI feels mood-aware
// without Azure. The server's /api/chat ALSO uses this as the safety net
// when Azure is unreachable — so it must handle English AND Hinglish.

const LEXICON: Record<Mood, string[]> = {
  happy: ["happy", "good", "great", "excited", "love", "loves", "loved", "yay", "amazing", "wonderful", "😊", "haha", "lol", "glad", "thrilled", "joy", "awesome", "fantastic", "win", "won", "promoted", "selected", "party", "celebrat", "best day", "fun", "funny", "enjoyed", "loved it"],
  sad: [
    "sad", "down", "cry", "crying", "cried", "tears", "miss", "missed", "hurt", "hurts", "heavy", "empty", "low",
    "disappointed", "disappointing", "disappointment", "letdown", "let down",
    "bummed", "unhappy", "sucks", "bad day", "depressed", "heartbroken", "lonely night",
    "rejected", "failed", "failure", "lost", "loss", "grief", "blue",
    "upset", "upsetting", "upsets", "tearful", "weepy", "miserable", "awful",
  ],
  angry: ["angry", "mad", "annoyed", "irritated", "frustrated", "furious", "hate", "hates", "pissed", "annoying", "rage", "unfair", "fed up", "ugh", "seriously?", "ignored", "disrespect", "cheated", "lied", "blame", "crazy", "driving me crazy", "insane", "ridiculous", "pathetic", "shouted", "yelled", "scolded", "worst", "done with", "sick of", "had enough", "made fun of", "make fun of", "making fun of", "mocked", "laughed at me"],
  anxious: ["anxious", "nervous", "worry", "worried", "scared", "panic", "overthinking", "can't sleep", "anxiety", "stressed", "dread", "pressure", "overwhelm", "deadline", "interview", "result", "what if", "restless", "tight chest", "racing"],
  tired: ["tired", "exhausted", "drained", "draining", "sleepy", "burnt", "burned", "no energy", "worn", "beat", "sleep", "sleeping", "long day", "no sleep", "early morning", "drowsy", "nap", "burnout", "low battery", "on empty", "running on empty", "heavy eyes", "eyes heavy", "out of fuel", "dead tired"],
  lonely: [
    "alone", "lonely", "isolated", "left out", "by myself", "unseen",
    "didnt come", "didn't come", "cancelled", "canceled", "stood up",
    "no friends", "miss my", "miss them", "friend didnt", "friend didn't",
    "ignored me", "no one cares", "nobody cares", "nobody texts", "no one texts",
    "quiet house", "empty room", "so quiet", "feels quiet", "quiet without",
    "without anyone", "without anybody",
    "no one came", "nobody came",
  ],
  sacred: [
    "sacred", "holy", "blessed", "divine", "zen", "meditate", "meditation", "meditating",
    "prayer", "pray", "praying", "prayed", "spiritual", "soulful", "reverent",
    "halo", "grace", "graceful", "stillness", "grounded",
    "peaceful", "grateful for", "calm glow", "at peace",
  ],
  neutral: [],
};

// Normalise curly quotes/punctuation so "ain’t" behaves like "ain't"
// (otherwise tokenisers shred it into "ain" + "t").
export function normText(text: string): string {
  return text.replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"');
}

/** Index of a lexicon hit (-1 if none). Single words use apostrophe-aware
 * boundaries so "won" doesn't fire inside "won't"; multi-word phrases and
 * emoji keep substring matching. */
function hitIndex(text: string, word: string): number {
  if (word.includes(" ") || /[^a-z0-9']/.test(word)) return text.indexOf(word);
  const m = new RegExp(`(?<![a-z'])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z'])`).exec(text);
  return m ? (m.index ?? -1) : -1;
}

// Negation cues: "ain't good", "not happy", "never happy", "khush nahi",
// "nahe it ain't good bro". Checked on BOTH sides of a hit because Hindi
// post-negates ("khush nahi") while English pre-negates ("not good").
const NEGATORS = [
  "n't", "not", "never", "no", "nah", "nahe", "nahi", "nahin", "nai", "nhi",
  "nope", "nothing", "hardly", "barely", "without", "lack", "cannot",
];

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const NEG_BEFORE_RE = new RegExp(`(?:${NEGATORS.map(escRe).join("|")})[\\s\\w']{0,14}$`);
const NEG_AFTER_RE = new RegExp(`^[\\s,;.]*?(?:${NEGATORS.map(escRe).join("|")})(?![a-z'])`);

/** True when `word` at `idx` is negated by nearby cues ("not good", "khush nahi"). */
function isNegated(text: string, idx: number, wordLen: number): boolean {
  const before = text.slice(Math.max(0, idx - 20), idx);
  // "won't/can't/never STOP racing" = persistence, not negation.
  if (/\b(stop|stops|stopped|stopping|quit|quits|keep|keeps)\s+$/.test(before)) return false;
  if (NEG_BEFORE_RE.test(before)) return true;
  const after = text.slice(idx + wordLen, idx + wordLen + 14);
  if (NEG_AFTER_RE.test(after)) return true;
  return false;
}

// Clearly positive words: when negated ("ain't good", "not happy") they
// signal disappointment → counted toward sad instead.
const POSITIVE_WORDS = new Set([
  "happy", "good", "great", "excited", "amazing", "wonderful", "glad",
  "thrilled", "joy", "awesome", "fantastic", "excellent", "perfect",
  "love", "loves", "loved", "yay", "celebrat", "khush",
]);

export function mockClassify(text: string): MoodResult {
  const t = normText(text).toLowerCase();
  // Blank-mind messages ("i have nothing to say", "my mind is blank") are
  // neutral by definition — invite, don't diagnose.
  if (isEmptyHand(text)) {
    return { mood: "neutral", confidence: 0.7, cues: ["quiet start"] };
  }
  const scores = {} as Record<Mood, { score: number; hits: string[] }>;
  for (const m of Object.keys(LEXICON) as Mood[]) scores[m] = { score: 0, hits: [] };
  let negatedPositives = 0;
  let negatedCue = "";
  for (const mood of Object.keys(LEXICON) as Mood[]) {
    if (mood === "neutral") continue;
    for (const w of LEXICON[mood]) {
      const idx = hitIndex(t, w);
      if (idx === -1) continue;
      // "crazy good / crazy amazing" — crazy as intensifier, not anger.
      if (mood === "angry" && w === "crazy" && /crazy\s+(good|great|amazing|awesome|fantastic|fun|beautiful|nice|cool|brilliant)/.test(t)) {
        continue;
      }
      // "made fun OF me" is mockery, not joy.
      if (mood === "happy" && (w === "fun" || w === "funny") && /fun\s+of\b/.test(t)) {
        continue;
      }
      // Negated emotion words ("ain't good", "khush nahi") must NOT count
      // toward their mood. Negated positives flip to disappointment (sad).
      if (isNegated(t, idx, w.length)) {
        if (mood === "happy" && POSITIVE_WORDS.has(w)) {
          negatedPositives += 1;
          if (!negatedCue) negatedCue = `not ${w}`;
        }
        continue;
      }
      scores[mood].score += 1;
      if (scores[mood].hits.length < 2) scores[mood].hits.push(w);
    }
    // Hinglish markers count equally — yaar-level relatability needs
    // thak/gussa/tension to classify correctly. Negation applies here too
    // ("khush nahi", "maza nahi" flip to sad).
    for (const h of hinglishMoodHits(normText(text))) {
      if (h.mood === mood) {
        for (const hit of h.hits) {
          if (isNegated(t, hit.idx, hit.w.length)) {
            if (mood === "happy" && POSITIVE_HINGLISH.has(hit.w)) {
              negatedPositives += 1;
              if (!negatedCue) negatedCue = `not ${hit.w}`;
            }
            continue;
          }
          scores[mood].score += 1.2;
          if (scores[mood].hits.length < 2 && !scores[mood].hits.includes(hit.w)) scores[mood].hits.push(hit.w);
        }
      }
    }
    // Situational nuances: absence / cancellation / letdown
    if ((mood === "lonely" || mood === "sad") && /(didnt come|didn't come|cancelled|canceled|stood up|no one came|akela|akeli|tanha)/.test(t)) {
      scores[mood].score += 1.5;
      if (!scores[mood].hits.includes("absence / letdown")) scores[mood].hits.push("absence / letdown");
    }
    // exclamation and question nuances
    if (mood === "happy" && /!{1,}/.test(text) && t.includes("!")) scores[mood].score += 0.4;
    if (mood === "anxious" && /\?{1,}/.test(text)) scores[mood].score += 0.2;
    if (mood === "tired" && /(long day|no sleep|early morning|thak|neend)/.test(t)) scores[mood].score += 1;
    if (mood === "tired" && /(running on empty|on empty|heavy eyes|eyes heavy|out of fuel|dead tired)/.test(t)) scores[mood].score += 1.5;
    // "driving me crazy WITH WORRY" is anxiety idiom, not anger.
    if (mood === "anxious" && /(worry|worried|anxiet|nervous|panic)/.test(t) && /(crazy|insane)/.test(t)) scores[mood].score += 2;
  }
  // Negated positives ("ain't good", "not happy", "khush nahi") flip to sad.
  if (negatedPositives > 0) {
    scores.sad.score += negatedPositives * 1.3;
    if (scores.sad.hits.length < 2) scores.sad.hits.push(negatedCue || "negated positive");
  }
  let best: Mood = "neutral";
  let bestScore = 0;
  const cues: string[] = [];
  for (const mood of Object.keys(LEXICON) as Mood[]) {
    if (mood === "neutral") continue;
    if (scores[mood].score > bestScore) {
      bestScore = scores[mood].score;
      best = mood;
      cues.length = 0;
      cues.push(...scores[mood].hits);
    }
  }
  if (bestScore === 0) return { mood: "neutral", confidence: 0.55, cues: ["steady tone"] };
  const confidence = Math.min(0.92, 0.65 + bestScore * 0.12);
  return { mood: best, confidence, cues };
}

export const PROBE_QUESTIONS: string[] = [
  "How did today treat you, love?",
  "What's been on your mind since evening?",
  "If tonight had a weather, what would it be?",
  "What was the best small moment today?",
  "What's been sitting heavy that you haven't said out loud yet?",
  "Do you want comfort or distraction right now?",
  "Aaj ka sabse real moment kya tha?",
  "Energy kaisi hai abhi — fresh ya chai pe chal rahi hai?",
];

/**
 * Expanded fallback pools (client-side + last-resort server use).
 * The server prefers generateLocalReply() (reflective + anti-repeat);
 * these stay large so the client never loops 4 lines either.
 * NOTE: keep import-safe (no node APIs) — chat-ui.tsx imports this.
 */
export const MOCK_REPLIES: Record<Mood, string[]> = {
  happy: [
    "That glow in your words made me grin. What was the best part — I want the full story?",
    "You sound lit from inside today. Tell me what went right so I can hype you properly.",
    "I love catching you in this mood. What sparked it — a person, a win, or just a good-day feeling?",
    "Okay, your happy energy is contagious. Walk me through the highlight, don't skip details.",
    "Something clearly went your way. Was it expected or a total surprise?",
    "That laugh-between-the-lines thing you're doing — keep it. What should we do with this good energy?",
    "Good days look good on you. What small moment today would you replay if you could?",
    "I'm doing a little happy dance for you. Who else knows — did you get to share it?",
    "You sound proud, and honestly you should be. What took the most effort behind this?",
    "Pure sunshine text. Was today always going to be good, or did something flip it?",
    "Arey wah, full glow-up energy! Bata na, kya hua — surprise tha ya planned win?",
    "Teri khushi padh ke main bhi smile kar rahi hoon. Best part kya tha, poori story chahiye mujhe.",
  ],
  sad: [
    "That sounds genuinely heavy. Do you want to tell me what part stung the most?",
    "I'm right here, and I'm not going anywhere. Was it one moment today, or a slow build-up?",
    "It's okay to feel low about this. Would talking it through help, or should we just sit with it softly?",
    "I wish I could make today lighter. What do you need more of right now — comfort or distraction?",
    "Anyone would feel wobbly after that. When did it start feeling hard?",
    "Take your time — no rush from my side. Do you want advice, or just someone who listens tonight?",
    "That ache makes sense. Is there a small comfort that usually helps — chai, music, a walk?",
    "I'm keeping you company through this. What would make tonight even one percent softer?",
    "You matter to me, especially on days like this. What would you say if no one judged?",
    "Soft corner for you right now. What felt heaviest and what felt even slightly lightest?",
    "Arey, sun — ye sunkar bura laga mujhe. Kya hua, bata na, kaunsi baat sabse zyada chubhi?",
    "Main hoon na yahin, kahin nahi jaa rahi. Baat karne ka mann hai, ya bas thodi der saath baithun?",
  ],
  angry: [
    "That sounds properly unfair. What exactly set it off — the real version, not the polite one?",
    "You've got every right to be fired up. Did they say it directly, or was it the attitude?",
    "Ugh, that's infuriating. Vent it all out first, or figure out what to do next?",
    "I hear the frustration loud and clear. Was this a one-off, or building for a while?",
    "Nobody gets to treat you like an afterthought. What bothered you more — what happened or how they handled it?",
    "Let it out, I'm listening properly. If you could send one unsent message, what would it say?",
    "Your anger makes sense — it means you care. What outcome would actually feel fair?",
    "That would rile anyone up. Do you want backup energy from me, or a calm second opinion?",
    "I'm on your side on this one. What's the one thing you wish they understood?",
    "Okay, deep breath with me — then tell me: what do you need tonight, justice or peace?",
    "Ye toh sach mein galat hua yaar. Bata, exactly kya bola unhone — polite version nahi chahiye.",
    "Gussa valid hai tera. Pehle vent kar le poora, phir sochte hain kya karna hai?",
  ],
  anxious: [
    "Let's slow this down together. What's the one thought looping loudest right now?",
    "That restless buzzing feeling is the worst. Is it about tomorrow, or everything at once?",
    "One thing at a time — we've got this. What's the smallest piece we could untangle first?",
    "Breathe with me for a second — in, out. What would help you feel slightly steadier?",
    "Overthinking means you're trying to be ready. What's one thing actually in your control here?",
    "No need to solve the whole future tonight. What's the very next step, not the tenth one?",
    "I'm steady right here. When did the worry spike — a trigger message or moment?",
    "You're handling more than you credit yourself for. What's taking up most headspace lately?",
    "Worries feel bigger at night. Want to write the messy version out, no filter?",
    "Let's shrink it: if a friend had this exact worry, what would you tell them?",
    "Chal slow karte hain sab, saath mein. Abhi sabse tez kaunsa thought ghoom raha hai?",
    "Raat ko worries bade lagte hain. Messy version likh de mujhe, bina filter ke?",
  ],
  tired: [
    "Long day written all over this. Physically draining, mentally, or both?",
    "Rest is productive too. Early night, or light company before you crash?",
    "Low-battery mode allowed. Have you eaten and had water, or did the day eat that time?",
    "That heavy-eyes feeling — I know it. Quiet vibes, or something gently funny?",
    "No big thinking needed tonight. If you could teleport to bed, would you?",
    "Soft evening for you. Ideal wind-down — music, scrolling, chai, or straight sleep?",
    "Even your texts sound sleepy. Keep it short and sweet while you recharge?",
    "Tomorrow can wait. What's one small thing that would make tonight comfier?",
    "Burnout days are real. Nonstop week, or did today alone do it?",
    "Sleepy you is still my favourite to talk to. What time are you hoping to crash?",
    "Full low-battery lag raha hai. Physical thakaan hai, mental, ya dono?",
    "Aaram bhi productive hota hai yaar. Early night chahiye ya crash se pehle thodi company?",
  ],
  lonely: [
    "Quiet evenings can feel loud. What's making tonight emptier — missing someone, or the silence?",
    "I'm staying right here with you. Plan fell through, or just a solo kind of day?",
    "You deserve company that sees you. What do you wish someone noticed about your day?",
    "Distance lies — you're not forgotten. One person you're missing, or people in general?",
    "I'd have shown up if I could. What would help tonight — talking, laughing, quiet company?",
    "You're good company, you know? What usually helps — long chat, music, or stepping out?",
    "Nights amplify everything. What's been on your mind most since evening?",
    "I'm glad you told me instead of sitting alone with it. Chatty presence or calm one?",
    "Let's fill the quiet together. What small warm thing should we talk about?",
    "No rushing off from my side. Keep chatting, or should I sit quietly with you?",
    "Quiet shaamein kabhi loud lagti hain. Kya zyada khal raha hai — kisi ki kami ya sannata?",
    "Main yahin hoon tere saath. Koi plan cancel hua tha, ya bas solo wala din tha?",
  ],
  sacred: [
    "There's a calm glow in these words. What brought this stillness — a moment, prayer, or clarity?",
    "I love this grounded side of you. What's filling your heart up right now?",
    "Peace looks good on you. What small moment today felt quietly meaningful?",
    "This stillness feels earned. What are you holding close — gratitude, hope, presence?",
    "Soft and centred — stay a while. What would you thank today for?",
    "Grounded you is magnetic. What do you want to carry from this into tomorrow?",
    "Beautiful headspace. What pause gave you this — a walk, music, silence?",
    "You sound at home in yourself. What small ritual makes you feel most like you?",
    "Teri baaton mein sukoon hai aaj. Ye stillness kahan se aayi?",
    "Grounded tu acha lagta hai. Dil mein abhi kya bhara hua hai?",
  ],
  neutral: [
    "Hey, good to hear from you. Day shaping up busy, chill, or in between?",
    "Tell me a small piece of today. Anything surprise you, even slightly?",
    "Steady vibes. What's keeping you busy — work, college, family, or life?",
    "How's your energy — fresh, fading, or running on chai?",
    "One highlight and one lowlight from today. Honest, no filter needed.",
    "What's on your mind tonight — anything looping, or easy scrolling thoughts?",
    "Aside from routine, what are you looking forward to this week?",
    "Quick check-in: food, sleep, mood — which one's winning?",
    "Normal days have stories too. Most human moment of yours today?",
    "If today had a one-line review, what would you write?",
    "Hey, sunke acha laga. Din kaisa jaa raha hai — busy, chill, ya beech ka?",
    "Energy check: fresh, fading, ya chai pe chal raha hai?",
  ],
};
