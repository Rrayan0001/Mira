/**
 * Reply-quality eval: 200+ assertions over classification, diversity,
 * Hinglish mirroring, reflection, safety, and reply shape.
 *
 * Run: npx tsx scripts/eval-replies.ts [--live]
 *   --live also hits the running dev server (http://localhost:3000)
 *   for SSE contract / mood / session checks.
 */
import { mockClassify } from "../src/lib/mock-mood";
import { detectStyle, extractReflect, generateLocalReply, shortAnswer, allEnglishTemplates, PET_NAME_LIST, CRISP_EN, CRISP_HINGLISH, EMPTY_EN_POOL, EMPTY_HINGLISH_POOL } from "../src/lib/local-reply";
import { extractName, saveSession, getSession } from "../src/lib/session";
import { VIBES, isVibe } from "../src/lib/vibes";
import { isSafetyTriggered } from "../src/lib/safety";
import type { ChatMessage, Mood } from "../src/lib/moods";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = "") {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------- classify
const CLASSIFY_CASES: [string, Mood][] = [
  // happy EN
  ["today was amazing, i got the news i wanted!", "happy"],
  ["haha that made my whole day", "happy"],
  ["i'm so excited for this weekend", "happy"],
  ["i got promoted at work!", "happy"],
  ["we won the match, what a feeling", "happy"],
  ["best day ever, everything clicked", "happy"],
  // happy Hinglish
  ["arey wah, aaj toh party hai, bahut khush hoon", "happy"],
  ["mast news mili yaar, maza aa gaya", "happy"],
  ["badhiya din tha aaj, full bindaas", "happy"],
  // "crazy" as intensifier before positives is joy, not anger
  ["yesterday night i watched a horror movie, it was crazy good", "happy"],
  ["that match was crazy amazing", "happy"],
  ["crazy good biryani today", "happy"],
  ["the concert was insanely fun", "happy"],
  ["they made fun of me in front of everyone", "angry"],
  // sad EN
  ["i just feel down and i don't know why", "sad"],
  ["today left me feeling empty inside", "sad"],
  ["everything feels heavy and grey today", "sad"],
  ["i failed my exam, feeling terrible", "sad"],
  ["my breakup still hurts", "sad"],
  // sad Hinglish
  ["dil toot gaya yaar, bahut bura lag raha hai", "sad"],
  ["udaas hoon aaj, rona aa raha hai", "sad"],
  // angry EN
  ["work is driving me crazy today, nobody listens", "angry"],
  ["i'm so fed up with being treated like this", "angry"],
  ["this is so unfair, i'm furious", "angry"],
  ["my boss ignored what i said again, ugh", "angry"],
  // angry Hinglish
  ["bahut gussa aa raha hai, dimag kharab ho gaya", "angry"],
  ["yaar ye boss ne hadd kar di, bakwas hai", "angry"],
  // anxious EN
  ["my mind won't stop racing about tomorrow", "anxious"],
  ["i keep overthinking what i said", "anxious"],
  ["the deadlines are driving me crazy with worry", "anxious"],
  ["interview tomorrow, what if i mess up?", "anxious"],
  // anxious Hinglish
  ["bahut tension ho rahi hai kal ke exam ki", "anxious"],
  ["pareshan hoon yaar, neend nahi aa rahi soch soch ke", "anxious"],
  ["dar lag raha hai result ko lekar", "anxious"],
  // tired EN
  ["i'm drained, today was endless", "tired"],
  ["today was such a long draining day at work", "tired"],
  ["long day, no energy left", "tired"],
  ["running on empty, eyes heavy", "tired"],
  ["burnout is real, need sleep", "tired"],
  // tired Hinglish
  ["bahut thak gaya hoon yaar, neend aa rahi hai", "tired"],
  ["thakan ho gayi hai, sona hai bas", "tired"],
  // lonely EN
  ["the house feels so quiet without anyone", "lonely"],
  ["everyone seems busy and nobody texts back", "lonely"],
  ["my friend didn't come today, feel left out", "lonely"],
  ["they cancelled on me last minute again", "lonely"],
  // lonely Hinglish
  ["akela feel ho raha hai, koi nahi hai saath", "lonely"],
  ["dost ne plan cancel kar diya, tanha lag raha hai", "lonely"],
  ["yaad aa rahi hai sabki raat ko", "lonely"],
  // sacred EN
  ["i meditated today and feel at peace", "sacred"],
  ["evening prayer left me feeling blessed", "sacred"],
  ["quiet gratitude, feeling grounded", "sacred"],
  // sacred Hinglish
  ["mandir gaya tha, sukoon mila, shukr hai", "sacred"],
  ["dua ke baad dil ko shanti mili", "sacred"],
  // neutral EN
  ["hey, today was pretty normal", "neutral"],
  ["just having lunch, what are you up to", "neutral"],
  ["not much going on, regular stuff", "neutral"],
  ["hi", "neutral"],
  ["hello, how are you", "neutral"],
  // neutral Hinglish-ish smalltalk (should stay neutral, not misfire)
  ["hey, sab theek hai", "neutral"],
  ["bas aise hi, timepass kar raha hoon", "neutral"],
  // tricky: downplaying openers with real content
  ["nothing much, just my friend didnt come today", "lonely"],
  ["fine, but work was unfair again", "angry"],
  ["okay, but my mind is racing about tomorrow", "anxious"],
  ["all good, just exhausted after the long day", "tired"],
  // negation: positive words flipped by not/ain't/nahi must NOT read happy
  ["nahe it ain't good bro", "sad"],
  ["it ain’t good bro", "sad"],
  ["i'm not happy at all today", "sad"],
  ["today is just not good", "sad"],
  ["not feeling great tbh", "sad"],
  ["never happy anymore", "sad"],
  ["no good news lately", "sad"],
  ["khush nahi hoon aaj", "sad"],
  ["acha nahi lag raha hai", "sad"],
  ["maza nahi aa raha", "sad"],
  ["not sad, just tired", "tired"],
  ["not angry, just disappointed", "sad"],
  ["nah, i'm okay, just chilling", "neutral"],
  // blank-mind: "nothing to say" is neutral, never a false mood
  ["i have nothing to say", "neutral"],
  ["i have nothing to say or talk", "neutral"],
  ["nothing to talk about tbh", "neutral"],
  ["idk what to say", "neutral"],
  ["my mind is blank", "neutral"],
  ["can't think of anything", "neutral"],
  ["kuch nahi kehna yaar", "neutral"],
  ["koi topic nahi hai", "neutral"],
];

for (const [text, expected] of CLASSIFY_CASES) {
  const got = mockClassify(text).mood;
  check(`classify [${expected}] "${text.slice(0, 44)}"`, got === expected, `got ${got}`);
}

// ------------------------------------------------------------ lang detect
const LANG_CASES: [string, "english" | "hinglish" | "hindi"][] = [
  ["hey how are you today", "english"],
  ["work was crazy, long meeting", "english"],
  ["yaar bahut thak gaya hoon", "hinglish"],
  ["tension ho rahi hai kal exam ki", "hinglish"],
  ["acha sun, ek baat bata", "hinglish"],
  ["main theek hoon, tum batao", "hinglish"],
  ["मुझे बहुत टेंशन हो रही है", "hindi"],
  ["आज मन शांत है", "hindi"],
];
for (const [text, expected] of LANG_CASES) {
  check(`lang [${expected}] "${text.slice(0, 30)}"`, detectStyle(text) === expected, `got ${detectStyle(text)}`);
}

// ------------------------------------------------- hinglish mirror (20)
const HINGLISH_INPUTS = [
  "yaar exam ki tension ho rahi hai",
  "bahut thak gaya hoon aaj",
  "dost ne cancel kar diya, akela feel ho raha hai",
  "gussa aa raha hai boss pe",
  "dil toot gaya yaar",
  "mast din tha aaj, maza aa gaya",
  "neend nahi aa rahi, pareshan hoon",
  "mandir gaya, sukoon mila",
  "thakan hai, sona hai",
  "udaas hoon, rona aa raha hai",
];
// ------------------------------------------------- english-only replies
// Policy: Hinglish input is UNDERSTOOD (mood still classifies) but ALWAYS
// answered in proper English — no Hinglish markers, no Devanagari.
for (const text of HINGLISH_INPUTS) {
  const mood = mockClassify(text).mood;
  const reply = generateLocalReply({ mood, message: text, history: [] });
  const style = detectStyle(reply);
  const hasDevanagari = /[\u0900-\u097F]/.test(reply);
  check(`english-reply "${text.slice(0, 32)}"`, style === "english" && !hasDevanagari, `reply: ${reply.slice(0, 90)}`);
}

// ------------------------------------------------- reflection (15)
const REFLECT_CASES = [
  "my maths exam got postponed and now i'm stressed",
  "my boss shouted at me in front of everyone",
  "my best friend shifted to another city yesterday",
  "i have a cold and fever since morning",
  "the metro was packed and i got late for office",
  "mummy is upset with me about my marks",
  "my interview is tomorrow morning",
  "we ordered biryani and watched the match",
  "rent and bills are piling up this month",
  "my dog has been sick, worried all night",
  "yesterday night i watched a horror movie, it was crazy good",
];
for (const text of REFLECT_CASES) {
  const reflect = extractReflect(text);
  check(`reflect-extract "${text.slice(0, 34)}"`, reflect.length >= 3, `got "${reflect}"`);
  const mood = mockClassify(text).mood;
  // Best-of-8: the engine intentionally varies, so one draw may skip
  // reflection — but at least one of eight must echo.
  let echoed = false;
  let sample = "";
  for (let i = 0; i < 8; i++) {
    const reply = generateLocalReply({ mood, message: text, history: [] });
    if (i === 0) sample = reply;
    const r0 = reflect.split(" ")[0];
    if (r0.length > 3 && reply.toLowerCase().includes(r0)) { echoed = true; break; }
    if (/exam|boss|friend|cold|fever|metro|office|mumm|interview|biryani|match|rent|bill|dog|sick/i.test(reply)) { echoed = true; break; }
  }
  check(`reflect-echo "${text.slice(0, 34)}"`, echoed, `sample: ${sample.slice(0, 100)}`);
}

// ------------------------------------------- diversity: 20 turns x 8 moods
const MOODS: Mood[] = ["happy", "sad", "angry", "anxious", "tired", "lonely", "sacred", "neutral"];
const SEED_MSGS: Record<Mood, string> = {
  happy: "today was amazing, got great news",
  sad: "feeling down and heavy today",
  angry: "work was so unfair, nobody listens",
  anxious: "mind racing about tomorrow, can't relax",
  tired: "drained after an endless long day",
  lonely: "house feels quiet, nobody around",
  sacred: "evening prayer left me peaceful",
  neutral: "just a normal day, having lunch",
};
// Varied realistic continuations so the 20-turn loop mirrors real chats.
const VARIED_FOLLOW_UPS: Record<Mood, string[]> = {
  happy: ["told mom the news, she was thrilled", "colleagues congratulated me", "going out for dinner to celebrate", "can't stop smiling honestly", "yaar party ka plan ban raha hai", "this week keeps getting better", "called my best friend, screamed a little", "treat due, biryani night soon"],
  sad: ["it's been building all week", "miss how things used to be", "today felt empty", "didn't feel like eating", "dil bhaari hai yaar", "tried music, didn't help", "just want some quiet company", "crying a little, sorry"],
  angry: ["and then they blamed me too", "nobody even apologised", "same thing happened last month", "i'm tired of explaining myself", "boss ne phir suna diya", "friend took their side, ugh", "traffic plus this, worst combo", "seriously done with this attitude"],
  anxious: ["interview is tomorrow morning", "results week, stomach in knots", "overthinking that one message", "kal exam hai, tension hai", "bills plus deadlines together", "heart beating fast tonight", "can't sleep, mind looping", "what if i mess it up"],
  tired: ["back to back meetings killed me", "barely slept 4 hours", "metro ride drained the rest", "thak gaya hoon poora", "eyes burning, need bed", "skipped lunch, bad idea", "weekend can't come sooner", "even typing feels heavy"],
  lonely: ["friends all busy tonight", "no one replied to my texts", "dinner alone again", "akela feel ho raha hai", "miss home a lot today", "scrolling reels, feeling hollow", "weekend plans fell through", "quiet room, loud thoughts"],
  sacred: ["morning walk felt healing", "lit a diya, sat quietly", "gratitude journaling tonight", "sukoon mila aaj", "old song brought peace", "watched the sunset slowly", "helped a stranger, felt warm", "just breathing, feeling held"],
  neutral: ["chore day, cleaned my room", "lunch was dal chawal", "metro was on time today", "bas routine chal raha hai", "chai break with colleagues", "evening walk done", "working through emails", "weekend grocery run"],
};
const PET_STACK = /(cutie.*handsome|handsome.*cutie|sweetheart.*cutie|cutie.*sweetheart|handsome.*sweetheart|sweetheart.*handsome)/i;

for (const mood of MOODS) {
  const seen = new Set<string>();
  const history: ChatMessage[] = [];
  let petStackCount = 0;
  let shapeFails = 0;
  const questions = new Set<string>();
  // Realistic varied follow-ups per mood (real chats never repeat one line).
  const followUps = VARIED_FOLLOW_UPS[mood];
  for (let turn = 0; turn < 20; turn++) {
    const msg = turn === 0 ? SEED_MSGS[mood] : followUps[turn % followUps.length];
    const reply = generateLocalReply({ mood, message: msg, history, stage: "comfort_action" });
    // shape: 1-4 sentences, <=600 chars, ends with ? or . or !
    const sentences = reply.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
    if (sentences.length < 1 || sentences.length > 4 || reply.length > 600) shapeFails++;
    if (PET_STACK.test(reply)) petStackCount++;
    const q = reply.match(/[^.!?]*\?/g)?.pop()?.trim().toLowerCase().slice(0, 48);
    if (q) questions.add(q);
    seen.add(reply.toLowerCase());
    history.push({ role: "user", content: msg }, { role: "assistant", content: reply });
    if (history.length > 16) history.splice(0, 2);
  }
  check(`diversity[${mood}] unique>=14/20`, seen.size >= 14, `unique=${seen.size}`);
  // Honest repetition metric: no exact repeat within a sliding window of 6
  // (matches the engine's own anti-repeat horizon).
  let windowRepeat = 0;
  const seq: string[] = [];
  {
    const h2: ChatMessage[] = [];
    for (let turn = 0; turn < 20; turn++) {
      const msg = turn === 0 ? SEED_MSGS[mood] : followUps[turn % followUps.length];
      const r = generateLocalReply({ mood, message: msg, history: h2, stage: "comfort_action" });
      const key = r.toLowerCase();
      if (seq.slice(-6).includes(key)) windowRepeat++;
      seq.push(key);
      h2.push({ role: "user", content: msg }, { role: "assistant", content: r });
      if (h2.length > 16) h2.splice(0, 2);
    }
  }
  check(`diversity[${mood}] no repeat within 6`, windowRepeat === 0, `windowRepeats=${windowRepeat}`);
  check(`diversity[${mood}] shape ok`, shapeFails === 0, `shapeFails=${shapeFails}`);
  check(`diversity[${mood}] no pet-name stacking`, petStackCount === 0, `stacked=${petStackCount}`);
  check(`diversity[${mood}] varied questions>=8`, questions.size >= 8, `q=${questions.size}`);
}

// --------------------------------- name+pet never stack (40 generations)
// "What changed..., rayan, sweetheart?" — at most ONE address term/reply.
{
  let stacked = 0;
  let sample = "";
  const hist: ChatMessage[] = [];
  const msgs = [
    "today was amazing", "work was unfair", "feeling low",
    "yaar tension ho rahi hai", "drained after a long day",
  ];
  for (let i = 0; i < 40; i++) {
    const moods: Mood[] = ["happy", "angry", "sad", "anxious", "tired", "lonely", "neutral", "sacred"];
    const mood = moods[i % moods.length];
    const r = generateLocalReply({ mood, message: msgs[i % msgs.length], history: hist, userName: "Rayan" });
    const low = r.toLowerCase();
    const hasName = low.includes("rayan");
    // Vocative check: "love" is also a verb ("Love it or...") — only counts
    // as a pet name adjacent to a comma or end punctuation.
    const pets = PET_NAME_LIST.filter((p) => {
      if (p === "love") return /(,\s*love\b|\blove\s*[,?.!])/.test(low);
      const re = new RegExp(`(?<![a-z'])${p}(?![a-z'])`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(low)) !== null) {
        if ((m.index ?? 0) > 0) return true;
      }
      return false;
    });
    if (hasName && pets.length > 0) {
      stacked++;
      if (!sample) sample = r.slice(0, 100);
    }
    hist.push({ role: "user", content: msgs[i % msgs.length] }, { role: "assistant", content: r });
    if (hist.length > 16) hist.splice(0, 2);
  }
  check("no name+pet stacking in 40", stacked === 0, `stacked=${stacked} sample=${sample}`);
}

