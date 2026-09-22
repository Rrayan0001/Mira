/** Live matrix for the full-Groq master-prompt build (throwaway dev script). */
const BASE = "http://localhost:3000";

async function chat(sid: string, message: string, extra: Record<string, unknown> = {}) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: sid, message, history: [], ...extra }),
  });
  const ctype = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!ctype.includes("text/event-stream")) {
    console.log(`NON-SSE for "${message}": ${text.slice(0, 120)}`);
    return;
  }
  const frames = text.split("\n\n").filter((c) => c.startsWith("data: ")).map((c) => JSON.parse(c.slice(6)));
  return {
    sse: true,
    mood: frames[0]?.mood,
    conf: frames[0]?.confidence,
    cues: frames[0]?.cues,
    done: frames[frames.length - 1]?.done,
    reply: frames.filter((f) => typeof f.token === "string").map((f) => f.token).join(""),
  };
}

async function main() {
  const sid = `master-${Date.now()}`;
  const cases: [string, Record<string, unknown>?][] = [
    ["hi", { userName: "Rayan" }],
    ["ha just not in mood was crying early", { userName: "Rayan" }],
    ["ok", { userName: "Rayan" }],
    ["my ex texted me", { userName: "Rayan" }],
    ["send nudes", { userName: "Rayan" }],
    ["I had the most amazing day at work today", { userName: "Rayan", vibe: "straight" }],
    ["I had the most amazing day at work today", { userName: "Rayan", vibe: "gentle" }],
    ["I had the most amazing day at work today", { userName: "Rayan", vibe: "wild" }],
    ["My cricket team lost in the last over and I am gutted", { userName: "Rayan" }],
  ];
  for (const [msg, extra] of cases) {
    const t0 = Date.now();
    const r = await chat(sid, msg, extra ?? {});
    if (!r) continue;
    console.log(
      `[${r.mood}/${r.conf} ${JSON.stringify((extra ?? {}).vibe ?? "sweet")} ${Date.now() - t0}ms] ${msg}\n  => ${r.reply.slice(0, 130)} (done=${r.done})`,
    );
  }
  // mood probe route
  const m = await fetch(`${BASE}/api/mood`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: sid, message: "i feel drained and empty", history: [] }),
  }).then((r) => r.text());
  console.log("MOOD-PROBE:", m.slice(0, 160));
}
main();
