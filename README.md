# girlfriendchatbot — Mira (mood-aware companion)

Forest · cream · peach theme ported from `UI_takeaway/src/app/globals.css:1`. Next.js 16, React 19, TypeScript, `lucide-react`, no animation library.

## Quick start

```bash
npm install
npm run dev
# http://localhost:3000  — ?welcome=stay keeps the welcome veil for preview
npm run typecheck && npm run lint && npm run build
```

## What this frontend does

- Welcome veil (`src/components/welcome-overlay.tsx:1`) — doodle draws in peach, loader, Skip + Escape, once-per-session, `prefers-reduced-motion` bypass (Rua pattern from `UI_takeaway/src/components/welcome-overlay.tsx:16`).
- Header (`src/app/page.tsx:8`) — sticky forest-dark bar, mood badge.
- Hero strip — forest with cream/ peach, explains 6 moods + gentle probes.
- Chat (`src/components/chat-ui.tsx:1`):
  - Bubbles: user = forest fill cream text right; bot = cream card left, serif italic for warmth.
  - Typing dots (peach), `role=log aria-live=polite`, timestamps, auto-scroll, Shift+Enter newline.
  - 3-step onboarding probes (`ONBOARDING:1`), then free chat; quick-reply chips.
  - Mood badge (6 moods: `src/lib/moods.ts:1`) with color dot + confidence, insight sidebar with cues + progress.
  - Calls `POST /api/chat` (SSE stream if available, JSON fallback) and `POST /api/mood`; safety keyword gate stays server-side.
  - Mock mode (`src/lib/mock-mood.ts:1`) lets the UI work without Azure — auto-switches to real streaming when `/api/chat` returns `text/event-stream` + `done` frame.

## Hand off to backend / RAG agents

- `BACKEND_SPEC.md:1` — routes, types, prompts, safety, SSE contract.
- `RAG_KB_SPEC.md:1` — KB files, chunking, `npm run kb:build`, `retrieve()`.
- After they run, this frontend needs **no code change** — it already speaks the spec.

## Configure Azure (when ready)

```bash
cp .env.example .env
# fill AZURE_OPENAI_ENDPOINT / KEY / VERSION / DEPLOYMENTS
npm run kb:build   # after RAG agent creates src/lib/mood-kb/*.md
npm run build
```

## Theme tokens

`--forest:#183d32 --forest-dark:#102d25 --cream:#f5f1e8 --peach:#edb58f --rust:#ab4d2c --ink:#203d32 --muted:#6b746b` · Fonts: Cormorant Garamond + DM Sans.

## Verification

```bash
npm run typecheck
npm run lint
npm run build
# then in another shell:
npm start & curl -s http://localhost:3000/api/mood -H 'Content-Type: application/json' -d '{"message":"i feel drained"}' | jq
curl -N -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"sessionId":"t1","message":"hey love","history":[]}'
```
