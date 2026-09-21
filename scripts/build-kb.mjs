#!/usr/bin/env node
/**
 * Build the mood KB index.
 *
 * Reads src/lib/mood-kb/*.md, chunks per RAG_KB_SPEC.md §5, embeds via
 * Azure OpenAI, writes src/lib/mood-kb/index.json.
 *
 * Re-run after any KB edit or embed-model change:
 *   npm run kb:build
 *
 * Offline fallback (no embedding deployment available):
 *   npm run kb:build -- --local
 * writes a deterministic TF-IDF index (model="tfidf-local") with the same
 * chunking and chunk-count guard. `retrieve()` detects it and scores
 * locally with no network. Re-run without --local once an Azure
 * embedding deployment exists to swap in real vectors.
 *
 * Env (same names as backend spec):
 *   AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_API_VERSION,
 *   AZURE_OPENAI_EMBED_DEPLOYMENT
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AzureOpenAI } from "openai";

// ---- lightweight .env loader (no dotenv dependency) ----
async function loadDotEnv() {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  for (const name of [".env", ".env.local"]) {
    try {
      const raw = await readFile(path.join(root, name), "utf8");
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#") || !t.includes("=")) continue;
        const i = t.indexOf("=");
        const k = t.slice(0, i).trim();
        let v = t.slice(i + 1).trim();
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        if (!(k in process.env)) process.env[k] = v;
      }
    } catch {
      // missing .env is fine — env may come from shell
    }
  }
}

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var: ${name}`);
    console.error(
      "Needed: AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, " +
        "AZURE_OPENAI_API_VERSION, AZURE_OPENAI_EMBED_DEPLOYMENT",
    );
    process.exit(1);
  }
  return v;
}

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const KB_DIR = path.join(ROOT, "src", "lib", "mood-kb");
const MAX_CHARS = 800;

/** Split long text on sentence boundaries so no chunk exceeds MAX_CHARS. */
function capChunks(id, text) {
  if (text.length <= MAX_CHARS) return [{ id, text }];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const out = [];
  let cur = "";
  let n = 0;
  const flush = () => {
    if (cur.trim()) out.push({ id: n === 0 ? id : `${id}/${n}`, text: cur.trim() });
    n += 1;
    cur = "";
  };
  for (const s of sentences) {
    if ((cur + " " + s).trim().length > MAX_CHARS) flush();
    // Single pathological sentence longer than cap: hard-slice it.
    let rest = s;
    while (rest.length > MAX_CHARS) {
      const head = (cur ? cur + " " : "") + rest.slice(0, MAX_CHARS);
      out.push({ id: n === 0 ? id : `${id}/${n}`, text: head.trim() });
      n += 1;
      cur = "";
      rest = rest.slice(MAX_CHARS);
    }
    cur = (cur ? cur + " " : "") + rest;
  }
  flush();
  return out.filter((c) => c.text.length > 0);
}

