import { NextResponse } from "next/server";
import { z } from "zod";
import { SAFETY_REPLY, isSafetyTriggered } from "@/lib/safety";
import { computeStage, extractName, getSession, saveSession } from "@/lib/session";
import { DEFAULT_VIBE, VIBES } from "@/lib/vibes";
import type { ChatMessage, Mood, Stage } from "@/lib/moods";
import { getMoodEngine, mapPriyaToMira, type PriyaSignals } from "@/lib/priya/mood-engine";
import {
  buildMiraMasterPrompt,
  groqTurn,
  summarizeTurns,
} from "@/lib/priya/groq-reply";
import { pickEmergencyReply } from "@/lib/priya/fallback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  sessionId: z.string().min(1).max(64),
  message: z.string().min(1).max(2000),
  userName: z.string().max(100).optional(),
  vibe: z.enum(VIBES).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      }),
    )
    .max(20),
});

function sseFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function signalLine(signals: PriyaSignals): string {
  const keys: (keyof PriyaSignals)[] = [
    "cheating_confession",
    "explicit_request",
    "stonewall",
    "short_dry",
    "shouting",
    "jealousy_topic",
    "repair",
    "apology",
    "caring",
    "sweet_emoji",
    "wholesome_intimacy",
    "distress_acute",
    "distress",
  ];
  const sigLine = keys
    .filter((k) => (signals as Record<string, unknown>)[k] === true)
    .join(", ");
  // Hit words carry the actual topic (e.g. conflict: "ex") — the model
  // needs them, otherwise "my ex texted me" reads as generic happy.
  const hits: string[] = [];
  for (const [label, arr] of [
    ["rude", signals.rude_hits],
    ["conflict", signals.conflict_hits],
    ["affection", signals.affection_hits],
  ] as const) {
    if (arr.length > 0) hits.push(`${label}: ${arr.slice(0, 3).join(", ")}`);
  }
  return [sigLine, ...hits].filter(Boolean).join("; ");
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { sessionId, message, history, userName: reqUserName, vibe: reqVibe } = parsed.data;

  // 1. Safety gate FIRST — before any brain call. Non-stream JSON reply.
  if (isSafetyTriggered(message)) {
    try {
      const prev = getSession(sessionId);
      saveSession(sessionId, {
        userName: prev?.userName || reqUserName || extractName(message),
        mood: "sad",
        confidence: 1,
        stage: "comfort_action",
        cues: ["self-harm disclosure"],
        turns: (prev?.turns ?? 0) + 1,
        vibe: reqVibe ?? prev?.vibe ?? DEFAULT_VIBE,
      });
    } catch (err) {
      console.error("session save failed:", err);
    }
    return NextResponse.json(SAFETY_REPLY, { status: 200 });
  }

  // 2. Conversation lifecycle & stage calculation.
  const prevSession = getSession(sessionId);
  // Vibe: explicit turn value wins, else sticky session vibe, else default.
  const currentVibe = reqVibe ?? prevSession?.vibe ?? DEFAULT_VIBE;
  let currentUserName = prevSession?.userName || reqUserName?.trim() || "";
  if (!currentUserName) {
    const extracted = extractName(message);
    if (extracted) {
      currentUserName = extracted;
    }
  }

  const clientTurns = Math.floor(history.length / 2) + 1;
  const turnCount = Math.max((prevSession?.turns ?? 0) + 1, clientTurns);
  const currentStage: Stage = computeStage(turnCount);

  // 3. Mood: deterministic scorer (instant badge, no LLM, no retrieval).
  let msg = message.trim();
  if (msg.length > 500) msg = msg.slice(0, 500);
  const engine = getMoodEngine(sessionId);
  const moodUpdate = engine.update(msg, 0);
  const mapped = mapPriyaToMira(moodUpdate);

  const recentAssistant = history
    .filter((h) => h.role === "assistant")
    .slice(-3)
    .map((h) => h.content);
  const system = buildMiraMasterPrompt({
    miraMood: mapped.mood,
    priyaLabel: moodUpdate.label,
    priyaScore: moodUpdate.score,
    signalLine: signalLine(moodUpdate.signals),
    userName: currentUserName,
    vibe: currentVibe,
    stage: currentStage,
    history,
    summary: prevSession?.summary || "",
    recentReplies: recentAssistant,
  });

  const encoder = new TextEncoder();
  let fullReply = "";
  let replySource = "groq";
  const detectedMood: Mood = mapped.mood;
  const detectedConfidence = mapped.confidence;
  const detectedCues: string[] = mapped.cues;
  const detectedStage: Stage = currentStage;

  let isClosed = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      isClosed = true;
    },
    async start(controller) {
      const send = (payload: unknown) => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(payload)));
        } catch {
          isClosed = true;
        }
      };

      try {
        // Full-Groq turn: master prompt carries mood + vibe + memory.
        const result = await groqTurn({
          system,
          userMsg: msg,
          history,
          signals: moodUpdate.signals,
          lastAssistant: recentAssistant,
        });

        if (result) {
          fullReply = result.reply;
          replySource = result.source;
        } else {
          fullReply = pickEmergencyReply(recentAssistant);
          replySource = "emergency-fallback";
        }

        // Emit initial metadata frame (mood is deterministic).
        send({
          mood: detectedMood,
          confidence: detectedConfidence,
          cues: detectedCues,
          stage: detectedStage,
          userName: currentUserName || undefined,
        });

        for (const part of fullReply.split(/(\s+)/)) {
          if (part && !isClosed) {
            send({ token: part });
            await new Promise((r) => setTimeout(r, 16));
          }
        }

        // Emit final completion frame
        send({
          done: true,
          mood: detectedMood,
          confidence: detectedConfidence,
          cues: detectedCues,
          stage: detectedStage,
          userName: currentUserName || undefined,
        });
      } catch (err) {
        if (!isClosed) {
          console.error("Groq turn failed, using emergency fallback:", err);
          fullReply = pickEmergencyReply(recentAssistant);
          replySource = "emergency-fallback";

          send({
            mood: detectedMood,
            confidence: detectedConfidence,
            cues: detectedCues,
            stage: detectedStage,
            userName: currentUserName || undefined,
          });
          for (const part of fullReply.split(/(\s+)/)) {
            if (part && !isClosed) {
              send({ token: part });
              await new Promise((r) => setTimeout(r, 16));
            }
          }

          send({
            done: true,
            mood: detectedMood,
            confidence: detectedConfidence,
            cues: detectedCues,
            stage: detectedStage,
            userName: currentUserName || undefined,
          });
        }
      } finally {
        try {
          // Rolling summary every 8 turns — memory without RAG.
          let summary = prevSession?.summary ?? "";
          if (turnCount % 8 === 0 && fullReply) {
            const next = await summarizeTurns(
              [...history, { role: "user", content: msg } as ChatMessage],
              currentUserName,
            );
            if (next) summary = next;
          }
          saveSession(sessionId, {
            userName: currentUserName || undefined,
            mood: detectedMood,
            confidence: detectedConfidence,
            cues: detectedCues,
            stage: detectedStage,
            turns: turnCount,
            vibe: currentVibe,
            summary,
          });
        } catch (err) {
          console.error("session save failed:", err);
        }

        console.log(
          JSON.stringify({
            sessionId,
            mood: detectedMood,
            stage: detectedStage,
            turns: turnCount,
            source: replySource,
            latencyMs: Date.now() - startedAt,
          }),
        );
        if (!isClosed) {
          try {
            isClosed = true;
            controller.close();
          } catch {}
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export type { ChatMessage };
