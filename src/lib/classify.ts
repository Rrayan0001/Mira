import { getAzure, getChatDeployment, isGroqActive } from "@/lib/azure";
import { mockClassify } from "@/lib/mock-mood";
import { normalizeMood, type ChatMessage, type MoodResult } from "@/lib/moods";
import { MOOD_CLASSIFIER_SYSTEM } from "@/lib/prompts";
import { retrieve } from "@/lib/rag";

const FALLBACK: MoodResult = { mood: "neutral", confidence: 0, cues: [] };

function lastLines(history: ChatMessage[], n: number): string {
  return history
    .slice(-n)
    .map((h) => `${h.role}: ${h.content}`)
    .join("\n");
}

export function buildQuery(message: string, history: ChatMessage[]): string {
  const tail = lastLines(history, 2);
  return `${message}\n${tail}`.slice(0, 1000);
}

function formatHistory(history: ChatMessage[]): string {
  return lastLines(history.slice(-10), 10);
}

function parseMoodJson(raw: string): MoodResult {
  try {
    // Reasoning/chat models often wrap JSON in fences — strip them first.
    const clean = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    // Tolerate prose around the object: extract the first {...} block.
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    const json = start !== -1 && end !== -1 && end > start ? clean.slice(start, end + 1) : clean;
    const parsed = JSON.parse(json) as {
      mood?: unknown;
      confidence?: unknown;
      cues?: unknown;
    };
    const mood = normalizeMood(parsed.mood);
    if (!mood) return FALLBACK;
    const confidence =
      typeof parsed.confidence === "number" &&
      Number.isFinite(parsed.confidence)
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0;
    const cues = Array.isArray(parsed.cues)
      ? parsed.cues.filter((c): c is string => typeof c === "string").slice(0, 3)
      : [];
    return { mood, confidence, cues };
  } catch {
    return FALLBACK;
  }
}

/**
 * Shared mood classifier used by both /api/mood and /api/chat.
 * Never throws — returns a neutral fallback on any failure.
 * If Azure is unreachable, falls back to local heuristic so demo works.
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

export async function classifyMood(
  message: string,
  history: ChatMessage[],
): Promise<MoodResult> {
  try {
    const snippets = await retrieve(buildQuery(message, history), 4);
    const knowledge =
      snippets.length > 0
        ? snippets.map((s) => `- ${s.text}`).join("\n")
        : "(no knowledge snippets)";

    const azure = getAzure();
    const res = await withTimeout(
      azure.chat.completions.create({
        model: getChatDeployment(),
        temperature: 0.2,
        max_tokens: 300,
        // Groq-hosted open models don't all honor response_format — the
        // system prompt already demands JSON-only, and parseMoodJson
        // strips fences / extracts the object defensively.
        ...(isGroqActive() ? {} : { response_format: { type: "json_object" } as const }),
        messages: [
          { role: "system", content: MOOD_CLASSIFIER_SYSTEM },
          {
            role: "user",
            content: `KNOWLEDGE:\n${knowledge}\n\nHISTORY:\n${formatHistory(history)}\n\nCURRENT:\n${message}`,
          },
        ],
      }),
      8000,
    );

    const raw = (res as { choices: { message?: { content?: string } }[] }).choices[0]?.message?.content ?? "";
    const detected = parseMoodJson(raw);

    // Safety net: the LLM sometimes returns "neutral" for messages that clearly
    // carry disappointment/absence (e.g. "my friend didnt come today").
    // Prefer a confident non-neutral local heuristic over a neutral LLM verdict.
    try {
      const fallback = mockClassify(message);
      if (detected.mood === "neutral" && fallback.mood !== "neutral" && fallback.confidence >= 0.7) {
        return fallback;
      }
    } catch {
      // ignore heuristic errors, keep LLM verdict
    }
    return detected;
  } catch (err) {
    const msg = String((err as Error)?.message ?? "");
    if (
      msg.includes("ENOTFOUND") ||
      msg.includes("getaddrinfo") ||
      msg.includes("Missing env var") ||
      msg.includes("upstream") ||
      msg.includes("401") ||
      msg.includes("404") ||
      msg.includes("DeploymentNotFound") ||
      msg.includes("Deployment Not Found") ||
      msg.includes("Connection") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("ECONNREFUSED") ||
      msg.includes("timeout")
    ) {
      console.error("classifyMood Azure failed, falling back to mock:", msg.slice(0, 200));
      try {
        return mockClassify(message);
      } catch {
        return FALLBACK;
      }
    }
    console.error("classifyMood failed, returning neutral:", err);
    return FALLBACK;
  }
}