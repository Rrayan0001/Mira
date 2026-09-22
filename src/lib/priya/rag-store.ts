/**
 * Priya RAG store — TypeScript port of backend/rag_store.py.
 * Pure TF-IDF retrieval over seed memories + live turns. Zero deps.
 * In-memory only (no fs on serverless); live turns carry a sessionId
 * so per-session history never leaks across users (Python was single-user).
 */

import { SEED_MEMORIES, type SeedMemory } from "./seed-memories";

export type RagDoc = {
  id: number;
  bf: string;
  gf: string;
  mood: string;
  delta: number;
  timestamp: string;
  training?: boolean;
  sessionId?: string;
};

export type RagHit = {
  id: string;
  text: string;
  kind: "long-term" | "episode";
  timestamp: string;
  mood: string;
  delta?: number;
  similarity: number;
};

export type TurnRecord = { bf: string; gf: string };

const TOKEN_RE = /[a-z']+/g;
const TRAINING_TAG_RE = /^\[[a-z][a-z\-]*\] /;

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(TOKEN_RE) ?? []).slice();
}

function isTrainingTurn(doc: RagDoc): boolean {
  if (doc.training) return true;
  return TRAINING_TAG_RE.test(doc.bf ?? "");
}

function tfVec(toks: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
  const n = toks.length || 1;
  for (const [k, v] of tf) tf.set(k, v / n);
  return tf;
}

function episodeText(bf: string, mood: string, gf: string): string {
  return `Boyfriend said: ${bf} Girlfriend (${mood}) replied: ${gf}`;
}

export class RAGStore {
  private docs: RagDoc[] = [];
  private seed: SeedMemory[];
  private maxId = 0;
  // Index over [seeds..., episodes...]
  private tf: Map<string, number>[] = [];
  private df = new Map<string, number>();
  private inv = new Map<string, number[]>();
  private corpusSize = 1;

  constructor(seed: SeedMemory[] = SEED_MEMORIES) {
    this.seed = seed;
    this.buildIndex();
  }

  private buildIndex() {
    this.tf = [];
    this.df = new Map();
    this.inv = new Map();
    const texts = [
      ...this.seed.map((m) => m.text),
      ...this.docs.map((d) => episodeText(d.bf, d.mood, d.gf)),
    ];
    texts.forEach((text, i) => {
      const vec = tfVec(tokenize(text));
      this.tf.push(vec);
      for (const t of vec.keys()) {
        this.df.set(t, (this.df.get(t) ?? 0) + 1);
        const list = this.inv.get(t) ?? [];
        list.push(i);
        this.inv.set(t, list);
      }
    });
    this.corpusSize = texts.length || 1;
  }

  private indexOneEpisode(d: RagDoc) {
    const vec = tfVec(tokenize(episodeText(d.bf, d.mood, d.gf)));
    const i = this.tf.length;
    this.tf.push(vec);
    for (const t of vec.keys()) {
      this.df.set(t, (this.df.get(t) ?? 0) + 1);
      const list = this.inv.get(t) ?? [];
      list.push(i);
      this.inv.set(t, list);
    }
    this.corpusSize += 1;
  }

  private meta(i: number): Omit<RagHit, "similarity"> {
    const ns = this.seed.length;
    if (i < ns) {
      const m = this.seed[i];
      return {
        id: `seed-${i}`, text: m.text, kind: "long-term",
        timestamp: "long ago", mood: m.mood || "happy",
      };
    }
    const d = this.docs[i - ns];
    return {
      id: `chat-${d.id}`,
      text: episodeText(d.bf, d.mood, d.gf),
      kind: "episode", timestamp: d.timestamp, mood: d.mood, delta: d.delta,
    };
  }

