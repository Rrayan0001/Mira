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
import { computeStage, extractName, getSession, saveSession, NON_NAME_WORDS } from "@/lib/session";
import { mockClassify } from "@/lib/mock-mood";
import { detectStyle, generateLocalReply } from "@/lib/local-reply";
import { DEFAULT_VIBE, VIBES } from "@/lib/vibes";
import { isStage, normalizeMood, type ChatMessage, type Mood, type Stage } from "@/lib/moods";

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
  userName?: string,
): Promise<void> {
  try {
    const transcript = [
      ...history.slice(-10),
      { role: "user", content: `${userName ? `(${userName}) ` : ""}${message}` } as ChatMessage,
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
      saveSession(sessionId, { mood: prev.mood, summary, userName: prev.userName });
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

  const { sessionId, message, history, userName: reqUserName, vibe: reqVibe } = parsed.data;

  // 1. Safety gate FIRST — before any Azure call. Non-stream JSON reply.
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

  // 2. Retrieve RAG snippets from the mood knowledge base.
  const snippets = await retrieve(buildQuery(message, history), 4);
  const knowledge =
    snippets.length > 0
      ? snippets.map((s) => `- ${s.text}`).join("\n")
      : "";

  // 3. Conversation lifecycle & stage calculation.
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
  const currentMood: Mood = prevSession?.mood ?? "neutral";

  // Anti-repeat + language context for the model (and the offline engine).
  // Policy: proper English replies always. Hinglish input is understood
  // (classifier covers it) but answered in English.
  const style = detectStyle(message);
  const recentAssistant = history
    .filter((h) => h.role === "assistant")
    .slice(-6)
    .map((h, i) => `${i + 1}. ${h.content.slice(0, 160)}`)
    .join("\n");
  const langHint =
    "Reply in proper natural English, always. If the user writes Hinglish or Hindi, understand it but answer in English. Never use Hindi words, never force another language on the user.";

  const systemPrompt = buildUnifiedChatSystem({
    currentMood,
    currentStage,
    turnCount,
    snippets: knowledge,
    summary: prevSession?.summary || "",
    userName: currentUserName,
    recentReplies: recentAssistant,
    langHint,
    vibe: currentVibe,
  });

  const encoder = new TextEncoder();
  let fullReply = "";
  let detectedMood: Mood = currentMood;
  let detectedConfidence = 0.85;
  let detectedCues: string[] = [];
  let detectedStage: Stage = currentStage;

  // Local heuristic baseline for this turn. Used as a safety net if the model
  // returns "neutral" despite clear emotional content, and to sanitize output.
  let heuristicMood: Mood = "neutral";
  let heuristicConfidence = 0;
  let heuristicCues: string[] = [];
  try {
    const h = mockClassify(message);
    heuristicMood = h.mood;
    heuristicConfidence = h.confidence;
    heuristicCues = h.cues;
  } catch {
    // ignore, keep neutral baseline
  }

  function sanitizeToken(text: string): string {
    // Strip any leaked META header fragments so they never reach the UI
    // (prevents garbage like raw "<!-- META ..." or truncated name bits).
    return text.replace(/<!--[\s\S]*?-->/g, "").replace(/<!--[\s\S]*$/g, "");
  }

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
            temperature: 0.85,
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
                    userName?: unknown;
                  };
                  const normalized = normalizeMood(metaObj.mood);
                  if (normalized) detectedMood = normalized;
                  if (typeof metaObj.confidence === "number")
                    detectedConfidence = Math.min(1, Math.max(0, metaObj.confidence));
                  if (Array.isArray(metaObj.cues))
                    detectedCues = metaObj.cues.filter((c): c is string => typeof c === "string");
                  if (isStage(metaObj.stage)) detectedStage = metaObj.stage;
                  if (typeof metaObj.userName === "string" && metaObj.userName.trim()) {
                    const candidate = metaObj.userName.trim();
                    const parts = candidate.split(/\s+/);
                    if (
                      candidate.toLowerCase() !== "null" &&
                      candidate.length >= 2 &&
                      candidate.length <= 30 &&
                      !parts.some((w) => NON_NAME_WORDS.has(w.toLowerCase()))
                    ) {
                      currentUserName = candidate;
                    }
                  }

                  // Emit initial metadata frame as soon as parsed
                  send({
                    mood: detectedMood,
                    confidence: detectedConfidence,
                    cues: detectedCues,
                    stage: detectedStage,
                    userName: currentUserName || undefined,
                  });
                } catch (e) {
                  console.error("meta parse error:", e);
                }
              }

              if (remainder) {
                const clean = sanitizeToken(remainder);
                if (clean) {
                  fullReply += clean;
                  send({ token: clean });
                }
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
                userName: currentUserName || undefined,
              });
              fullReply += metaBuffer;
              const cleanBuf = sanitizeToken(metaBuffer);
              if (cleanBuf) send({ token: cleanBuf });
            }
          } else {
            const clean = sanitizeToken(delta);
            if (clean) {
              fullReply += clean;
              send({ token: clean });
            }
          }
        }

        // If buffer was never completed
        if (inMeta && metaBuffer) {
          const cleanTail = sanitizeToken(metaBuffer);
          if (cleanTail) {
            fullReply += cleanTail;
            send({ token: cleanTail });
          }
        }

        // Safety net: never leave the badge stuck on NEUTRAL when the local
        // heuristic confidently sees disappointment/absence/loneliness.
        if (detectedMood === "neutral" && heuristicMood !== "neutral" && heuristicConfidence >= 0.7) {
          detectedMood = heuristicMood;
          detectedConfidence = heuristicConfidence;
          detectedCues = heuristicCues;
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
          console.error("Chat generation failed, using local engine:", err);
          const fallback = mockClassify(message);
          detectedMood = fallback.mood;
          detectedConfidence = fallback.confidence;
          detectedCues = fallback.cues;

          const isIntro = Boolean(currentUserName && (!prevSession?.userName && turnCount === 1));
          let mockReply = "";
          if (isIntro) {
            mockReply = `It's so wonderful to meet you, ${currentUserName}! How did today treat you?`;
          } else {
            // Diverse, reflective, language-matched offline reply.
            try {
              mockReply = generateLocalReply({
                mood: detectedMood,
                message,
                history,
                userName: currentUserName || undefined,
                stage: detectedStage,
                vibe: currentVibe,
              });
            } catch {
              mockReply = "I'm right here with you. Tell me a little more about what's on your mind?";
            }
          }
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

          if (turnCount % 6 === 0) {
            await refreshSummary(sessionId, history, message, fullReply, currentUserName);
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