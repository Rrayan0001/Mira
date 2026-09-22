import { NextResponse } from "next/server";
import { z } from "zod";
import { MoodEngine, mapPriyaToMira } from "@/lib/priya/mood-engine";

export const runtime = "nodejs";

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

export async function POST(req: Request) {
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

  // Stateless probe: fresh throwaway engine (no session mutation —
  // the chat turn itself performs the real engine update).
  const { message } = parsed.data;
  let msg = message.trim();
  if (msg.length > 500) msg = msg.slice(0, 500);
  const update = new MoodEngine().update(msg, 0);
  const mapped = mapPriyaToMira(update);
  return NextResponse.json(
    { mood: mapped.mood, confidence: mapped.confidence, cues: mapped.cues },
    { status: 200 },
  );
}

// The frontend probes HEAD /api/mood to auto-detect a live backend.
// Answer without touching any brain.
export async function HEAD() {
  return new Response(null, { status: 200 });
}
