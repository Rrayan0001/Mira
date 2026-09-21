export const MOODS = ["happy", "sad", "angry", "anxious", "tired", "lonely", "neutral"] as const;
export type Mood = (typeof MOODS)[number];

export function isMood(v: unknown): v is Mood {
  return typeof v === "string" && (MOODS as readonly string[]).includes(v);
}

export const STAGES = ["sensing", "deepening", "comfort_action", "resolution"] as const;
export type Stage = (typeof STAGES)[number];

export function isStage(v: unknown): v is Stage {
  return typeof v === "string" && (STAGES as readonly string[]).includes(v);
}

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatRequest = {
  sessionId: string;
  message: string;
  history: ChatMessage[];
};

export type MoodResult = {
  mood: Mood;
  confidence: number;
  cues: string[];
  stage?: Stage;
};

export type Session = {
  mood: Mood;
  confidence: number;
  cues: string[];
  summary: string;
  turns: number;
  stage: Stage;
  updatedAt: number;
};

export const MOOD_META: Record<Mood, { label: string; dot: string; phrase: string }> = {
  happy: { label: "Light & bright", dot: "#edb58f", phrase: "you sound glow-y right now" },
  sad: { label: "Soft & low", dot: "#8aa0a6", phrase: "a little tender, I'm here" },
  angry: { label: "Heated", dot: "#ab4d2c", phrase: "something's fired you up" },
  anxious: { label: "Restless", dot: "#c9a86a", phrase: "a bit unsettled, breathe with me" },
  tired: { label: "Worn out", dot: "#9bb0a0", phrase: "you sound tired, love" },
  lonely: { label: "Quiet", dot: "#a8a0b8", phrase: "feeling a little alone" },
  neutral: { label: "Easy", dot: "#f5f1e8", phrase: "steady and easy" },
};
