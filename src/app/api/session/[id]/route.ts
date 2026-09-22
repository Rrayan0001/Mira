import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, saveSession } from "@/lib/session";
import { VIBES } from "@/lib/vibes";

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
      vibe: session.vibe,
    },
    { status: 200 },
  );
}

const SeedBody = z.object({
  userName: z.string().trim().min(2).max(30).optional(),
  vibe: z.enum(VIBES).optional(),
});

// POST /api/session/[id] — seed the per-chat cache with the popup name/vibe.
// Called when the user submits the startup popup (and when the navbar vibe
// changes), so every later /api/chat turn already knows both.
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
  const parsed = SeedBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  if (parsed.data.userName === undefined && parsed.data.vibe === undefined) {
    return NextResponse.json({ error: "nothing to seed" }, { status: 400 });
  }
  const session = saveSession(id, {
    ...(parsed.data.userName !== undefined ? { userName: parsed.data.userName } : {}),
    ...(parsed.data.vibe !== undefined ? { vibe: parsed.data.vibe } : {}),
  });
  return NextResponse.json(
    {
      sessionId: id,
      userName: session.userName,
      mood: session.mood,
      turns: session.turns,
      stage: session.stage,
      vibe: session.vibe,
    },
    { status: 200 },
  );
}