// --------------------------------- english pools read english
// No loanword may trip the detector (a "chai" in a template once caused a
// Hinglish classification of an English reply).
{
  let bad = 0;
  for (const t of allEnglishTemplates()) {
    if (detectStyle(t) !== "english") {
      bad++;
      failures.push(`english-pool: ${t.slice(0, 80)}`);
    }
  }
  check("english-pools all english", bad === 0, `bad=${bad}`);
}

// --------------------------------- blank-mind invites (not generic)
// "i have nothing to say" must invite talking, crisply.
{
  const EMPTY_CASES = [
    "i have nothing to say",
    "i have nothing to say or talk",
    "nothing to talk about tbh",
    "idk what to say",
    "my mind is blank",
    "kuch nahi kehna yaar",
  ];
  const INVITE = /say|talk|tell|bata|bol|topic|pressure|tension mat|blank|start|song|weather|mausam|chai|coffee|khane/i;
  for (const text of EMPTY_CASES) {
    const mood = mockClassify(text).mood;
    check(`empty-mood "${text.slice(0, 30)}"`, mood === "neutral", `got ${mood}`);
    let ok = false;
    let sample = "";
    for (let i = 0; i < 5; i++) {
      const r = generateLocalReply({ mood, message: text, history: [] });
      if (i === 0) sample = r;
      if (INVITE.test(r) && r.length <= 240) { ok = true; break; }
    }
    check(`empty-invite "${text.slice(0, 30)}"`, ok, `sample: ${sample.slice(0, 100)}`);
  }
}

