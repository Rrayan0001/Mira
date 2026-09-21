export const MOODS = ["happy", "sad", "angry", "anxious", "tired", "lonely", "neutral"] as const;
export type Mood = (typeof MOODS)[number];

export function isMood(v: unknown): v is Mood {
  return typeof v === "string" && (MOODS as readonly string[]).includes(v);
}

export const MOOD_SYNONYMS: Record<string, Mood> = {
  // sad / let down
  sad: "sad",
  disappointed: "sad",
  disappointment: "sad",
  disappointing: "sad",
  down: "sad",
  bummed: "sad",
  letdown: "sad",
  hurt: "sad",
  heartbroken: "sad",
  unhappy: "sad",
  depressed: "sad",
  gloomy: "sad",
  sorrowful: "sad",
  hopeless: "sad",
  upset: "sad",
  crying: "sad",

  // lonely / isolated / missing someone
  lonely: "lonely",
  alone: "lonely",
  isolated: "lonely",
  abandoned: "lonely",
  forgotten: "lonely",
  leftout: "lonely",
  unseen: "lonely",
  solitary: "lonely",
  missing: "lonely",

  // angry / frustrated / annoyed
  angry: "angry",
  mad: "angry",
  annoyed: "angry",
  irritated: "angry",
  frustrated: "angry",
  furious: "angry",
  pissed: "angry",
  bitter: "angry",
  resentful: "angry",
  hostile: "angry",

  // anxious / overwhelmed / nervous
  anxious: "anxious",
  nervous: "anxious",
  worried: "anxious",
  stressed: "anxious",
  stress: "anxious",
  overwhelmed: "anxious",
  panic: "anxious",
  panicked: "anxious",
  scared: "anxious",
  fearful: "anxious",
  uneasy: "anxious",
  restless: "anxious",
  overthinking: "anxious",

  // tired / exhausted / drained
  tired: "tired",
  exhausted: "tired",
  drained: "tired",
  sleepy: "tired",
  fatigued: "tired",
  weary: "tired",
  burned: "tired",
  burnt: "tired",
  overworked: "tired",

  // happy / excited / glad
  happy: "happy",
  glad: "happy",
  joyful: "happy",
  excited: "happy",
  cheerful: "happy",
  thrilled: "happy",
  delighted: "happy",
  grateful: "happy",
  content: "happy",
  good: "happy",
  great: "happy",

  // neutral
  neutral: "neutral",
  calm: "neutral",
  fine: "neutral",
  okay: "neutral",
  ok: "neutral",
};

export function normalizeMood(raw: unknown): Mood | undefined {
  if (typeof raw !== "string") return undefined;
  const clean = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (isMood(clean)) return clean;
  return MOOD_SYNONYMS[clean];
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
  userName?: string;
};

export type MoodResult = {
  mood: Mood;
  confidence: number;
  cues: string[];
  stage?: Stage;
  userName?: string;
};

export type Session = {
  userName?: string;
  mood: Mood;
  confidence: number;
  cues: string[];
  summary: string;
  turns: number;
  stage: Stage;
  updatedAt: number;
};

export const MOOD_META: Record<Mood, { label: string; dot: string; phrase: string }> = {
  happy: { label: "Light & bright", dot: "#f43f5e", phrase: "you sound glow-y right now" },
  sad: { label: "Soft & low", dot: "#8aa0a6", phrase: "a little tender, I'm here" },
  angry: { label: "Heated", dot: "#ab4d2c", phrase: "something's fired you up" },
  anxious: { label: "Restless", dot: "#c9a86a", phrase: "a bit unsettled, breathe with me" },
  tired: { label: "Worn out", dot: "#9bb0a0", phrase: "you sound tired, love" },
  lonely: { label: "Quiet", dot: "#a8a0b8", phrase: "feeling a little alone" },
  neutral: { label: "Easy", dot: "#8a7a6b", phrase: "steady and easy" },
};