  retrieve(query: string, topK = 3, sessionId?: string): RagHit[] {
    const qToks = tokenize(query);
    const seedOnly = (i: number) => i < this.seed.length;
    const allowed = (i: number): boolean => {
      if (seedOnly(i)) return true;
      if (!sessionId) return true;
      return this.docs[i - this.seed.length]?.sessionId === sessionId;
    };
    const seedFallback = (): RagHit[] =>
      this.seed.length > 0 ? [{ ...this.meta(0), similarity: 0 }] : [];

    if (qToks.length === 0 || this.tf.length === 0) return seedFallback();

    const qTf = tfVec(qToks);
    const idf = new Map<string, number>();
    for (const t of qTf.keys()) {
      idf.set(t, Math.log((this.corpusSize + 1) / ((this.df.get(t) ?? 0) + 1)) + 1.0);
    }
    const qVec = new Map<string, number>();
    for (const [t, v] of qTf) qVec.set(t, v * (idf.get(t) ?? 1));
    let qNorm = 0;
    for (const v of qVec.values()) qNorm += v * v;
    qNorm = Math.sqrt(qNorm) || 1.0;

    const cands = new Set<number>();
    for (const t of qTf.keys()) {
      for (const i of this.inv.get(t) ?? []) {
        if (allowed(i)) cands.add(i);
      }
    }
    if (cands.size === 0) return seedFallback();

    const scored: [number, number][] = [];
    for (const i of cands) {
      const vec = this.tf[i];
      let dot = 0;
      for (const [t, qv] of qVec) {
        const c = vec.get(t);
        if (c) dot += qv * c * (idf.get(t) ?? 1);
      }
      if (dot <= 0) continue;
      let norm = 0;
      for (const [t, c] of vec) {
        const w = c * (idf.get(t) ?? 1.0);
        norm += w * w;
      }
      norm = Math.sqrt(norm) || 1.0;
      scored.push([dot / (qNorm * norm), i]);
    }
    scored.sort((a, b) => b[0] - a[0]);

    const out: RagHit[] = [];
    for (const [sim, i] of scored.slice(0, topK)) {
      const m = this.meta(i);
      if (sim <= 0 && m.kind === "episode") continue;
      out.push({ ...m, similarity: Math.round(sim * 1000) / 1000 });
    }
    if (out.length === 0) return seedFallback();
    return out;
  }

  historyBias(query: string, sessionId?: string): number {
    const hits = this.retrieve(query, 5, sessionId);
    const epis = hits.filter((h) => h.kind === "episode");
    if (epis.length === 0) return 0;
    const avg = epis.reduce((s, h) => s + (h.delta ?? 0), 0) / epis.length;
    return Math.max(-2.0, Math.min(2.0, avg));
  }

  addTurn(
    bf: string, gf: string, mood: string, delta: number,
    opts: { training?: boolean; sessionId?: string } = {},
  ): RagDoc {
    this.maxId += 1;
    const turn: RagDoc = {
      id: this.maxId,
      bf, gf, mood, delta,
      timestamp: new Date().toISOString(),
    };
    if (opts.training) turn.training = true;
    if (opts.sessionId) turn.sessionId = opts.sessionId;
    this.docs.push(turn);
    // Cap memory like Python's 150k snapshot cap (smaller: in-memory only).
    if (this.docs.length > 20000) {
      this.docs.splice(0, this.docs.length - 20000);
      this.buildIndex();
    } else {
      this.indexOneEpisode(turn);
    }
    return turn;
  }

  history(limit = 50, opts: { includeTraining?: boolean; sessionId?: string } = {}): RagDoc[] {
    const { includeTraining = false, sessionId } = opts;
    const out: RagDoc[] = [];
    for (let i = this.docs.length - 1; i >= 0; i--) {
      const d = this.docs[i];
      if (sessionId && d.sessionId !== sessionId) continue;
      if (!includeTraining && isTrainingTurn(d)) continue;
      out.push(d);
      if (out.length >= limit) break;
    }
    return out.reverse();
  }

  recentTurns(limit: number, sessionId?: string): TurnRecord[] {
    return this.history(50, { sessionId }).slice(-limit).map((d) => ({ bf: d.bf, gf: d.gf }));
  }

  clearLive() {
    this.docs = this.docs.filter((d) => isTrainingTurn(d));
    this.buildIndex();
  }

  clear() {
    this.docs = [];
    this.buildIndex();
  }
}

function singleton(): RAGStore {
  const g = globalThis as unknown as { __priyaRag?: RAGStore };
  if (!g.__priyaRag) g.__priyaRag = new RAGStore();
  return g.__priyaRag;
}

/** Global Priya memory — seeds shared, live turns namespaced by sessionId. */
export const priyaRag: RAGStore = singleton();