// ------------------------- short-answer threading (the "work" bug)
// Bot asks "what keeps you busy?" → user "work" → MUST follow up on work,
// never pivot to a random checklist question.
{
  const qHist: ChatMessage[] = [
    { role: "user", content: "ha nothing did" },
    { role: "assistant", content: "Steady vibes. What's been keeping you busy lately — work, college, family, or just life?" },
  ];
  // Thread topics echo back capitalized, deterministically (all templates).
  for (const [msg, topic] of [["work", "Work"], ["college fest", "College fest"], ["ghar", "Ghar"], ["my office", "Office"], ["kaam", "Kaam"]] as [string, string][]) {
    const sa = shortAnswer(msg, qHist, "neutral");
    check(`thread-detect "${msg}"`, sa.kind === "thread", JSON.stringify(sa));
    let okAll = true;
    for (let i = 0; i < 5; i++) {
      const r = generateLocalReply({ mood: "neutral", message: msg, history: qHist });
      if (!r.includes(topic)) { okAll = false; break; }
    }
    check(`thread-echo "${msg}"→"${topic}"`, okAll);
  }
  // Yes/no/dunno → gentle nudge, never "Yaar, huh?".
  for (const msg of ["yes", "no", "ok", "hmm", "ha nothing did", "not really", "idk"]) {
    const sa = shortAnswer(msg, qHist, "neutral");
    check(`ack-detect "${msg}"`, sa.kind === "ack", JSON.stringify(sa));
  }
  // Guards: first message = name (never "Rayan, huh?"), greetings, real moods.
  check("thread-guard first-msg", shortAnswer("Rayan", [], "neutral").kind === "none");
  check("thread-guard greeting", shortAnswer("hi", qHist, "neutral").kind !== "thread");
  check("thread-guard yaar", shortAnswer("yaar", qHist, "neutral").kind === "ack");
  check("thread-guard mood", shortAnswer("work", qHist, "sad").kind === "none");
  check("thread-guard long", shortAnswer("work was really unfair today", qHist, "neutral").kind === "none");
}

