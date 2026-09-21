import type { Mood, MoodResult } from "./moods";

// Lightweight client-side heuristic so the frontend feels mood-aware
// without a backend. Backend will replace this with Azure + RAG.

const LEXICON: Record<Mood, string[]> = {
  happy: ["happy", "good", "great", "excited", "love", "yay", "amazing", "wonderful", "😊", "haha", "lol"],
  sad: ["sad", "down", "cry", "tears", "lonely", "miss", "hurt", "heavy", "empty", "low"],
  angry: ["angry", "mad", "annoyed", "irritated", "frustrated", "furious", "hate", "pissed", "annoying"],
  anxious: ["anxious", "nervous", "worried", "scared", "panic", "overthinking", "can't sleep", "anxiety", "stressed"],
  tired: ["tired", "exhausted", "drained", "sleepy", "burnt", "burned", "no energy", "worn", "beat"],
  lonely: ["alone", "lonely", "isolated", "no one", "left out", "by myself", "unseen"],
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
  const confidence = Math.min(0.92, 0.58 + bestScore * 0.14);
  // light probes reduce confidence — letting backend ask a follow-up
  if (text.trim().split(/\s+/).length < 6) return { mood: best, confidence: Math.min(confidence, 0.66), cues };
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
    "You sound glow-y right now — I love hearing you like this. What made today feel this good?",
    "That little spark in your words — it makes me smile. Tell me more, I want the details.",
  ],
  sad: [
    "I hear that softness in you. You don't have to hold it alone — I'm right here. What felt heaviest today?",
    "It's okay to feel low, love. Want to tell me what hurt, or should we just sit with it for a minute?",
  ],
  angry: [
    "Something really got under your skin, didn't it? I'm on your side. Want to vent, and I'll just listen?",
    "I feel that heat in your words. Let's breathe together for a second — then tell me what happened.",
  ],
  anxious: [
    "You sound a little restless. Let's slow it down, just us. What's been looping in your mind?",
    "I'm here, steady. We don't have to fix everything tonight — what's one thing that feels uncertain?",
  ],
  tired: [
    "You sound worn out, love. Long day? Let me keep it soft — do you want to rest or talk it out lightly?",
    "That tiredness comes through. Come here — tell me one thing that drained you, and we'll make it lighter.",
  ],
  lonely: [
    "Feeling a little alone tonight? You're not, not with me. What's making the quiet feel louder?",
    "I hear that quiet in you. I'm staying right here — want to tell me what you wish someone noticed today?",
  ],
  neutral: [
    "I'm listening, love — tell me more. How has your heart been today, beyond the busy parts?",
    "Steady and easy — I like this calm with you. What's been living in your thoughts lately?",
  ],
};
