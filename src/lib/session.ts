import type { Mood, Stage } from "@/lib/moods";
import { DEFAULT_VIBE, type Vibe } from "@/lib/vibes";

export type Session = {
  userName?: string;
  mood: Mood;
  confidence: number;
  summary: string;
  turns: number;
  stage: Stage;
  cues: string[];
  vibe: Vibe;
  updatedAt: number;
};

const store = new Map<string, Session>();

/** Idle sessions expire after 30 minutes; cap keeps memory bounded. */
export const SESSION_TTL_MS = 30 * 60 * 1000;
export const SESSION_MAX_ENTRIES = 1000;

export const NON_NAME_WORDS = new Set([
  "hi", "hello", "hey", "hola", "yo", "sup", "howdy",
  "yes", "no", "nope", "yeah", "nah", "ok", "okay", "sure",
  "why", "what", "who", "where", "how", "when",
  "nothing", "none", "idk", "nevermind", "skip",
  "good", "bad", "fine", "tired", "sad", "happy", "lonely", "angry",
  "mira", "bot", "ai", "girlfriend",
  "please", "thanks", "thank", "you", "me", "myself", "i", "we", "they",
  "name", "names", "called",
  "that", "this", "there", "here", "it", "its", "it's",
  "my", "your", "his", "her", "our", "their", "the", "a", "an",
  "friend", "friends", "today", "yesterday", "tomorrow", "tonight",
  "day", "night", "work", "school", "home", "life",
  "college", "office", "class", "course", "subject", "project", "deadline",
  "interview", "shift", "job", "career", "meeting", "party", "movie", "movies",
  "match", "game", "team", "company", "boss", "dinner", "lunch", "breakfast",
  "birthday", "holiday", "vacation", "weekend", "trip", "travel",
  "music", "song", "dance", "gym", "yoga", "hospital", "doctor",
  "store", "shop", "market", "mall", "park", "beach", "hotel", "restaurant",
  "cafe", "wedding", "morning", "evening", "afternoon", "family", "fest",
  "festival", "exam", "exams", "test", "quiz",
  "feel", "feeling", "went", "came", "come", "didnt", "didn't",
  "just", "much", "very", "little", "bit", "somewhat", "really",
  "is", "was", "are", "were", "been", "being", "have", "had", "has",
  "not", "so", "too", "also", "and", "or", "but", "if", "because",
]);

/**
 * Deterministically extracts the user's name from introductory phrases or single/double name inputs.
 */
export function extractName(text: string): string | undefined {
  if (!text || typeof text !== "string") return undefined;
  const clean = text.trim().replace(/^[\s,!.?~:;'"()]+|[\s,!.?~:;'"()]+$/g, "");
  if (!clean) return undefined;

  const phraseMatch = clean.match(
    /(?:my name is|my name's|name is|name's|i'm called|i am called|they call me|call me|you can call me|just call me)\s+([A-Za-z\u00C0-\u024F\u4e00-\u9fa5'-]+(?:\s+[A-Za-z\u00C0-\u024F\u4e00-\u9fa5'-]+)?)/i
  );
  if (phraseMatch) {
    const candidate = phraseMatch[1].trim();
    const parts = candidate.split(/\s+/);
    if (!parts.some((w) => NON_NAME_WORDS.has(w.toLowerCase())) && candidate.length >= 2 && candidate.length <= 30) {
      return parts
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
    }
  }

  const invertedMatch = clean.match(
    /^([A-Za-z\u00C0-\u024F\u4e00-\u9fa5'-]+)\s+is my name/i
  );
  if (invertedMatch) {
    const candidate = invertedMatch[1].trim();
    if (!NON_NAME_WORDS.has(candidate.toLowerCase()) && candidate.length >= 2 && candidate.length <= 30) {
      return candidate.charAt(0).toUpperCase() + candidate.slice(1).toLowerCase();
    }
  }

  const words = clean.split(/\s+/);
  if (words.length <= 2) {
    const candidate = words.join(" ");
    if (/^[A-Za-z\u00C0-\u024F\u4e00-\u9fa5'-]+(?:\s+[A-Za-z\u00C0-\u024F\u4e00-\u9fa5'-]+)?$/.test(candidate)) {
      const lowerFirst = words[0].toLowerCase();
      // Two all-lowercase words are never a name ("college fest", "my office"
      // must not become the user's name). Single lowercase words ("rayan")
      // still pass via the blocklist below.
      const isTwoLower = words.length === 2 && words[0] === lowerFirst && words[1] === words[1].toLowerCase();
      if (!isTwoLower && !NON_NAME_WORDS.has(lowerFirst) && candidate.length >= 2 && candidate.length <= 30) {
        return words
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(" ");
      }
    }
  }

  return undefined;
}

function isExpired(s: Session, now: number): boolean {
  return now - s.updatedAt > SESSION_TTL_MS;
}

function sweep(now: number): void {
  for (const [key, s] of store) {
    if (isExpired(s, now)) store.delete(key);
  }
  // LRU-ish cap: drop oldest by updatedAt.
  if (store.size > SESSION_MAX_ENTRIES) {
    const ordered = [...store.entries()].sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt,
    );
    for (let i = 0; i < store.size - SESSION_MAX_ENTRIES; i++) {
      store.delete(ordered[i][0]);
    }
  }
}

export function computeStage(turns: number): Stage {
  if (turns <= 2) return "sensing";
  if (turns <= 4) return "deepening";
  if (turns <= 7) return "comfort_action";
  return "resolution";
}

export function getSession(id: string): Session | undefined {
  const now = Date.now();
  const s = store.get(id);
  if (!s) return undefined;
  if (isExpired(s, now)) {
    store.delete(id);
    return undefined;
  }
  return s;
}

export function saveSession(
  id: string,
  patch: Partial<Session> & { mood?: Mood },
): Session {
  const now = Date.now();
  sweep(now);
  const prev = getSession(id);
  const turns = patch.turns ?? (prev ? prev.turns : 0);
  const next: Session = {
    userName: patch.userName !== undefined ? patch.userName : prev?.userName,
    mood: patch.mood ?? prev?.mood ?? "neutral",
    confidence: patch.confidence ?? prev?.confidence ?? 0,
    summary: patch.summary ?? prev?.summary ?? "",
    turns,
    stage: patch.stage ?? prev?.stage ?? computeStage(turns),
    cues: patch.cues ?? prev?.cues ?? [],
    vibe: patch.vibe ?? prev?.vibe ?? DEFAULT_VIBE,
    updatedAt: now,
  };
  store.set(id, next);
  return next;
}

export function touchSession(id: string): void {
  const s = getSession(id);
  if (s) {
    s.updatedAt = Date.now();
    store.set(id, s);
  }
}
