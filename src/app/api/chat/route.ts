import { NextResponse } from "next/server";
import { z } from "zod";
import { SAFETY_REPLY, isSafetyTriggered } from "@/lib/safety";
import { computeStage, extractName, getSession, saveSession } from "@/lib/session";
import { DEFAULT_VIBE, VIBES } from "@/lib/vibes";
import type { ChatMessage, Mood, Stage } from "@/lib/moods";
import { priyaChat } from "@/lib/priya";
import { templateReply } from "@/lib/priya/reply-engine";

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

  const encoder = new TextEncoder();
  let fullReply = "";
  let detectedMood: Mood = prevSession?.mood ?? "neutral";
  let detectedConfidence = 0.6;
  let detectedCues: string[] = [];
  const detectedStage: Stage = currentStage;
  let replySource = "priya";

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
        // Priya brain: mood+RAG+templates, Groq gpt-oss-120b for novel turns.
        const result = await priyaChat({
          sessionId,
          message,
          userName: currentUserName || undefined,
          vibe: currentVibe,
          turnCount,
        });

        detectedMood = result.miraMood;
        detectedConfidence = result.confidence;
        detectedCues = result.cues;
        replySource = result.source;
        fullReply = result.reply;
        if (result.memories.length > 0) {
          // Memory explainability (not sent to client; server log only).
          console.log(
            JSON.stringify({
              sessionId,
              source: result.source,
              priya: `${result.priyaLabel}/${result.priyaScore}${result.priyaEmoji}`,
              mem: result.memories.map((m) => m.id),
            }),
          );
        }

        // Emit initial metadata frame (mood is deterministic — no META parse).
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
          console.error("Priya brain failed, using template fallback:", err);
          // On-voice template fallback (never the old generic engine).
          try {
            const fallback = templateReply({
              mood: "neutral",
              name: currentUserName || "babe",
              memories: [],
              signals: {
                affection_hits: [], rude_hits: [], conflict_hits: [], distress_hits: [],
                apology: false, repair: false, caring: false,
                jealousy_topic: false, short_dry: false, shouting: false,
                sweet_emoji: false, explicit_request: false,
                wholesome_intimacy: false, stonewall: false,
                distress: false, distress_acute: false,
              },
              msg: message,
              lastReply: "",
              recents: [],
              lastTopic: "",
              history: [],
            });
            fullReply = fallback;
            replySource = "template-fallback";
          } catch {
            fullReply = "I'm right here with you. Tell me a little more about what's on your mind?";
            replySource = "static-fallback";
          }

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
          saveSession(sessionId, {
            userName: currentUserName || undefined,
            mood: detectedMood,
            confidence: detectedConfidence,
            cues: detectedCues,
            stage: detectedStage,
            turns: turnCount,
            vibe: currentVibe,
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