/** Split "## ..." sections. Returns [{heading, body}]. */
function splitH2(md) {
  const parts = md.split(/^## /m);
  const out = [];
  for (let i = 1; i < parts.length; i++) {
    const block = `## ${parts[i]}`.trim();
    const nl = block.indexOf("\n");
    const heading = nl === -1 ? block : block.slice(0, nl).replace(/^##\s+/, "").trim();
    out.push({ heading, body: block });
  }
  return out;
}

/** Split "### ..." groups. Returns [{heading, lines}]. */
function splitH3(md) {
  const parts = md.split(/^### /m);
  const out = [];
  for (let i = 1; i < parts.length; i++) {
    const block = `### ${parts[i]}`.trim();
    const nl = block.indexOf("\n");
    const heading = nl === -1 ? block : block.slice(0, nl).replace(/^###\s+/, "").trim();
    out.push({ heading, body: block });
  }
  return out;
}

function shortName(heading) {
  return heading.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

// ---- deterministic TF-IDF fallback (offline, no Azure needed) ----
const STOP = new Set(
  "a,an,the,and,or,but,if,then,else,for,to,of,in,on,at,with,without,from,by,as,is,are,was,were,be,been,being,i,you,he,she,it,we,they,me,him,her,us,them,my,your,his,its,our,their,this,that,these,those,what,whats,how,when,where,who,whom,which,there,here,so,very,just,now,tonight,today,day,right,like,feel,feeling,do,does,did,have,has,had,want,would,could,should,can,will,not,no,yes,up,down,out,about,into,over,after,before,more,most,some,any,one,little,really,even,ever,never,always,all,also,am,pm".split(
    ",",
  ),
);

function tokens(text) {
  return (text.toLowerCase().match(/[a-z0-9']+/g) || []).filter((t) => !STOP.has(t) && t.length > 1);
}

function tfidfIndex(chunks) {
  const docs = chunks.map((c) => tokens(c.text));
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;
  const vocab = [...df.keys()].sort();
  const idf = vocab.map((t) => Math.log((N + 1) / (df.get(t) + 1)) + 1);
  const pos = new Map(vocab.map((t, i) => [t, i]));
  const vectors = docs.map((d) => {
    const v = new Array(vocab.length).fill(0);
    for (const t of d) v[pos.get(t)] += 1;
    for (let i = 0; i < v.length; i++) v[i] *= idf[i];
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => Math.round((x / norm) * 1e6) / 1e6);
  });
  return {
    model: "tfidf-local",
    dim: vocab.length,
    builtAt: new Date().toISOString(),
    tfidf: { vocab, idf: idf.map((x) => Math.round(x * 1e6) / 1e6) },
    chunks: chunks.map((c, i) => ({ id: c.id, text: c.text, embedding: vectors[i] })),
  };
}

async function buildChunks() {
  const chunks = [];

  // moods.md + playbooks.md: one chunk per ## section (then cap at 800 chars)
  for (const file of ["moods.md", "playbooks.md"]) {
    const raw = await readFile(path.join(KB_DIR, file), "utf8");
    for (const { heading, body } of splitH2(raw)) {
      const id = `${file}#${shortName(heading)}`;
      chunks.push(...capChunks(id, body));
    }
  }

  // questions.md: per ### group, batch 4 question-lines per chunk
  {
    const file = "questions.md";
    const raw = await readFile(path.join(KB_DIR, file), "utf8");
    for (const { heading, body } of splitH3(raw)) {
      const group = shortName(heading);
      const qlines = body
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^[-*]\s+/.test(l) || /^\d+[.)]\s+/.test(l));
      for (let i = 0; i < qlines.length; i += 4) {
        const batch = qlines.slice(i, i + 4);
        const n = i / 4;
        const id = `${file}#${group}/${n}`;
        const text = `### ${heading}\n${batch.join("\n")}`;
        chunks.push(...capChunks(id, text));
      }
    }
  }

  return chunks;
}

async function main() {
  await loadDotEnv();

  const chunks = await buildChunks();
  console.log(`Chunked ${chunks.length} chunks:`);
  for (const c of chunks) console.log(`  - ${c.id} (${c.text.length} chars)`);

  if (chunks.length < 25 || chunks.length > 60) {
    console.error(
      `FAIL: expected 25–60 chunks, got ${chunks.length}. ` +
        "Check KB files for truncation or heading mistakes.",
    );
    process.exit(1);
  }

  const outPath = path.join(KB_DIR, "index.json");

  if (process.argv.includes("--local")) {
    const out = tfidfIndex(chunks);
    await writeFile(outPath, JSON.stringify(out, null, 1));
    console.log(
      `Wrote LOCAL TF-IDF ${outPath} (model=${out.model} dim=${out.dim} chunks=${chunks.length})`,
    );
    return;
  }

  const endpoint = required("AZURE_OPENAI_ENDPOINT");
  const apiKey = required("AZURE_OPENAI_API_KEY");
  const apiVersion = required("AZURE_OPENAI_API_VERSION");
  const embedDeployment = required("AZURE_OPENAI_EMBED_DEPLOYMENT");

  const client = new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment: embedDeployment });

  // Batch 10 texts per embeddings.create() call.
  const embeddings = new Array(chunks.length);
  for (let i = 0; i < chunks.length; i += 10) {
    const batch = chunks.slice(i, i + 10);
    console.log(`Embedding ${i + 1}–${i + batch.length} of ${chunks.length}...`);
    const res = await client.embeddings.create({
      model: embedDeployment,
      input: batch.map((c) => c.text),
    });
    const sorted = [...res.data].sort((a, b) => a.index - b.index);
    sorted.forEach((d, j) => {
      embeddings[i + j] = d.embedding;
    });
  }

  const dim = embeddings[0]?.length ?? 0;
  const out = {
    model: embedDeployment,
    dim,
    builtAt: new Date().toISOString(),
    chunks: chunks.map((c, i) => ({ id: c.id, text: c.text, embedding: embeddings[i] })),
  };
  if (!dim) {
    console.error("FAIL: embedding dimension is 0 — embedding call returned no data.");
    process.exit(1);
  }

  await writeFile(outPath, JSON.stringify(out, null, 1));
  const kb = Math.round(Buffer.byteLength(JSON.stringify(out)) / 1024);
  console.log(`Wrote ${outPath} (model=${out.model} dim=${dim} chunks=${chunks.length} ~${kb}KB)`);
  if (Buffer.byteLength(JSON.stringify(out)) > 2 * 1024 * 1024) {
    console.error("WARN: index.json exceeds 2MB — consider a smaller embed model.");
  }
}

main().catch((err) => {
  console.error("kb:build failed:", err?.message ?? err);
  process.exit(1);
});
