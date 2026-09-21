import { NextResponse } from "next/server";
import { z } from "zod";
import { getAzure, getChatDeployment } from "@/lib/azure";
import { buildQuery } from "@/lib/classify";
import {
  SUMMARY_SYSTEM,
  buildUnifiedChatSystem,
} from "@/lib/prompts";
import { retrieve } from "@/lib/rag";
import { SAFETY_REPLY, isSafetyTriggered } from "@/lib/safety";
import { computeStage, getSession, saveSession } from "@/lib/session";
import { MOCK_REPLIES, mockClassify } from "@/lib/mock-mood";
import { isMood, isStage, type ChatMessage, type Mood, type Stage } from "@/lib/moods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  sessionId: z.string().min(1).max(64),
  message: z.string().min(1).max(2000),
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

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([p, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function refreshSummary(
  sessionId: string,
  history: ChatMessage[],
  message: string,
  reply: string,
): Promise<void> {
  try {
    const transcript = [
      ...history.slice(-10),
      { role: "user", content: message } as ChatMessage,
      { role: "assistant", content: reply } as ChatMessage,
    ]
      .map((h) => `${h.role}: ${h.content}`)
      .join("\n")
      .slice(0, 4000);
    const azure = getAzure();
    const res = await azure.chat.completions.create({
      model: getChatDeployment(),
      temperature: 0.2,
      max_tokens: 120,
      messages: [
        { role: "system", content: SUMMARY_SYSTEM },
        { role: "user", content: transcript },
      ],
    });
    const summary = (res.choices[0]?.message?.content ?? "")
      .trim()
      .slice(0, 300);
    const prev = getSession(sessionId);
    if (prev) {
      saveSession(sessionId, { mood: prev.mood, summary });
    }
  } catch (err) {
    console.error("summary refresh failed:", err);
  }
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

  const { sessionId, message, history } = parsed.data;

  // 1. Safety gate FIRST — before any Azure call. Non-stream JSON reply.
  if (isSafetyTriggered(message)) {
    try {
      const prev = getSession(sessionId);
      saveSession(sessionId, {
        mood: "sad",
        confidence: 1,
        stage: "comfort_action",
        cues: ["self-harm disclosure"],
        turns: (prev?.turns ?? 0) + 1,
      });
    } catch (err) {
      console.error("session save failed:", err);
    }
    return NextResponse.json(SAFETY_REPLY, { status: 200 });
  }

  // 2. Retrieve RAG snippets from the mood knowledge base.
  const snippets = await retrieve(buildQuery(message, history), 4);
  const knowledge =
    snippets.length > 0
      ? snippets.map((s) => `- ${s.text}`).join("\n")
      : "";

  // 3. Conversation lifecycle & stage calculation.
  const prevSession = getSession(sessionId);
  const turnCount = (prevSession?.turns ?? 0) + 1;
  const currentStage: Stage = computeStage(turnCount);
  const currentMood: Mood = prevSession?.mood ?? "neutral";

  const systemPrompt = buildUnifiedChatSystem({
    currentMood,
    currentStage,
    turnCount,
    snippets: knowledge,
    summary: prevSession?.summary || "",
  });

  const encoder = new TextEncoder();
  let fullReply = "";
  let detectedMood: Mood = currentMood;
  let detectedConfidence = 0.85;
  let detectedCues: string[] = [];
  let detectedStage: Stage = currentStage;

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
        const azure = getAzure();
        const responseStream = await withTimeout(
          azure.chat.completions.create({
            model: getChatDeployment(),
            temperature: 0.75,
            max_tokens: 450,
            stream: true,
            messages: [
              { role: "system", content: systemPrompt },
              ...history
                .slice(-16)
                .map((h) => ({ role: h.role, content: h.content }) as const),
              { role: "user" as const, content: message },
            ],
          }),
          25000,
        );

        let inMeta = true;
        let metaBuffer = "";

        for await (const chunk of responseStream) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (!delta) continue;

          if (inMeta) {
            metaBuffer += delta;
            const endIdx = metaBuffer.indexOf("-->");
            if (endIdx !== -1) {
              inMeta = false;
              const metaChunk = metaBuffer.slice(0, endIdx + 3);
              const remainder = metaBuffer.slice(endIdx + 3).replace(/^\s+/, "");

              const metaMatch = metaChunk.match(/<!--\s*META:\s*({[\s\S]*?})\s*-->/);
              if (metaMatch) {
                try {
                  const metaObj = JSON.parse(metaMatch[1]) as {
                    mood?: unknown;
                    confidence?: unknown;
                    cues?: unknown;
                    stage?: unknown;
                  };
                  if (isMood(metaObj.mood)) detectedMood = metaObj.mood;
                  if (typeof metaObj.confidence === "number")
                    detectedConfidence = Math.min(1, Math.max(0, metaObj.confidence));
                  if (Array.isArray(metaObj.cues))
                    detectedCues = metaObj.cues.filter((c): c is string => typeof c === "string");
                  if (isStage(metaObj.stage)) detectedStage = metaObj.stage;

                  // Emit initial metadata frame as soon as parsed
                  send({
                    mood: detectedMood,
                    confidence: detectedConfidence,
                    cues: detectedCues,
                    stage: detectedStage,
                  });
                } catch (e) {
                  console.error("meta parse error:", e);
                }
              }

              if (remainder) {
                fullReply += remainder;
                send({ token: remainder });
              }
            } else if (metaBuffer.length > 200 && !metaBuffer.includes("<!--")) {
              // No meta tag output by model; treat entire buffer as text
              inMeta = false;
              const fallback = mockClassify(message);
              detectedMood = fallback.mood;
              detectedConfidence = fallback.confidence;
              detectedCues = fallback.cues;
              send({
                mood: detectedMood,
                confidence: detectedConfidence,
                cues: detectedCues,
                stage: detectedStage,
              });
              fullReply += metaBuffer;
              send({ token: metaBuffer });
            }
          } else {
            fullReply += delta;
            send({ token: delta });
          }
        }

        // If buffer was never completed
        if (inMeta && metaBuffer) {
          fullReply += metaBuffer;
          send({ token: metaBuffer });
        }

        // Emit final completion frame
        send({
          done: true,
          mood: detectedMood,
          confidence: detectedConfidence,
          cues: detectedCues,
          stage: detectedStage,
        });
      } catch (err) {
        if (!isClosed) {
          console.error("Chat generation failed, falling back to mock:", err);
          const fallback = mockClassify(message);
          detectedMood = fallback.mood;
          detectedConfidence = fallback.confidence;
          detectedCues = fallback.cues;

          const pool = MOCK_REPLIES[detectedMood] ?? MOCK_REPLIES.neutral;
          const mockReply = pool[Math.floor(Math.random() * pool.length)]!;
          fullReply = mockReply;

          for (const part of mockReply.split(/(\s+)/)) {
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
          });
        }
      } finally {
        try {
          saveSession(sessionId, {
            mood: detectedMood,
            confidence: detectedConfidence,
            cues: detectedCues,
            stage: detectedStage,
            turns: turnCount,
          });

          if (turnCount % 6 === 0) {
            await refreshSummary(sessionId, history, message, fullReply);
          }
        } catch (err) {
          console.error("session save failed:", err);
        }

        console.log(
          JSON.stringify({
            sessionId,
            mood: detectedMood,
            stage: detectedStage,
            turns: turnCount,
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