import type { Mood, Stage } from "@/lib/moods";

export type Session = {
  mood: Mood;
  confidence: number;
  summary: string;
  turns: number;
  stage: Stage;
  cues: string[];
  updatedAt: number;
};

const store = new Map<string, Session>();

/** Idle sessions expire after 30 minutes; cap keeps memory bounded. */
export const SESSION_TTL_MS = 30 * 60 * 1000;
export const SESSION_MAX_ENTRIES = 1000;

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
  patch: Partial<Session> & { mood: Mood },
): Session {
  const now = Date.now();
  sweep(now);
  const prev = getSession(id);
  const turns = patch.turns ?? (prev ? prev.turns : 0);
  const next: Session = {
    mood: patch.mood,
    confidence: patch.confidence ?? prev?.confidence ?? 0,
    summary: patch.summary ?? prev?.summary ?? "",
    turns,
    stage: patch.stage ?? prev?.stage ?? computeStage(turns),
    cues: patch.cues ?? prev?.cues ?? [],
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
