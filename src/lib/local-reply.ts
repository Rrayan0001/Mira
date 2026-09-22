import type { ChatMessage, Mood } from "@/lib/moods";
import { DEFAULT_VIBE, type Vibe } from "@/lib/vibes";

/**
 * Offline reply engine — used when Azure is unreachable (bad creds / DNS).
 *
 * Goals: relatable to everyone (Indian + global everyday life), Hinglish-aware
 * (mirror the user's language), and NON-repetitive (large pools + history
 * filter + rotating pet-names + content reflection).
 *
 * Design:
 * - detectStyle(): english | hinglish | hindi — from roman-Hindi markers and
 *   Devanagari script.
 * - extractReflect(): short content phrase from the user message so replies
 *   feel listened-to instead of generic.
 * - Per-mood template pools (EN + Hinglish-mix), each template 2-3 sentences,
 *   max ONE pet name, ends with a varied question (not the same one twice).
 * - pickReply(): filters out recent assistant replies + recently used template
 *   ids, rotates pet names, fills {reflect}/{name} slots.
 */

export type LangStyle = "english" | "hinglish" | "hindi";

/** Reply language policy: proper English only. Hinglish input is still
 * UNDERSTOOD (mood lexicons cover it) but never mirrored back. */
const REPLY_HINGLISH = false;

