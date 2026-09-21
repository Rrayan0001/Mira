import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

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
