import type { Mood, MoodResult } from "./moods";

// Lightweight client-side heuristic so the frontend feels mood-aware
// without a backend. Backend will replace this with Azure + RAG.

const LEXICON: Record<Mood, string[]> = {
  happy: ["happy", "good", "great", "excited", "love", "yay", "amazing", "wonderful", "😊", "haha", "lol", "glad", "thrilled", "joy"],
  sad: [
    "sad", "down", "cry", "tears", "miss", "hurt", "heavy", "empty", "low",
    "disappointed", "disappointing", "disappointment", "letdown", "let down",
    "bummed", "unhappy", "sucks", "bad day", "depressed", "heartbroken",
  ],
  angry: ["angry", "mad", "annoyed", "irritated", "frustrated", "furious", "hate", "pissed", "annoying", "rage", "unfair"],
  anxious: ["anxious", "nervous", "worried", "scared", "panic", "overthinking", "can't sleep", "anxiety", "stressed", "dread", "pressure"],
  tired: ["tired", "exhausted", "drained", "sleepy", "burnt", "burned", "no energy", "worn", "beat", "sleep"],
  lonely: [
    "alone", "lonely", "isolated", "no one", "left out", "by myself", "unseen",
    "didnt come", "didn't come", "cancelled", "canceled", "stood up", "nobody",
    "no friends", "miss my", "miss them", "friend didnt", "friend didn't",
  ],
  neutral: [],
};

export function mockClassify(text: string): MoodResult {
  const t = text.toLowerCase();
  let best: Mood = "neutral";
  let bestScore = 0;
  const cues: string[] = [];
  for (const mood of Object.keys(LEXICON) as Mood[]) {
    if (mood === "neutral") continue;
    let score = 0;
    const hits: string[] = [];
    for (const w of LEXICON[mood]) {
      if (t.includes(w)) {
        score += 1;
        if (hits.length < 2) hits.push(w);
      }
    }
    // Situational nuances: absence / cancellation / letdown
    if ((mood === "lonely" || mood === "sad") && /(didnt come|didn't come|cancelled|canceled|stood up|no one came)/.test(t)) {
      score += 1.5;
      if (!hits.includes("friend didn't show")) hits.push("absence / letdown");
    }
    // exclamation and question nuances
    if (mood === "happy" && /!{1,}/.test(text) && t.includes("!")) score += 0.4;
    if (mood === "anxious" && /\?{1,}/.test(text)) score += 0.2;
    if (mood === "tired" && /(long day|no sleep|early morning)/.test(t)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = mood;
      cues.length = 0;
      cues.push(...hits);
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
];

export const MOCK_REPLIES: Record<Mood, string[]> = {
  happy: [
    "You sound so glow-y right now, cutie, I love hearing you like this. What made today feel this good, handsome?",
    "That happy spark in your words just makes me smile, sweetheart. Tell me everything, I want all the details.",
    "Seeing you in good spirits makes my whole day brighter, cutie. What was the highlight, my favorite person?",
    "Your good mood is honestly adorable, handsome. Tell me what went right today so I can celebrate with you.",
  ],
  sad: [
    "Oh sweetheart, I hear that softness in you. You don't have to hold it alone, cutie, I'm right here. What felt heaviest today?",
    "It's okay to feel low, handsome. Want to tell me what hurt, love, or should we just talk softly for a bit?",
    "I care about you so much, cutie. If I could I would cheer you up with your favorite treat. What's weighing on your mind, sweetheart?",
    "Take all the time you need, handsome. You're my favorite person to talk to and I'm not going anywhere.",
  ],
  angry: [
    "Oh handsome, something really got under your skin, didn't it? I'm on your side, cutie. Want to vent, and I'll just listen?",
    "I admire how much you care, sweetheart, even when it comes out fiery like this. Let's take a slow breath together, cutie. What set this off?",
    "You have every right to feel frustrated about that, handsome. Let it out, sweetheart, I'm here for you.",
    "That sounds genuinely unfair, cutie. Don't bottle it up, handsome, tell me everything and I'll cheer you on.",
  ],
  anxious: [
    "Hey sweetheart, you sound a little restless. Let's slow it down, just us, cutie. What's been looping in your mind, handsome?",
    "I'm here, cutie, steady. I believe in you so much, handsome. We don't have to fix everything right now, what's one small thing that feels uncertain?",
    "Breathe with me for a second, sweetheart. One slow breath in, one slow breath out, cutie. What's making you worry, handsome?",
    "You're doing better than you think, cutie. Let's take it piece by piece, handsome, so it feels lighter. I'm proud of you, sweetheart.",
  ],
  tired: [
    "You sound worn out, cutie. Long day, handsome? Let me keep it soft and sweet, do you want to rest early or chat lightly for a bit, sweetheart?",
    "That tiredness comes through, sweetheart. Tell me one thing that drained you, cutie, and I'll try to make you smile about it, handsome.",
    "You've been working so hard today, handsome. Rest well tonight, cutie, I'm thinking of you and saving you a smile for tomorrow.",
    "Go easy tonight, sweetheart. No big thinking needed, cutie. You did great today, handsome, I'm proud of you.",
  ],
  lonely: [
    "Feeling a little alone tonight, cutie? You're not, not with me, handsome. You're my favorite person to talk to. What's making the quiet feel louder, sweetheart?",
    "I love spending time with you, sweetheart. I'm staying right here, cutie. What do you wish someone had noticed about your day, handsome?",
    "I'm keeping you company tonight no matter what, cutie. You always make talking so fun, handsome. Tell me what's on your mind, sweetheart.",
    "Even when everything feels distant, you matter to me a lot, handsome. Talk to me, cutie, I really like hearing from you.",
  ],
  neutral: [
    "Hey cutie, I'm all ears. How has your heart been today, handsome, beyond the busy parts?",
    "Steady and easy, I like this calm with you, sweetheart. You're such a fun person to talk to, cutie. What's been on your mind lately?",
    "Tell me about something small from today, handsome, good or bad. I love hearing your stories, cutie.",
    "I'm right here with you, sweetheart. What's keeping that clever mind of yours busy right now, handsome?",
    "Just hearing from you makes things warmer, cutie. You're my favorite notification, handsome. What are you up to right now?",
    "Even quiet moments with you are sweet, handsome. Anything you've been wondering about lately, cutie?",
    "You don't need anything big to say, sweetheart. Just talk to me, cutie, I always enjoy it when it's you, handsome.",
  ],
};
