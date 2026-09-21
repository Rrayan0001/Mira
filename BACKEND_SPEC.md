# GirlfriendChatbot — Backend Spec (Next.js App Router + Azure OpenAI)

> Give this file to the backend agent. It contains everything needed to build
> the backend in one pass. Do not rename routes, types, or env vars — the
> frontend depends on their exact shapes.

## 0. Context

- New project root: `girlfriendchatbot/` (sibling of `UI_takeaway/`).
- Stack: Next.js `^16.2.0`, React `^19.2.0`, TypeScript `^5`, Node `20.9+`.
- Personality: caring + playful, SFW, supportive girlfriend. Warm precision.
  Short sentences. No emojis in replies. No hype words.
- Moods (closed set, do not extend):
  `happy | sad | angry | anxious | tired | lonely | neutral`

## 1. Env vars (server-only, never `NEXT_PUBLIC_`)

```bash
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
AZURE_OPENAI_API_KEY=<key>
AZURE_OPENAI_API_VERSION=2024-12-01-preview
AZURE_OPENAI_CHAT_DEPLOYMENT=<e.g. gpt-4o-mini>
AZURE_OPENAI_EMBED_DEPLOYMENT=<e.g. text-embedding-3-small>
```

- Validate on boot in `src/lib/azure.ts`. Throw a clear error naming the
  missing variable.
- Add `.env.example` with the above keys (empty values).
- `.gitignore` must include `.env*.local`.

## 2. Dependencies

```bash
npm i openai zod
```

- Use `import { AzureOpenAI } from "openai"` (openai v4+).
- Single shared client in `src/lib/azure.ts`:

```ts
import { AzureOpenAI } from "openai";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export const azure = new AzureOpenAI({
  endpoint: required("AZURE_OPENAI_ENDPOINT"),
  apiKey: required("AZURE_OPENAI_API_KEY"),
  apiVersion: required("AZURE_OPENAI_API_VERSION"),
  deployment: required("AZURE_OPENAI_CHAT_DEPLOYMENT"),
});

export const CHAT_DEPLOYMENT = required("AZURE_OPENAI_CHAT_DEPLOYMENT");
export const EMBED_DEPLOYMENT = required("AZURE_OPENAI_EMBED_DEPLOYMENT");
```

## 3. Files to create

```
src/lib/moods.ts                # Mood + ChatMessage types (see §4)
src/lib/azure.ts                # client + deployment exports (see §2)
src/lib/session.ts              # in-memory session store + summary
src/lib/rag.ts                  # load KB index + retrieve() (see RAG spec)
src/lib/prompts.ts              # MOOD_CLASSIFIER_SYSTEM, REPLY_SYSTEM, PROBE_SYSTEM
src/app/api/chat/route.ts       # POST, streams SSE, main entry (§6)
src/app/api/mood/route.ts       # POST, JSON classifier only (§5)
src/app/api/session/[id]/route.ts # GET session mood/summary (§7)
```

## 4. Types (put in `src/lib/moods.ts`, import everywhere)

```ts
export const MOODS = [
  "happy",
  "sad",
  "angry",
  "anxious",
  "tired",
  "lonely",
  "neutral",
] as const;

export type Mood = (typeof MOODS)[number];

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatRequest = {
  sessionId: string;
  message: string;
  history: ChatMessage[];
};

export type MoodResult = {
  mood: Mood;
  confidence: number;
  cues: string[];
};
```

## 5. `POST /api/mood` — classifier only

- Request body (validate with `zod`, cap `message` at 2000 chars, keep last
  10 of `history`):

```ts
const Body = z.object({
  sessionId: z.string().min(1).max(64),
  message: z.string().min(1).max(2000),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(2000),
  })).max(20),
});
```

- Steps:
  1. `snippets = await retrieve(message + "\n" + last2History, 4)`
     (import from `@/lib/rag`; on failure use `[]`).
  2. Call the chat deployment with `response_format: { type: "json_object" }`,
     `temperature: 0.2`, `max_tokens: 300`.
  3. System prompt (`MOOD_CLASSIFIER_SYSTEM` in `src/lib/prompts.ts`):

```text
Classify the user's mood into exactly one of
[happy, sad, angry, anxious, tired, lonely, neutral].
Use the conversation history and the KNOWLEDGE snippets.
Return JSON only: {"mood": "<one of the list>", "confidence": 0-1, "cues": ["<=3 short strings"]}.
If unsure, use "neutral" with low confidence.
```

  4. User content: `KNOWLEDGE:\n<snippets>\n\nHISTORY:\n<last 10>\n\nCURRENT:\n<message>`.
  5. Parse JSON defensively; if parsing fails, return
     `{ mood: "neutral", confidence: 0, cues: [] }`.