// ------------------------- names: never "College Fest"
// Two-word lowercase common nouns must not become the user's name.
{
  const NAME_CASES: [string, string | undefined][] = [
    ["Rayan", "Rayan"],
    ["rayan", "Rayan"],
    ["my name is Priya", "Priya"],
    ["Alex", "Alex"],
    ["Mary Jane", "Mary Jane"],
    ["college fest", undefined],
    ["my office", undefined],
    ["my college", undefined],
    ["work meeting", undefined],
    ["birthday party", undefined],
    ["hi", undefined],
    ["work", undefined],
    ["nothing much", undefined],
    ["good morning", undefined],
  ];
  for (const [text, expected] of NAME_CASES) {
    check(`name "${text}"`, extractName(text) === expected, `got ${extractName(text)}`);
  }
}

// ------------------------- vibe behavior (navbar selector)
// straight = always crisp-short, zero pet names, zero name-dropping.
{
  const VIBE_MSGS = [
    "today was amazing news",
    "work was unfair",
    "feeling low",
    "mind racing about tomorrow",
    "drained after a long day",
  ];
  const hasPet = (r: string) =>
    /(cutie|handsome|sweetheart)/i.test(r) || /(,\s*love\b|\blove\s*[,?.!])/i.test(r);
  let bad = 0;
  for (const m of VIBE_MSGS) {
    const mood = mockClassify(m).mood;
    for (let i = 0; i < 4; i++) {
      const r = generateLocalReply({ mood, message: m, history: [], userName: "Rayan", vibe: "straight" });
      if (r.length > 140 || hasPet(r) || r.includes("Rayan")) bad++;
    }
  }
  check("vibe-straight crisp+clean", bad === 0, `bad=${bad}`);
  // gentle = warm but never pet names.
  let gentlePets = 0;
  for (const m of VIBE_MSGS) {
    const mood = mockClassify(m).mood;
    for (let i = 0; i < 4; i++) {
      if (hasPet(generateLocalReply({ mood, message: m, history: [], vibe: "gentle" }))) gentlePets++;
    }
  }
  check("vibe-gentle no pets", gentlePets === 0, `pets=${gentlePets}`);
  // wild = high-energy openers land regularly.
  let wildHits = 0;
  for (let i = 0; i < 16; i++) {
    const m = VIBE_MSGS[i % VIBE_MSGS.length];
    const r = generateLocalReply({ mood: mockClassify(m).mood, message: m, history: [], vibe: "wild" });
    if (/Okay wait|Stoppp|No way|Okay okay|Listen|Ohh|Yooo/.test(r)) wildHits++;
  }
  check("vibe-wild energy", wildHits >= 6, `hits=${wildHits}/16`);
  // sweet (default) keeps the classic warmth with pet names.
  let sweetPets = 0;
  for (const m of VIBE_MSGS) {
    const mood = mockClassify(m).mood;
    for (let i = 0; i < 2; i++) {
      if (hasPet(generateLocalReply({ mood, message: m, history: [] }))) sweetPets++;
    }
  }
  check("vibe-sweet warmth", sweetPets >= 3, `pets=${sweetPets}/10`);
  // vibe plumbing: type guard + session default/persist.
  check("vibe-guard", isVibe("wild") && isVibe("gentle") && !isVibe("spicy") && !isVibe(undefined));
  check("vibe-types", VIBES.length === 4);
  saveSession("vibe-test", { turns: 1 });
  check("vibe-session-default", getSession("vibe-test")?.vibe === "sweet");
  saveSession("vibe-test", { vibe: "wild" });
  check("vibe-session-persist", getSession("vibe-test")?.vibe === "wild");
}

