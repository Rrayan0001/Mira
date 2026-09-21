import { NextResponse } from "next/server";
import { z } from "zod";
import { classifyMood } from "@/lib/classify";

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

  const { message, history } = parsed.data;
  // classifyMood never throws: returns neutral fallback on Azure/RAG failure.
  // Always 200 to the UI per spec (missing env vars surface as 500 at import).
  const result = await classifyMood(message, history.slice(-10));
  return NextResponse.json(result, { status: 200 });
}

// The frontend probes HEAD /api/mood to auto-detect a live backend
// (see chat-ui.tsx). Answer without touching Azure.
export async function HEAD() {
  return new Response(null, { status: 200 });
}
