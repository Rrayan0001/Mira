import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, saveSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) {
    return NextResponse.json({}, { status: 404 });
  }
  return NextResponse.json(
    {
      sessionId: id,
      userName: session.userName,
      mood: session.mood,
      confidence: session.confidence,
      summary: session.summary,
      turns: session.turns,
      stage: session.stage,
      cues: session.cues,
    },
    { status: 200 },
  );
}

const NameBody = z.object({
  userName: z.string().trim().min(2).max(30),
});

// POST /api/session/[id] — seed the per-chat cache with the popup name.
// Called once when the user submits the startup name popup, so every later
// /api/chat turn in this chat already knows who they are.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id || id.length > 64) {
    return NextResponse.json({ error: "invalid session id" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = NameBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const session = saveSession(id, { userName: parsed.data.userName });
  return NextResponse.json(
    {
      sessionId: id,
      userName: session.userName,
      mood: session.mood,
      turns: session.turns,
      stage: session.stage,
    },
    { status: 200 },
  );
}