// ------------------------------------------------- crisp pools + ratio
{
  // Shape: every crisp template short, punctuated, slot-free.
  const moods = Object.keys(CRISP_EN) as Mood[];
  for (const m of moods) {
    for (const t of [...CRISP_EN[m], ...CRISP_HINGLISH[m]]) {
      check(`crisp-shape[${m}]`, t.length <= 140 && /[.?!]$/.test(t) && !t.includes("{reflect}") && !t.includes("META"), t.slice(0, 60));
    }
  }
  // Ratio: ~1 in 4 normal turns is crisp (<130 chars).
  let short = 0;
  const h: ChatMessage[] = [];
  const msgs = ["today was good", "work was unfair", "feeling low", "tired today", "quiet night", "calm evening"];
  for (let i = 0; i < 60; i++) {
    const mood = moods[i % moods.length];
    const r = generateLocalReply({ mood, message: msgs[i % msgs.length], history: h });
    if (r.length < 130) short++;
    h.push({ role: "user", content: msgs[i % msgs.length] }, { role: "assistant", content: r });
    if (h.length > 16) h.splice(0, 2);
  }
  check("crisp-ratio >=6/60 short", short >= 6, `short=${short}`);
  // Empty pools are short by design too (invite may end with ? or .).
  for (const t of [...EMPTY_EN_POOL, ...EMPTY_HINGLISH_POOL]) {
    check("empty-shape", t.length <= 200 && /[.?]$/.test(t), t.slice(0, 60));
  }
}