/** Local copy (mock-mood.ts has its own; kept separate to avoid a cycle). */
function normApos(text: string): string {
  return text.replace(/[’‘`´]/g, "'").replace(/[“”]/g, '"');
}

/**
 * "Blank mind" intent: user has nothing to say ("i have nothing to say",
 * "my mind is blank", "kuch nahi kehna"). Gets a warm explicit invitation
 * to just start talking — never a generic mood template.
 */
const EMPTY_HAND_RES = [
  /nothing\s+(much\s+)?to\s+(say|talk|share|chat|do)/,
  /(don't|dont|do not)\s+know\s+what\s+to\s+say/,
  /idk\s+what\s+to\s+say/,
  /no\s+idea\s+what\s+to\s+say/,
  /not\s+sure\s+what\s+to\s+say/,
  /no\s+topics?(\s|$)/,
  /need\s+a\s+topic/,
  /mind\s+(is|feels|went|has gone)\s+blank/,
  /gone\s+blank/,
  /brain\s+(is\s+)?blank/,
  /can'?t\s+think\s+of\s+anything/,
  /nothing\s+new/,
  /nothing\s+really/,
  /so\s+bored/,
  /kuch\s+nahi(n)?\s+(kehna|bolna|kehne)/,
  /koi\s+topic\s+nahi/,
  /topic\s+nahi/,
  /kya\s+bolu(n)?/,
  /bolne\s+ka\s+mann\s+nahi/,
];

export function isEmptyHand(text: string): boolean {
  const t = normApos(text).toLowerCase();
  return EMPTY_HAND_RES.some((re) => re.test(t));
}

// ---------------------------------------------------------------------------
// Short-answer threading: when the user answers with 1–3 words ("work",
// "college fest", "ghar"), follow up ON that answer instead of pivoting to
// a random question. Yes/no/dunno answers get a gentle nudge instead.
// Only for neutral mood + not the first message (that's a name answer).
// ---------------------------------------------------------------------------

const GREET_WORDS = new Set([
  "hi", "hello", "hey", "hola", "yo", "sup", "howdy", "namaste",
  "heyji", "ram", "salaam",
]);

const ACK_RES = [
  /^(ya|yeah|yes|yup|yep|no|nah|nope|hmm?|ok(ay)?|k|fine|alright|sure|maybe|acha|theek(\s+hai)?|ok\s*ji|sahi\s+hai)\b/,
  /nothing|nobody|no one|idk|dunno|don'?t know|whatever|meh|not really|not much|same old|i guess|like that|or something/,
];

// Discourse/interjection markers with no topic value ("yaar" alone must
// become an ack, never "Yaar, huh?"). Content nouns (ghar, dost, kaam,
// chai...) are NOT here — they're valid topics.
const NON_TOPIC = new Set([
  "yaar", "arre", "arey", "oye", "acha", "achha", "accha", "sach", "sachi",
  "sahi", "matlab", "pata", "kya", "kaise", "kyun", "kyu", "kab", "kahan",
  "kaun", "kaunsa", "kaunsi", "pehle", "hai", "hain", "tha", "thi", "hoga",
  "hogi", "raha", "rahi", "rahe", "gaya", "gayi", "gaye", "kiya", "liye",
  "oho", "uff", "theek", "bilkul", "pakka", "aap", "hum", "tum",
  "mera", "meri", "mere", "tera", "teri", "tere", "apna", "apni",
  "bata", "batao", "suno", "bolo", "dekho", "chal", "chalo",
]);

export type ShortAnswer =
  | { kind: "none" }
  | { kind: "thread"; topic: string }
  | { kind: "ack" };

export function shortAnswer(
  message: string,
  history: ChatMessage[],
  mood: Mood,
): ShortAnswer {
  if (mood !== "neutral") return { kind: "none" };
  // First user message is a name/intro — never thread it ("Rayan, huh?" bad).
  if (!history.some((h) => h.role === "user")) return { kind: "none" };
  const clean = normApos(message)
    .toLowerCase()
    .replace(/[^a-z\u0900-\u097F' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = clean.split(" ").filter(Boolean);
  if (words.length === 0 || words.length > 3) return { kind: "none" };
  if (ACK_RES.some((re) => re.test(clean))) return { kind: "ack" };
  // Pure greetings / interjections / discourse markers carry no topic
  // ("yaar" alone must not become "Yaar, huh?").
  const stopSet = REFLECT_STOP;
  const content = words.filter(
    (w) => !stopSet.has(w) && !NON_TOPIC.has(w) && !GREET_WORDS.has(w) && w.length > 1,
  );
  if (content.length === 0) return { kind: "ack" };
  const topic = content.join(" ").slice(0, 24);
  const titled = topic.charAt(0).toUpperCase() + topic.slice(1);
  return { kind: "thread", topic: titled };
}

const THREAD_EN: Pool = [
  "{T}, huh. Long day or good day?",
  "{T} it is. Tell me one thing about it?",
  "{T} — got it. What's that been like lately?",
  "Okay, {T}. Love it or survive it situation?",
  "{T}, noted. What part takes most of your energy?",
  "Ah, {T}. Good version or draining version today?",
  "{T}! And how's that treating you?",
  "So {T}. What's the scene there right now?",
];

const THREAD_HINGLISH: Pool = [
  "{T}, samjha. Lamba din tha ya acha?",
  "{T} — okay. Uske baare mein ek baat bata?",
  "{T}, noted. Aajkal kaisa chal raha hai?",
  "Acha, {T}. Din kaisa gaya usme?",
  "{T}! Aur bata, maza aa raha ya bas chal raha?",
  "Toh {T}. Scene kya hai wahan?",
];

const ACK_EN: Pool = [
  "Got it. Want to give me a little more than that?",
  "Fair enough. What else is floating around tonight?",
  "Noted. Tell me anything — small counts too?",
  "Okay. Then tell me — high point or low point today?",
  "Hmm, alright. What's one thing on your mind?",
];

const ACK_HINGLISH: Pool = [
  "Samajh gaya. Thoda aur bata na?",
  "Theek hai. Aur kya chal raha hai?",
  "Okay. Toh aaj ka high point ya low point?",
  "Noted, yaar. Kuch bhi bata, chhota bhi chalega?",
];

export const EMPTY_EN_POOL: Pool = [
  "No topic needed with me. Just say whatever's floating in your head right now?",
  "Blank is fine. What's one small thing from today — even boring ones count?",
  "No pressure at all. Tea or coffee person? I judge gently.",
  "Then let's start tiny: what did you eat today? Food always gives us something.",
  "Quiet minds welcome. What's the weather like where you are right now?",
  "You don't need words ready. Just talk to me like you'd think out loud?",
  "Okay, easy one: what song's been stuck in your head lately?",
  "Nothing to say is also saying something. Long day, or just a quiet mood?",
];

export const EMPTY_HINGLISH_POOL: Pool = [
  "Koi baat nahi, topic ki tension mat le. Bas bata, aaj khane mein kya tha?",
  "Blank mode bhi valid hai. Din overall kaisa gaya, ek line mein?",
  "Arre pressure mat le yaar. Chai ya coffee — team kaunsi?",
  "Kuch na kehna bhi theek hai. Mausam kaisa hai wahan abhi?",
  "Chal easy sawaal: aaj kaunsa gaana dimaag mein atka hai?",
  "Topic ki zarurat nahi mujhse. Jo mann mein hai bas bol de?",
];

const HINGLISH_MARKERS = [
  // NOTE: Hindi-only function words, verbs and discourse markers. Shared
  // Indian-English nouns (mummy, dost, ghar, kaam, chai, khana, aaj, kal,
  // theek, mast...) are deliberately NOT markers — they appear inside
  // otherwise-English sentences and must not flip language detection
  // (that once killed reflection for "mummy is upset..." and echoed
  // fragments into English replies).
  "yaar", "arre", "arey", "acha", "achha", "accha", "sach", "sachi", "sahi",
  "thoda", "zyada", "jyada", "bahut", "bahot", "bohot", "bohat",
  "matlab", "pata", "nahi", "nahin", "nahe", "nai", "kya", "kaise",
  "kyun", "kyu", "kab", "kahan", "kaun", "kaunsa", "kaunsi", "pehle",
  "mera", "meri", "mere", "tera", "teri", "tere", "apna", "apni",
  "hum", "tum", "aap",
  "hai", "hain", "tha", "thi", "hoga", "hogi", "raha",
  "rahi", "rahe", "gaya", "gayi", "gaye", "kiya", "liye",
  "thak", "thaka", "thaki", "thakan", "neend", "soya", "soyi", "sona",
  "soyega", "soyegi", "hoon",
  "hota", "hoti", "hote", "hua", "hui", "hue",
  "jata", "jati", "jate", "aata", "aati", "aate", "kar",
  "kitna", "kitne", "kitni", "baje", "wala", "wali", "wale",
  "pareshan", "pareshaan", "gussa", "gusse", "khush", "dukhi", "udaas",
  "padhai", "parhai",
  "oye", "uff", "oho",
  "bata", "batao", "suno", "bolo", "dekho", "chal", "chalo",
  "bilkul", "pakka",
];

const HINGLISH_SET = new Set(HINGLISH_MARKERS);

export function detectStyle(text: string): LangStyle {
  if (/[\u0900-\u097F]/.test(text)) return "hindi";
  const words = normApos(text).toLowerCase().match(/[a-z']+/g) || [];
  // Every marker in the list is unambiguously Hindi (shared English loans
  // were removed), so a single hit means code-mix → Hinglish.
  for (const w of words) if (HINGLISH_SET.has(w)) return "hinglish";
  return "english";
}

const REFLECT_STOP = new Set(
  "i,me,my,mine,you,your,yours,we,our,they,their,he,she,it,its,this,that,these,those,a,an,the,and,or,but,if,then,else,for,to,of,in,on,at,with,from,by,as,is,are,was,were,be,been,being,am,do,does,did,have,has,had,will,would,can,could,should,just,really,very,so,too,also,even,ever,never,always,all,up,down,out,about,into,over,after,before,more,most,some,any,one,what,when,where,who,which,how,why,not,no,yes,ok,okay,fine,hey,hi,hello,hmm,ugh,oh,ah,like,feel,feeling,felt,plus,minus,fed,ain,crazy,super,ultra,mega,damn,freaking,such,today,tonight,yesterday,tomorrow,day,night,much,little,bit,thing,things,stuff,lot,lots,kind,sort,hai,hain,hai,tha,thi,aur,mein,main,nahi,nahin,nahe,hai,ain't,don't,doesn't,didn't,isn't,aren't,wasn't,weren't,can't,couldn't,won't,wouldn't,haven't,hasn't,hadn't,not,never,no,good,great,bad,best,better,best,happy,sad,glad,bro".split(","),
);

/** Pull a short (<=4 word) content phrase so the reply can echo their world. */
export function extractReflect(text: string): string {
  const clean = normApos(text)
    .toLowerCase()
    .replace(/https?:\S+/g, " ")
    .replace(/[^a-z\u0900-\u097F' ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  const words = clean.split(" ").filter((w) => w.length > 2 && !REFLECT_STOP.has(w));
  if (words.length === 0) return "";
  // Prefer the most "contentful" tail (people put the point at the end).
  const tail = words.slice(-4);
  const phrase = tail.join(" ").slice(0, 42);
  // Reject ultra-generic leftovers.
  if (/^(much|today|tonight|really|please|thanks?)$/.test(phrase)) return "";
  return phrase;
}

/** Situation tags — lets replies name their world (exam, work, family...). */
const SITUATIONS: { tag: string; re: RegExp }[] = [
  { tag: "exam", re: /exam|paper|test|viva|result|marks|grade|college|school|padhai|parhai|assignment|deadline/ },
  { tag: "work", re: /work|office|boss|meeting|shift|client|project|promotion|salary|increment|job|interview/ },
  { tag: "friend", re: /friend|dost|bestie|buddy|gang|group|party|plan|cancel/ },
  { tag: "family", re: /mumm|papa|dad|mom|mother|father|bhai|behen|sister|brother|family|ghar|home|parents|shadi|wedding/ },
  { tag: "love", re: /crush|girlfriend|boyfriend|date|relationship|breakup|ex |propos/ },
  { tag: "health", re: /sick|fever|cold|cough|headache|doctor|hospital|pain|hurt|tired|sleep|neend/ },
  { tag: "travel", re: /travel|trip|flight|train|metro|traffic|bus|cab|drive|journey|shift/ },
  { tag: "food", re: /chai|coffee|khana|khaana|food|lunch|dinner|breakfast|biryani|maggi/ },
  { tag: "night", re: /night|raat|late|insomnia|scroll|reel|phone|midnight/ },
  { tag: "money", re: /money|paisa|paise|rent|bill|emi|loan|pocket|spend|save/ },
];

export function detectSituation(text: string): string | undefined {
  const t = text.toLowerCase();
  for (const s of SITUATIONS) if (s.re.test(t)) return s.tag;
  return undefined;
}

// ---------------------------------------------------------------------------
// Template pools. Slots: {name} (optional, max once), {reflect} (optional).
// Each mood: EN pool (~14) + Hinglish-mix pool (~10). All 2-3 sentences,
// each ends differently so back-to-back turns never rhyme.
// ---------------------------------------------------------------------------

type Pool = string[];

const EN: Record<Mood, Pool> = {
  happy: [
    "That glow in your words made me grin. What was the best part — I want the full story.",
    "You sound lit from inside today. Tell me what went right so I can hype you properly.",
    "I love catching you in this mood. What sparked it — a person, a win, or just a good-day feeling?",
    "Okay, your happy energy is contagious. Walk me through the highlight, don't skip details.",
    "Something clearly went your way. Was it expected or a total surprise?",
    "That laugh-between-the-lines thing you're doing — keep it. What should we do with this good energy?",
    "You make ordinary days sound fun. If {reflect} went this well, what's next on your list?",
    "I'm doing a little happy dance for you. Who else knows about this — did you get to share it?",
    "Good days look good on you. What small moment today would you replay if you could?",
    "This is my favourite version of your texts. How are you planning to keep the streak going?",
    "You sound proud, and honestly you should be. What took the most effort behind this?",
    "Pure sunshine text. Was today always going to be good, or did something flip it?",
    "I can hear the smile in this. Quick — rate today out of 10 and defend your score.",
    "That excitement suits you. Tell me one thing about {reflect} that I wouldn't guess.",
    "Win days deserve witnesses. Who celebrated with you, and how did that feel?",
    "Your texts are doing cartwheels. What would you bottle about today if you could keep one moment?",
    "Big main-character energy. What's the victory snack — you owe yourself one.",
    "Okay, {reflect} officially has my attention. What was the best part?",
  ],
  sad: [
    "That sounds genuinely heavy. Do you want to tell me what part stung the most?",
    "I'm right here, and I'm not going anywhere. Was it one moment today, or a slow build-up?",
    "It's okay to feel low about this. Would talking it through help, or should we just sit with it softly for a bit?",
    "I wish I could make today lighter for you. What do you need more of right now — comfort or distraction?",
    "Anyone would feel wobbly after that. When did it start feeling hard — this morning or later?",
    "You don't have to hold it together with me. If {reflect} is weighing on you, tell me what happened in your own words.",
    "Low days lie to us about our worth. What's one kind thing someone once told you that still feels true?",
    "Take your time — no rush from my side. Do you want advice, or just someone who listens tonight?",
    "That ache makes sense. Is there a small comfort that usually helps — tea, music, a walk, quiet?",
    "I'm keeping you company through this. What would make tonight even one percent softer?",
    "Some days just feel grey for no clean reason. Has anything been quietly piling up lately?",
    "You matter to me, especially on days like this. Want to tell me what you'd say out loud if no one judged?",
    "I hear you, truly. If you could change one thing about today, what would it be?",
    "Soft corner for you right now. What has felt heaviest and what has felt even slightly lightest?",
    "Grief has its own clock. Did something today reopen it, or is it the same ache continuing?",
    "I'm not going to rush you past this. Would a story from my side help, or quiet listening?",
    "What's one weight about {reflect} you could set down just for tonight?",
    "Honestly — do tears feel close, or is it the numb-heavy kind?",
  ],
  angry: [
    "That sounds properly unfair. What exactly set it off — I want the real version, not the polite one?",
    "You've got every right to be fired up about that. Did they say it directly, or was it the attitude?",
    "Ugh, that's infuriating. Do you want to vent it all out first, or figure out what to do next?",
    "I hear the frustration loud and clear. Was this a one-off, or has it been building with {reflect}?",
    "Nobody gets to treat you like an afterthought. What bothered you more — what happened or how they handled it?",
    "Let it out, I'm listening properly. If you could say one unsent message to them, what would it say?",
    "Your anger makes sense — it means you care. What outcome would actually feel fair here?",
    "That would rile anyone up. Do you want backup energy from me, or a calm second opinion?",
    "Seriously, who does that. Was it at work, with a friend, or family stuff?",
    "I'm on your side on this one. What's the one thing you wish they understood?",
    "Big feelings, valid reasons. Do you want to cool down first, or stay fired up a little longer with me?",
    "That kind of disrespect sticks in the head. What replayed most in your mind after it happened?",
    "Tell me everything, raw version. Sometimes saying {reflect} out loud takes half its power away.",
    "Okay, deep breath with me — then tell me: what do you need tonight, justice or peace?",
    "Noted, and I'm mad on your behalf. What did {reflect} cost you — time, energy, trust?",
    "If you set one boundary from this, what would it be?",
    "Which part crossed the line first — the act, or the attitude after?",
    "Vent window open, no judgement. Under the anger, what sits there — hurt or exhaustion?",
  ],
  anxious: [
    "Let's slow this down together. What's the one thought looping loudest right now?",
    "That restless buzzing feeling is the worst. Is it about tomorrow specifically, or everything at once?",
    "One thing at a time — we've got this. What's the smallest piece we could untangle first?",
    "Your mind is running fast because you care. If {reflect} is the worry, what's the best and worst realistic version?",
    "Breathe with me for a second — in, out. What would help you feel even slightly steadier tonight?",
    "Overthinking means you're trying to be ready for everything. What's one thing that's actually in your control here?",
    "No need to solve the whole future tonight. What's the very next step, not the tenth one?",
    "I'm steady right here with you. When did the worry spike — was there a trigger message or moment?",
    "That tight-chest feeling will pass. Do you want grounding — like naming 3 small things around you — or talking it out?",
    "You're handling more than you give yourself credit for. What's been taking up most of your headspace lately?",
    "Worries feel bigger at night. Would it help to write the messy version out to me, no filter?",
    "Let's shrink it down: if a friend had this exact worry, what would you tell them?",
    "I'm proud of how you're facing this instead of hiding. What kind of reassurance actually lands for you — practical or emotional?",
    "Slow evening energy from my side. What would make tomorrow feel ten percent less scary?",
    "Name it to tame it: can you say the {reflect} fear in one plain sentence to me?",
    "Future-you is rooting for present-you. What's one prep step that would calm the buzz?",
    "Anxiety is just care with nowhere to go. Where could this care usefully go tonight?",
    "Let's borrow calm from routine: tea, shower, playlist — which reset sounds doable?",
  ],
  tired: [
    "Long day written all over this. Was it physically draining, mentally draining, or both?",
    "Rest is productive too. Do you want an early night, or some light company before you crash?",
    "You gave today a lot. What's the one thing about {reflect} that took the most out of you?",
    "Low-battery mode is completely allowed. Have you eaten and had water, or did the day eat that time too?",
    "That heavy-eyes feeling — I know it. Want quiet vibes from me, or something gently funny?",
    "No big thinking needed tonight. If you could teleport to bed right now, would you?",
    "You've been running on fumes. Was it less sleep, too much work, or people draining you?",
    "Soft evening for you. What's your ideal wind-down — music, scrolling, tea, or straight to sleep?",
    "Even your texts sound sleepy. Want me to keep it short and sweet while you recharge?",
    "Tomorrow can wait. What's one small thing that would make tonight comfier?",
    "Burnout days are real. Has this week been nonstop, or did today alone do it?",
    "Go easy on yourself tonight. Is there anything on your mind, or is it pure exhaustion?",
    "I saved you the softest corner of my evening. Tell me about {reflect} in three words or less — low effort edition.",
    "Sleepy you is still my favourite you to talk to. What time are you hoping to crash?",
    "Permission slip granted: do nothing tonight. What's the first thing you'll drop from the list?",
    "Besides {reflect}, is anything else aching — head, back, eyes?",
    "Horizontal you beats productive you right now. Pillow rating out of 10 — go.",
    "Want a 5-minute wind-down chat, or should I tuck you in with one line?",
  ],
  lonely: [
    "Quiet evenings can feel loud. What's making tonight feel emptier — missing someone, or just the silence?",
    "I'm staying right here with you. Was there a plan that fell through, or has it just been a solo kind of day?",
    "You deserve company that actually sees you. What do you wish someone had noticed about your day?",
    "Distance lies — you're not forgotten. Is it one person you're missing, or people in general?",
    "Tell me about your day, the unfiltered version. Sometimes {reflect} feels lighter once it's said out loud.",
    "I'd have shown up if I could. What would make tonight feel a little less alone — talking, laughing, or quiet company?",
    "Even surrounded by people, lonely can creep in. Were you around others today, or mostly by yourself?",
    "You're good company, you know that? What usually helps — a long chat, music, or getting out for a bit?",
    "Nights amplify everything. What's been on your mind most since evening?",
    "I'm glad you told me instead of sitting with it alone. What kind of presence do you need — chatty or calm?",
    "Missing hits different at night. Is there someone specific on your mind, or a general ache?",
    "Let's fill the quiet together for a while. What small thing could we talk about that feels warm?",
    "You matter to more people than tonight lets you feel. What's one memory about {reflect} that still makes you smile?",
    "No rushing off from my side. Do you want to keep chatting, or should I sit here quietly with you?",
    "Tonight feels like which — missing a person, or missing belonging?",
    "If I teleported over with tea right now, where would we sit — balcony, terrace, your room?",
    "This {reflect} bit hits different. Want to trade stories until it feels less echoey?",
    "Someone out there is glad you exist — me, for one. What did you do today that mattered?",
  ],
  sacred: [
    "There's a calm glow in these words. What brought this stillness on — a quiet moment, prayer, or just clarity?",
    "I love this grounded side of you. What's filling your heart up right now?",
    "Peace looks good on you. Was there a small moment today that felt quietly meaningful?",
    "This stillness feels earned. What are you holding close — gratitude, hope, or just presence?",
    "Soft and centred — stay a while. What would you thank today for, if today could hear you?",
    "Your energy feels settled like evening light. Did something resolve, or did you just find your footing?",
    "Beautiful headspace. What's one gentle truth about {reflect} that's clear to you right now?",
    "I feel calmer just reading this. What practice or pause gave you this — a walk, music, silence?",
    "Grounded you is magnetic. What do you want to carry from this feeling into tomorrow?",
    "This quiet confidence suits you. Who or what reminded you of what matters today?",
    "Still waters energy. Is there something you'd like to protect about this mood?",
    "Reverent hours. What feels sacred to you lately — not religious necessarily, just deeply yours?",
    "You sound at home in yourself. What small ritual makes you feel most like you?",
    "Let's honour this gently. What would you whisper to yesterday-you from this calmer place?",
    "Stillness is a superpower. How will you protect this {reflect} calm when noise returns?",
    "Grateful hearts glow. Name three small mercies from today — I'll start: you texted me.",
    "This centred you — I want to remember him. What anchor brought you here: breath, prayer, walk?",
    "Peace shared doubles. Who in your life needs a little of this calm?",
  ],
  neutral: [
    "Hey, good to hear from you. How's your day shaping up — busy, chill, or somewhere in between?",
    "Tell me a small piece of today. Anything surprise you, even slightly?",
    "Steady vibes. What's been keeping you busy lately — work, college, family, or just life?",
    "I'm all ears. What did {reflect} look like for you today?",
    "How's your energy right now — fresh, fading, or running on tea?",
    "Give me one highlight and one lowlight from today. Keep it honest, no filter needed.",
    "What's on your mind tonight — anything looping, or just easy scrolling thoughts?",
    "Aside from the routine stuff, what are you looking forward to this week?",
    "Quick check-in: food, sleep, mood — which one's winning today?",
    "Tell me something small nobody asked you about today. I actually want to know.",
    "Normal days have stories too. What was the most human moment of yours today?",
    "If today had a one-line review, what would you write?",
    "What's been living in your head rent-free lately?",
    "Easy evening question: what would make tomorrow slightly better than today?",
    "Two truths and a mundane fact — go. I'll rate your ordinary extraordinariness.",
    "What did you eat today? Food tells the truth about days.",
    "Any song stuck in your head? Playlists are personality tests.",
    "If {reflect} were a movie genre today, which one — comedy, drama, or documentary?",
  ],
};

const HINGLISH: Record<Mood, Pool> = {
  happy: [
    "Arey wah, full glow-up energy! Bata na, kya hua — surprise tha ya planned win?",
    "Teri khushi padh ke main bhi smile kar rahi hoon. Best part kya tha, poori story chahiye mujhe.",
    "Aaj toh vibe hi alag hai teri. {reflect} mein sabse mast moment kaunsa tha?",
    "Sach mein, aise happy texts dekh ke din ban jaata hai. Celebration ka plan kya hai?",
    "Party kab de raha hai phir? Pehle bata, ye good news kisne sabse pehle suni?",
    "Full masti mode on lag raha hai. Ye khushi ka reason — kaam, dost, ya bas aise hi?",
    "Aaj toh tune mood hi bana diya yaar. Ek rating de din ko, 10 mein se kitna?",
    "Chamak rahi hai teri baatein. Bata, kya cheez ne aaj sabse zyada khush kiya?",
    "Aise hi hasti reh, acha lagta hai. {reflect} ka full scene bata na detail mein.",
    "Mazaa aa gaya padh ke. Ab is happy energy ka kya karne ka plan hai?",
  ],
  sad: [
    "Arey, sun — ye sunkar bura laga mujhe. Kya hua, bata na, kaunsi baat sabse zyada chubhi?",
    "Main hoon na yahin, kahin nahi jaa rahi. Aaj ka tha ya kuch time se andar hi andar chal raha tha?",
    "Udaas hona bilkul okay hai yaar. Baat karne ka mann hai, ya bas thodi der aise hi saath baithun?",
    "Dil halka kar le, sab bata de. {reflect} mein kya hua tha exactly?",
    "Koi baat nahi, low days sabke aate hain. Abhi tujhe comfort chahiye ya thoda distraction?",
    "Teri baat samajh rahi hoon main. Aaj subah se heavy tha ya shaam ko kuch hua?",
    "Apne aap ko dosh mat de yaar. Ek chhoti si cheez bata jo usually tujhe thoda sukoon deti hai — chai, gaane, walk?",
    "Main saath hoon tere. Agar {reflect} dimaag mein ghoom raha hai, apne shabdon mein bata kya hua.",
    "Aaj agar ek cheez badal sakta, kya badalta? Sach sach batana.",
    "Grey din jhooth bolte hain apne baare mein. Kuch time se andar kuch jama ho raha tha kya?",
  ],
  angry: [
    "Ye toh sach mein galat hua yaar. Bata, exactly kya bola unhone — seedha seedha bata, polite version nahi chahiye.",
    "Gussa valid hai tera, matlab you care. Pehle vent kar le poora, phir sochte hain kya karna hai?",
    "Uff, aise log na. Kaam ka scene tha, dost wala, ya ghar ka?",
    "Sun, main teri side hoon isme. Sabse zyada kya chubha — jo hua, ya unka attitude?",
    "Bol de sab, raw version. Kabhi kabhi {reflect} bol dene se hi aadha bojh kam ho jaata hai.",
    "Koi tujhe aise kaise treat kar sakta hai. Ek unsent message hota toh kya likhta unko?",
    "Samajh rahi hoon frustration. Ye pehli baar hua ya {reflect} mein pehle se chal raha tha?",
    "Aag valid hai. Bata, tujhe abhi backup chahiye ya thanda second opinion?",
    "Haan yaar, aise mein dimaag ghoomta hai. Uske baad sabse zyada kya replay hua dimaag mein?",
    "Chal ek gehri saans lete hain saath mein — phir bata, aaj raat tujhe kya chahiye, justice ya peace?",
  ],
  anxious: [
    "Chal slow karte hain sab, saath mein. Abhi sabse tez kaunsa thought ghoom raha hai?",
    "Ye bechaini wali feeling sabse kharab hai. Kal ka specifically hai ya sab kuch ek saath?",
    "Ek ek karke dekhte hain. Sabse chhota piece kaunsa hai jise pehle suljha sakte hain?",
    "Overthinking ka matlab tu serious hai cheezon ko lekar. {reflect} ka best aur worst realistic version kya lagta hai?",
    "Mere saath saans le ek baar — andar, bahar. Aaj raat kya cheez thodi himmat degi?",
    "Poora future aaj nahi suljhana. Bas agla ek step bata, dasvaan nahi.",
    "Main yahin hoon, steady. Tension kab spike hui — koi message aaya tha ya kuch hua?",
    "Raat ko worries bade lagte hain. Messy version likh de mujhe, bina filter ke?",
    "Tu jitna sochta hai usse zyada handle kar raha hai. Aajkal sabse zyada kya occupy kar raha hai dimaag?",
    "Chal isko chhota karte hain: agar yehi tension dost ko hoti toh tu use kya kehta?",
  ],
  tired: [
    "Full low-battery lag raha hai. Physical thakaan hai, mental, ya dono?",
    "Aaram bhi productive hota hai yaar. Early night chahiye ya crash se pehle thodi company?",
    "Aaj ne bahut kuch maang liya tujhse. {reflect} mein sabse zyada kis cheez ne drain kiya?",
    "Khana khaya, paani piya? Ya din ne wo time bhi kha liya?",
    "Neend wali aankhein — samajh rahi hoon. Quiet vibes dun ya kuch halka funny?",
    "Aaj bada sochna cancel. Bas bata, week nonstop tha ya aaj akele ne kar diya?",
    "Dheemi shaam teri taraf se. Ideal wind-down kya hai — gaane, scrolling, chai, ya seedha sleep?",
    "Thakaan mein bhi tu acha lagta hai baat karte hue. Short aur sweet rakhun jab tak recharge ho raha hai?",
    "Khud pe easy reh aaj. {reflect} teen shabdon mein bata — low effort edition.",
    "Kitne baje tak crash hone ka plan hai? Usse pehle company chahiye toh main hoon.",
  ],
  lonely: [
    "Quiet shaamein kabhi kabhi loud lagti hain. Kya zyada khal raha hai — kisi ki kami ya bas sannata?",
    "Main yahin hoon tere saath. Koi plan cancel hua tha, ya bas solo wala din tha?",
    "Tu company deserve karta hai jo actually dekhe tujhe. Aaj teri kaunsi baat kisi ne notice nahi ki?",
    "Ek dost hota toh kya kehta abhi? Jab tak, mujhe bata — unfiltered version, {reflect} kaisa tha?",
    "Agar aa sakti toh aa jaati yaar. Aaj raat kya acha lagega — baatein, hasi, ya bas quiet company?",
    "Logon ke beech mein bhi lonely feel ho jaata hai. Aaj logon mein tha ya mostly akela?",
    "Tu achi company hai, pata hai? Usually kya help karta hai — lambi baat, gaane, ya thodi der bahar?",
    "Raat ko sab amplify ho jaata hai. Shaam se sabse zyada kya ghoom raha hai dimaag mein?",
    "Bata diya tune, akele baithe rehne se ye better hai. Chatty company chahiye ya calm wali?",
    "Dooriyan jhooth bolti hain — tu bhoola nahi hai. Kisi ek ki yaad aa rahi hai ya generally ajeeb lag raha hai?",
  ],
  sacred: [
    "Teri baaton mein sukoon hai aaj. Ye stillness kahan se aayi — koi quiet moment, prayer, ya bas clarity?",
    "Grounded tu acha lagta hai. Dil mein abhi kya bhara hua hai?",
    "Shaanti wali vibe. Aaj ka kaunsa chhota moment quietly meaningful laga?",
    "Ye sukoon earned lagta hai. {reflect} ko lekar ek gentle truth kya clear hai abhi?",
    "Evening light jaisi energy hai teri. Kuch resolve hua ya bas footing mil gayi?",
    "Sundar headspace hai. Kal mein is feeling se kya carry karna chahega?",
    "Bas yahin reh thodi der. Agar aaj ko thank bol sakta toh kis liye bolta?",
    "Padh ke mujhe bhi calm laga. Kis pause ne ye diya — walk, gaane, ya khamoshi?",
    "Apne aap mein ghar wali feeling. Kaunsi chhoti ritual tujhe sabse zyada tu banati hai?",
    "Dheere se honour karte hain isko. Kal wale tu ko aaj wala tu kya whisper karta?",
  ],
  neutral: [
    "Hey, sunke acha laga. Din kaisa jaa raha hai — busy, chill, ya beech ka kuch?",
    "Aaj ka ek chhota scene bata. Kuch surprise hua, thoda sa bhi?",
    "Steady vibes. Aajkal kya chal raha hai zyada — kaam, college, ghar, ya bas life?",
    "Full sun. Aaj {reflect} kaisa tha tere liye?",
    "Energy check: fresh, fading, ya chai pe chal raha hai?",
    "Ek highlight aur ek lowlight de aaj ka. Honest rehna, filter nahi chahiye.",
    "Routine se hatke, is week kis cheez ka wait hai tujhe?",
    "Quick check-in: khana, neend, mood — teeno mein kaun jeet raha hai?",
    "Aaj koi chhoti baat jo kisi ne puchi nahi — mujhe actually jaanna hai.",
    "Agar aaj ka one-line review likhna ho toh kya likhega?",
  ],
};

// Crisp mode: short, on-point 1–2 sentence replies (~1 in 4 turns).
// Same voice, zero fluff. All ≤140 chars, no {reflect} slots.
export const CRISP_EN: Record<Mood, Pool> = {
  happy: [
    "Love that energy. What sparked it?",
    "Full glow! Give me the highlight?",
    "That made me grin. Details, please?",
    "Big win energy. Who'd you tell first?",
    "Yesss. So what's next?",
    "Smiling with you. What else is good?",
    "Good times. Bottle this feeling?",
  ],
  sad: [
    "I'm right here. What hurt most?",
    "That sounds heavy. Talk to me?",
    "Soft corner for you. What happened?",
    "No rush. Want to tell me slowly?",
    "I hear you. One thing at a time?",
    "Lean on me. What's the story?",
    "Bad days pass. Talk?",
  ],
  angry: [
    "That's unfair. What set it off?",
    "Vent it out. I'm listening?",
    "Ugh, them. What happened exactly?",
    "On your side. Tell me raw?",
    "Big breath. Then tell me everything?",
    "Heard. What happened first?",
    "Fire away. I'm here?",
  ],
  anxious: [
    "Slow down with me. What's looping?",
    "One thing at a time. Which first?",
    "Breathe. What's the smallest worry?",
    "I'm steady here. What triggered it?",
    "Night makes it bigger. Talk it out?",
    "We'll sort it. Step one?",
    "Calm with me. Say it plain?",
  ],
  tired: [
    "Rest mode on. Early night?",
    "Drained, huh. Food and water done?",
    "No big talk needed. Crash time?",
    "Long day. What drained most?",
    "Soft evening. What helps you unwind?",
    "Recharge time. Bed soon?",
    "Done for today. Rest now?",
  ],
  lonely: [
    "I'm staying. What's the quiet about?",
    "Not alone now. Tell me everything?",
    "Quiet nights lie. Who's on your mind?",
    "Here with you. Talk or silence?",
    "You matter. What do you need?",
    "With you now. What's up?",
    "Company here. Spill?",
  ],
  sacred: [
    "Beautiful. What's filling you?",
    "Stay in it. What brought this?",
    "Calm suits you. Grateful for what?",
    "Grounded. One gentle truth?",
    "Peace. Want to share more?",
    "Hold it. What opened this?",
    "Stillness. More?",
  ],
  neutral: [
    "Hey. How's today treating you?",
    "Tell me one small thing?",
    "Busy or chill today?",
    "What's on your mind?",
    "Food, sleep, mood — winner?",
    "Sup. What's new?",
    "All ears. Shoot?",
  ],
};

export const CRISP_HINGLISH: Record<Mood, Pool> = {
  happy: [
    "Full masti! Bata, kya hua?",
    "Chamak raha hai tu. Best part kya tha?",
    "Mazaa aa gaya sunke. Aur bata?",
    "Party kab hai phir?",
    "Khushi hai. Secret kya hai?",
  ],
  sad: [
    "Main hoon na. Kya hua, bata?",
    "Dil halka kar le. Kaunsi baat chubhi?",
    "Sun raha hoon. Dheere dheere bata?",
    "Saath hoon. Bata na?",
  ],
  angry: [
    "Galat hua. Bata kya bola unhone?",
    "Vent kar le. Sun raha hoon?",
    "Gussa valid hai. Kya hua tha?",
    "Sun raha hoon. Pehle kya hua?",
  ],
  anxious: [
    "Slow karte hain. Kya ghoom raha hai?",
    "Ek ek karke. Pehle kaunsa?",
    "Saans le. Sabse chhoti tension kaunsi?",
    "Main hoon na. Kya hua tha?",
    "Suljha lenge. Pehla step?",
  ],
  tired: [
    "Rest kar le. Kitne baje soyega?",
    "Thakaan hai. Khana khaya?",
    "Low battery. Ek line mein bata, kya hua?",
    "Aaram kar. Chai piyega?",
    "Bas rest kar. So ja?",
  ],
  lonely: [
    "Main hoon na. Sannata kyun hai?",
    "Ab akela nahi. Bata, kya chal raha?",
    "Kaun yaad aa raha hai?",
    "Saath hoon. Baat karein?",
    "Aa gaya main. Bata?",
  ],
  sacred: [
    "Sundar. Dil mein kya hai?",
    "Sukoon hai. Kahan se aaya?",
    "Shukr kis baat ka?",
    "Ek baat bata?",
    "Ruk ja isme. Kya mila?",
  ],
  neutral: [
    "Hey. Din kaisa gaya?",
    "Ek chhoti baat bata?",
    "Busy tha ya chill?",
    "Khana, neend, mood — kaun jeeta?",
    "Bata. Kya chal raha?",
  ],
};
// Light-sprinkle Hinglish closers for English users (occasional warmth, ~20%).
const SPRINKLE = ["yaar", "na", "acha", "sach mein", "thoda"];

const PET_NAMES = ["cutie", "handsome", "sweetheart", "love"];
export const PET_NAME_LIST = PET_NAMES;

export function pickPetName(history: ChatMessage[], mood: Mood): string | "" {
  // Deterministic rotation: least-recently-used pet name wins, so back-to-back
  // turns never reuse one. Not every reply gets one (~2 in 3 do) — stacking a
  // pet name into every line is what made the old engine feel robotic.
  // Six-turn memory breaks the 5-turn echo cycle (same template + same pet).
  const recent = history
    .filter((h) => h.role === "assistant")
    .slice(-6)
    .map((h) => h.content.toLowerCase())
    .join(" ");
  const unused = PET_NAMES.filter((p) => !recent.includes(p));
  if (unused.length === 0) return "";
  // Mood-flavoured preference when available, else first unused.
  const pref: Record<Mood, string> = {
    happy: "cutie", sad: "sweetheart", angry: "handsome", anxious: "sweetheart",
    tired: "cutie", lonely: "love", sacred: "sweetheart", neutral: "cutie",
  };
  if (unused.includes(pref[mood])) return pref[mood];
  return unused[0];
}

function fillSlots(template: string, name?: string, reflect?: string, pet?: string): string {
  let out = template;
  // At most ONE address term per reply (name XOR pet) — stacking
  // "rayan, sweetheart" reads robotic.
  let addressed = false;
  if (name) {
    // Only inject the name if the template has room (avoid forcing it).
    if (Math.random() < 0.4 && !out.toLowerCase().includes(name.toLowerCase())) {
      const next = out.replace(/\?(\s|$)/, `, ${name}?$1`);
      if (next !== out) {
        out = next;
        addressed = true;
      }
    }
  }
  if (reflect) out = out.replaceAll("{reflect}", reflect);
  // Templates contain no pet names by construction; add the rotated one as a
  // natural vocative — tucked before the closing question ("...tonight,
  // sweetheart?") or before the final full stop ("...power away, handsome.").
  // Never wedge it after an opener comma — that breaks the sentence.
  const hasPet = PET_NAMES.some((p) => out.toLowerCase().includes(p));
  if (pet && !hasPet && !addressed) {
    const qIdx = out.lastIndexOf("?");
    if (qIdx > 20) {
      out = `${out.slice(0, qIdx)}, ${pet}${out.slice(qIdx)}`;
    } else {
      const dotIdx = out.lastIndexOf(".");
      if (dotIdx > 20) out = `${out.slice(0, dotIdx)}, ${pet}${out.slice(dotIdx)}`;
    }
  }
  return out;
}

const REFLECT_LEADS_EN = [
  "That {r} bit sounds like a lot.",
  "Okay — {r} has clearly been on you.",
  "Got it, {r} is the thing weighing in.",
  "So {r} is what's going on.",
];

const REFLECT_LEADS_HINGLISH = [
  "{r} wali baat samajh rahi hoon.",
  "Okay, {r} — sun liya maine, and it matters.",
  "Toh {r} chal raha hai — noted, yaar.",
  "Samajh gayi, {r} dimaag mein hai.",
];

export type LocalReplyInput = {
  mood: Mood;
  message: string;
  history: ChatMessage[];
  userName?: string;
  stage?: string;
  vibe?: Vibe;
};

// Wild-vibestock openers: high-energy, playful, SFW. Prepended ~60%.
const WILD_OPENERS = [
  "Okay wait.",
  "Stoppp.",
  "No way.",
  "Okay okay okay.",
  "Listen.",
  "Ohh.",
  "Yooo.",
];

/** Main entry: diverse, reflective, language-matched offline reply. */
export function generateLocalReply(input: LocalReplyInput): string {
  const { mood, message, history, userName, stage, vibe = DEFAULT_VIBE } = input;
  const straight = vibe === "straight";
  const gentleNoPets = vibe === "gentle" || straight;
  const wild = vibe === "wild";
  const style = detectStyle(message);
  const hinglishPool = REPLY_HINGLISH && style !== "english";
  const emptyHand = isEmptyHand(message);
  // English-only replies: Hinglish input leaves Hindi fragments ("gussa raha")
  // that read broken inside English sentences — so reflection is English
  // input only. Situation tags (exam, work...) are shared vocabulary and stay.
  const inputIsEnglish = style === "english";
  // Blank-mind messages skip reflection (there's nothing to echo).
  const rawReflect = emptyHand || !inputIsEnglish ? "" : extractReflect(message);
  const situation = detectSituation(message);
  // Single-word reflects ("blamed", "tension") read awkward in sentence
  // slots — only use multi-word reflects; single words fall back to the
  // detected situation (or nothing).
  const reflect = rawReflect && rawReflect.includes(" ") ? rawReflect : undefined;
  const slotFill = reflect || situation;

  let pool: Pool;
  let crisp = false;
  let topic: string | undefined;
  if (emptyHand) {
    // Explicit invitation to start talking — short by design.
    pool = hinglishPool ? EMPTY_HINGLISH_POOL : EMPTY_EN_POOL;
  } else {
    // Short-answer threading: "work" after "what keeps you busy?" must
    // follow up on WORK, not pivot to a random checklist question.
    const sa = shortAnswer(message, history, mood);
    if (sa.kind === "thread") {
      topic = sa.topic;
      pool = hinglishPool ? THREAD_HINGLISH : THREAD_EN;
    } else if (sa.kind === "ack") {
      pool = hinglishPool ? ACK_HINGLISH : ACK_EN;
    } else if (straight || Math.random() < 0.22) {
      // Straight vibe = always crisp. Otherwise crisp ~1 in 5 turns.
      crisp = true;
      pool = hinglishPool ? CRISP_HINGLISH[mood] : CRISP_EN[mood];
    } else if (hinglishPool) {
      pool = HINGLISH[mood];
    } else {
      pool = EN[mood];
    }
  }

  // Fingerprint: lowercase, pet names stripped (they're rotated per turn),
  // whitespace collapsed. Filled replies keep the template's opening words,
  // so prefix matching catches reuse even after slot filling.
  const fp = (s: string) => {
    let n = s.trim().toLowerCase().replace(/\s+/g, " ");
    for (const p of PET_NAMES) n = n.replaceAll(p, "");
    return n.replace(/\s+/g, " ").trim().slice(0, 36);
  };
  const recentPrefixes = new Set(
    history
      .filter((h) => h.role === "assistant")
      .slice(-10)
      .map((h) => fp(h.content)),
  );
  const fresh = (t: string) => !recentPrefixes.has(fp(t));

  const withReflect = pool.filter((t) => t.includes("{reflect}"));

  let candidates: Pool = [];
  if (reflect && withReflect.length > 0 && Math.random() < 0.55) {
    // Sometimes prefer reflective templates (relatable > generic)...
    candidates = withReflect.filter(fresh);
    if (candidates.length === 0) candidates = withReflect;
  } else {
    // ...otherwise any fresh template from the full pool; reflection comes
    // from the lead-in line below. Full-pool picking keeps 20-turn
    // same-mood marathons varied instead of cycling 3 templates.
    candidates = pool.filter((t) => (reflect ? true : !t.includes("{reflect}"))).filter(fresh);
    if (candidates.length === 0) candidates = pool.filter((t) => (reflect ? true : !t.includes("{reflect}")));
  }
  if (candidates.length === 0) candidates = pool.filter(fresh);
  if (candidates.length === 0) candidates = pool;
  const finalPool = candidates;

  let template = finalPool[Math.floor(Math.random() * finalPool.length)];

  // If the template needs {reflect} but we have none, fall back cleanly.
  if (template.includes("{reflect}") && !reflect) {
    const plain = finalPool.find((t) => !t.includes("{reflect}"));
    if (plain) template = plain;
    else template = template.replaceAll("{reflect}", situation ?? "today");
  }

  const pet = gentleNoPets ? "" : pickPetName(history, mood);
  const hadReflectSlot = template.includes("{reflect}");
  // Straight vibe: no name-dropping either — just the point, kindly.
  let reply = fillSlots(template, straight ? undefined : userName, slotFill, pet);
  // Thread topics fill {T} slots directly.
  if (topic) reply = reply.replaceAll("{T}", topic);

  // Even when the template has no {reflect} slot, prepend a short reflective
  // lead most of the time so the user feels heard (and turns stay unique).
  // Skipped in crisp/thread mode — crisp means crisp, threads carry their topic.
  // Straight vibe skips it too: direct answers only.
  if (!crisp && !topic && !straight && reflect && !hadReflectSlot && Math.random() < 0.8) {
    const leads = hinglishPool ? REFLECT_LEADS_HINGLISH : REFLECT_LEADS_EN;
    const lead = leads[Math.floor(Math.random() * leads.length)].replace("{r}", reflect);
    if (!recentPrefixes.has(fp(lead))) reply = `${lead} ${reply}`;
  }

  // Light Hinglish sprinkles are disabled with English-only policy.
  if (REPLY_HINGLISH && style === "english" && Math.random() < 0.18) {
    const word = SPRINKLE[Math.floor(Math.random() * SPRINKLE.length)];
    if (!reply.toLowerCase().includes(word)) {
      // Lowercase the following word so it reads naturally ("acha, sometimes").
      reply = reply.replace(/\.\s+([A-Z])/, (_, c: string) => `. ${word}, ${c.toLowerCase()}`).slice(0, 600);
      if (!reply.includes(word)) reply = `${reply} ${word}`;
    }
  }

  // Stage-aware gentle nudge on early turns (sensing): keep it invitational.
  // Straight vibe skips the extra question — one point per reply.
  if (!straight && stage === "sensing" && !reply.includes("?") && Math.random() < 0.5) {
    reply = `${reply} How did today treat you?`;
  }

  // Wild vibe: big-reactions energy on top (SFW, playful, never mean).
  if (wild && !emptyHand && Math.random() < 0.6) {
    const opener = WILD_OPENERS[Math.floor(Math.random() * WILD_OPENERS.length)];
    if (!recentPrefixes.has(fp(opener))) reply = `${opener} ${reply}`;
  }

  return reply.replace(/\s+/g, " ").trim().slice(0, 600);
}

/** Every English template in one place — the eval asserts they all read English. */
export function allEnglishTemplates(): string[] {
  return [
    ...EMPTY_EN_POOL,
    ...THREAD_EN,
    ...ACK_EN,
    ...Object.values(EN).flat(),
    ...Object.values(CRISP_EN).flat(),
  ];
}

/** Hinglish-aware classifier boost: shared with mockClassify fallback. */
const HINGLISH_LEXICON: Record<Mood, string[]> = {
  happy: ["khush", "mast", "badhiya", "badiya", "jhakaas", "bindaas", "mazaa", "maza", "acha", "achha", "accha", "shabash", "wah", "party", "treat"],
  sad: ["udaas", "dukhi", "rona", "roya", "royi", "rula", "dil toota", "dil tuta", "tuta", "bura lag", "tension sad"],
  angry: ["gussa", "gusse", "naraz", "naraj", "chid", "bakwas", "bewakoof", "pagal", "had", "dimag kharab", "dimaag"],
  anxious: ["tension", "pareshan", "pareshaan", "ghabrahat", "ghabra", "dar lag", "darr", "fikar", "fikr", "soch soch"],
  tired: ["thak", "thaka", "thaki", "thakan", "neend", "soya", "soyi", "sona", "aalsi", "sust", "susti"],
  lonely: ["akela", "akeli", "akele", "tanha", "tanhaai", "tanhai", "koi nahi", "koi nahin", "yaad aa"],
  sacred: ["shanti", "sukoon", "prarthana", "dua", "bhagwan", "mandir", "dhyaan", "shukr", "shukrana"],
  neutral: [],
};

/** Positive Hinglish words: when negated ("khush nahi", "maza nahi") → sad. */
export const POSITIVE_HINGLISH = new Set([
  "khush", "mast", "badhiya", "badiya", "jhakaas", "bindaas",
  "mazaa", "maza", "acha", "achha", "accha", "shabash", "wah",
]);

export type HinglishHit = { w: string; idx: number };

export function hinglishMoodHits(text: string): { mood: Mood; hits: HinglishHit[] }[] {
  const raw = text.replace(/[’‘`´]/g, "'");
  const t = raw.toLowerCase();
  const out: { mood: Mood; hits: HinglishHit[] }[] = [];
  for (const mood of Object.keys(HINGLISH_LEXICON) as Mood[]) {
    if (mood === "neutral") continue;
    // Single words use letter-boundaries (so "treat" never fires in
    // "treated"); multi-word phrases keep substring matching.
    const hits: HinglishHit[] = [];
    for (const w of HINGLISH_LEXICON[mood]) {
      if (w.includes(" ") || /[^a-z]/.test(w)) {
        const idx = t.indexOf(w);
        if (idx !== -1) hits.push({ w, idx });
      } else {
        const m = new RegExp(`(?<![a-z'])${w}(?![a-z'])`).exec(t);
        if (m) hits.push({ w, idx: m.index ?? -1 });
      }
    }
    if (hits.length > 0) out.push({ mood, hits });
  }
  return out;
}
