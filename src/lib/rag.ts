import { readFile } from "node:fs/promises";
import path from "node:path";
import { AzureOpenAI } from "openai";
import defaultIndex from "./mood-kb/index.json";

export type Snippet = { id: string; text: string; score: number };

type IndexChunk = { id: string; text: string; embedding: number[] };
type KBIndex = {
  model?: string;
  dim?: number;
  tfidf?: { vocab: string[]; idf: number[] };
  chunks: IndexChunk[];
};

let cached: KBIndex | null = null;
let loading: Promise<KBIndex> | null = null;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export async function loadIndex(): Promise<KBIndex> {
  if (cached) return cached;
  if (defaultIndex && Array.isArray((defaultIndex as unknown as KBIndex).chunks)) {
    cached = defaultIndex as unknown as KBIndex;
    return cached;
  }
  if (loading) return loading;
  loading = (async () => {
    try {
      const p = path.join(process.cwd(), "src", "lib", "mood-kb", "index.json");
      const raw = await readFile(p, "utf8");
      const parsed = JSON.parse(raw) as KBIndex;
      if (Array.isArray(parsed.chunks)) {
        cached = parsed;
        return parsed;
      }
    } catch {}
    cached = defaultIndex as unknown as KBIndex;
    return cached;
  })();
  try {
    return await loading;
  } catch {
    loading = null;
    return defaultIndex as unknown as KBIndex;
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Retrieve top-K KB snippets for a query.
 * - Azure-embedding index (default per spec): embeds the query and scores
 *   by cosine similarity.
 * - `tfidf-local` index (`npm run kb:build -- --local`): scores locally
 *   with the stored vocab/idf — fully offline, no Azure call.
 * Never throws — returns [] on any failure so the backend can answer
 * without KB context.
 */
export async function retrieve(query: string, topK = 4): Promise<Snippet[]> {
  try {
    const index = await loadIndex();
    const q =
      index.model === "tfidf-local" && index.tfidf
        ? localVector(query.slice(0, 1000), index.tfidf)
        : await embedQuery(query.slice(0, 1000));

    return index.chunks
      .map((c) => ({ id: c.id, text: c.text, score: cosine(q, c.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, topK));
  } catch (err) {
    console.error("retrieve() failed, returning []:", (err as Error)?.message ?? err);
    return [];
  }
}

async function embedQuery(query: string): Promise<number[]> {
  const client = new AzureOpenAI({
    endpoint: required("AZURE_OPENAI_ENDPOINT"),
    apiKey: required("AZURE_OPENAI_API_KEY"),
    apiVersion: required("AZURE_OPENAI_API_VERSION"),
    deployment: required("AZURE_OPENAI_EMBED_DEPLOYMENT"),
  });
  const deployment = required("AZURE_OPENAI_EMBED_DEPLOYMENT");
  const res = await client.embeddings.create({ model: deployment, input: query });
  const q = res.data[0]?.embedding;
  if (!q) throw new Error("Empty embedding response");
  return q;
}

const STOP = new Set(
  "a,an,the,and,or,but,if,then,else,for,to,of,in,on,at,with,without,from,by,as,is,are,was,were,be,been,being,i,you,he,she,it,we,they,me,him,her,us,them,my,your,his,its,our,their,this,that,these,those,what,whats,how,when,where,who,whom,which,there,here,so,very,just,now,tonight,today,day,right,like,feel,feeling,do,does,did,have,has,had,want,would,could,should,can,will,not,no,yes,up,down,out,about,into,over,after,before,more,most,some,any,one,little,really,even,ever,never,always,all,also,am,pm".split(
    ",",
  ),
);

function localVector(
  query: string,
  tfidf: { vocab: string[]; idf: number[] },
): number[] {
  const counts = new Map<string, number>();
  for (const t of query.toLowerCase().match(/[a-z0-9']+/g) || []) {
    if (STOP.has(t) || t.length < 2) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const v = tfidf.vocab.map((term, i) => (counts.get(term) ?? 0) * tfidf.idf[i]);
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