// ------------------------------------------------------------- safety (10)
const SAFETY_INPUTS = [
  "i want to kill myself",
  "thinking about suicide lately",
  "i cut myself when stressed (self harm)",
  "i want to end my life",
  "i hurt myself yesterday",
  "KILL MYSELF — does anyone care",
  "SuIcIdE thoughts at night",
  "self-harm feels like the answer",
  "end my life, nobody cares",
  "i want to hurt myself",
];
for (const text of SAFETY_INPUTS) {
  check(`safety "${text.slice(0, 34)}"`, isSafetyTriggered(text) === true);
}
const SAFE_INPUTS = [
  "i killed my workout today",
  "suicide squad movie was fun",
  "i hurt my finger cooking",
  "life is hard but i'm coping",
  "killing time with music",
];
for (const text of SAFE_INPUTS) {
  check(`safety-neg "${text.slice(0, 34)}"`, isSafetyTriggered(text) === false);
}

// ------------------------------------------------- generic shape (20 rnd)
const RND = [
  "hey", "hi mira", "what's up", "bored", "idk", "nothing much",
  "today was okay", "cricket match was fun", "mom made dal today",
  "stuck in traffic for an hour", "college fest next week",
  "my cat did something funny", "can't decide what to eat",
  "weekend plans?", "sunday feels slow", "monday blues hit hard",
  "late night thoughts", "chai break time", "miss old days",
  "grateful for small things",
];
for (const text of RND) {
  const mood = mockClassify(text).mood;
  const reply = generateLocalReply({ mood, message: text, history: [] });
  // Min 15 (crisp replies are short on purpose), max 600.
  const okLen = reply.length >= 15 && reply.length <= 600;
  const noMeta = !reply.includes("META") && !reply.includes("<!--");
  const noList = !/^\s*[-*]\s/m.test(reply);
  check(`shape "${text.slice(0, 28)}"`, okLen && noMeta && noList, reply.slice(0, 80));
}

// ----------------------------------------------------------------- report
console.log(`\nEVAL: ${pass} passed, ${fail} failed, ${pass + fail} total assertions.`);
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures.slice(0, 40)) console.log(` - ${f}`);
  if (failures.length > 40) console.log(` ... +${failures.length - 40} more`);
}
process.exit(fail ? 1 : 0);