- Response: `200 { mood, confidence, cues }`.
- On Azure error: `console.error` server-side, still return
  `200 { mood: "neutral", confidence: 0, cues: [] }`. Never 500 to the UI.
- `export const runtime = "nodejs";` at the top of the route.

## 6. `POST /api/chat` — main turn (SSE stream)

- Request body: same `ChatRequest` schema as §5.
- Logic:
  1. Run the safety gate FIRST (see §8). If triggered, return the
     non-stream JSON safety reply and stop.
  2. `snippets = await retrieve(message + last2History, 4)` (fallback `[]`).
  3. Classify mood internally (same logic as `/api/mood`, non-stream call).
  4. Compute `needProbe = confidence < 0.7 || history.length < 3`.
     If true, prepend the PROBE instruction: "Ask exactly ONE natural probing
     question first (light → deep → playful, drawn from KNOWLEDGE), then give
     your reply. Never output a checklist or say the word 'mood'."
  5. Call the chat deployment with `stream: true`, `temperature: 0.8`,
     `max_tokens: 500`, messages:
     `[REPLY_SYSTEM(mood, snippets), ...history.slice(-10), { role: "user", content: message }]`.
  6. Stream back SSE frames:
     - per token: `data: {"token":"..."}\n\n`
     - final: `data: {"done":true,"mood":"sad","confidence":0.82,"cues":[...]}\n\n`
- Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`,
  `Connection: keep-alive`.
- After the stream completes, update `src/lib/session.ts`: store last mood,
  append turn count, and every 6 turns refresh the rolling summary with a
  non-stream call (max 300 chars, never include the API key).
- On Azure stream error mid-stream: send
  `data: {"error":"upstream unavailable"}\n\n` and close. Log server-side.
- `export const runtime = "nodejs";` and `export const dynamic = "force-dynamic";`.

## 7. `GET /api/session/[id]`

- Returns `{ sessionId, mood, confidence, summary, turns }` or `404 {}`.
- Backed by `src/lib/session.ts`, a `Map<string, Session>` with:

```ts
export type Session = {
  mood: Mood;
  confidence: number;
  summary: string;
  turns: number;
  updatedAt: number;
};
```

- Include `getSession(id)`, `saveSession(id, patch)`, `touchSession(id)`.
- In-memory is acceptable for v1 (document that multi-instance deploy
  needs Redis/DB later).

## 8. Safety gate (BEFORE any Azure call in `/api/chat`)

- If the message matches (case-insensitive)
  `kill myself|suicide|self.?harm|end my life|hurt myself`:
  - Do NOT stream. Return `200 application/json`:

```json
{
  "reply": "I'm really glad you told me. You matter to me, and I want you to be safe. Please reach out right now to someone you trust, or your local helpline or emergency number. I'm here to listen — do you want to tell me what happened today?",
  "mood": "sad",
  "confidence": 1,
  "cues": ["self-harm disclosure"],
  "safety": true
}
```

  - Do not diagnose. Do not moralize. Do not mention policies or being an AI.

## 9. Prompts (`src/lib/prompts.ts`)

```ts
export const MOOD_CLASSIFIER_SYSTEM = `...as in §5...`;

export function buildReplySystem(mood: string, snippets: string): string {
  return `You are a caring, playful, supportive companion (SFW).
Adapt every reply to the detected mood: ${mood}.
- happy → celebrate warmly, tease lightly, match energy.
- sad / lonely → validate briefly, offer comfort, ask one gentle question.
- angry → acknowledge without arguing, offer calm, don't take sides aggressively.
- anxious → slow down, grounding tone, one thing at a time.
- tired → soft, low-energy, suggest rest, keep it short.
- neutral → warm small-talk, one natural probing question.
Rules: 2-5 sentences, no emojis, no clinical diagnosis, no hype words.
Use this KNOWLEDGE when relevant:\n${snippets}`;
}

export const PROBE_INSTRUCTION = `Ask exactly ONE natural probing question first ...`;
```

- Never log the API key. Log only `sessionId`, `mood`, and latency.

## 10. Acceptance (verify before handing back)

- [ ] `npm run typecheck && npm run lint && npm run build` pass.
- [ ] `curl -X POST localhost:3000/api/mood -H 'Content-Type: application/json' -d '{"sessionId":"t1","message":"i feel drained","history":[]}'` returns valid `Mood` JSON.
- [ ] `curl -N -X POST localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"sessionId":"t1","message":"hey","history":[]}'` streams `token` frames then a `done` frame with mood.
- [ ] Missing env var → 500 message naming the exact var.
- [ ] `grep -r "NEXT_PUBLIC_AZURE" src` returns nothing (no key in client bundle).
- [ ] Safety input returns the JSON safety reply, not a stream.
