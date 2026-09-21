# Build Spec: Faust Sprite Avatar Above the Chat Textbox

**Audience:** a coding agent that has been given this file and `faust_openpet.zip` (contains `pet.json` and `spritesheet.webp`).
**Goal:** show an animated girl character directly above the message textbox of an existing AI companion chatbot website, reacting to chat events (typing, waiting for a reply, streaming a reply, error).

---

## 0. How to work

1. **Inspect the existing project first.** Find the framework, the chat page markup, the stylesheet, and the code that sends a message and streams the reply. Do **not** rewrite the chat. Add the avatar and a few hook calls.
2. If the project code is not visible to you, **ask the owner for it** instead of guessing. If you cannot ask, produce the framework-agnostic files below and a short integration note.
3. Unzip the archive. Put `spritesheet.webp` at `public/assets/avatar/spritesheet.webp` (or the project's static-assets equivalent) and keep the original file untouched. `pet.json` is metadata for a desktop app; do not load it at runtime.
4. Create the files in section 4, wire the hooks (section 7), and build the demo page (section 8).
5. Verify in a **real browser** at 390 px and 1280 px wide, and with "reduce motion" enabled. If you cannot run a browser, say so plainly in your report. Do not claim visual verification you did not do.
6. Finish with a short report: files added/changed, anything you could not verify, and every deviation from this spec.

Rules:

- Do not edit, recolour, upscale or "improve" the artwork. Non-destructive re-encoding is the only allowed change, and only if the owner asks.
- Keep the sheet path in **one place** (`AVATAR_CONFIG.sheet`) so the art can be swapped.
- No remote assets, no CDN scripts. The avatar is plain JS + CSS.
- Keep the avatar to the states in section 3. Do not add new poses, outfits or suggestive behaviour. The character has chibi proportions, which read young, so keep her behaviour neutral.

---

## 1. Read before building: blockers and honest limits

**Licence / IP (blocker for public or commercial launch).**
The character appears to be fan art of *Faust* from *Limbus Company* (Project Moon). That is an inference from the name and design, not a confirmed fact. The pack's author and licence are unknown. Build everything so the art can be replaced, and create `public/assets/avatar/ASSET-LICENCE.md` with these fields for the **owner** to fill in (do not invent values):

```
Source / URL:
Author:
Licence / permission:
Date obtained:
Commercial use allowed? (yes/no/unknown):
```

State in your final report that the asset's rights are unconfirmed.

**What the art can and cannot do.** Measured from the sheet:

- Only **one row has real animation** (the wave). Every other row is a single pose nudged 0-2 px up and down, so "idle" is a gentle bob, not breathing or blinking.
- There is **no talking pose** (no mouth frames), **no listening, sad, shy or affectionate pose**, and her default expression is deadpan.
- The **badges are part of the pixels** (laptop + spinner, red ✗, green ✓ + sparkles). They cannot be removed without editing the art.
- The spinner in the laptop row does not spin; it is a static picture.
- Cells are **192 x 208 px (not square)**. Displayed at ~176 px wide she is slightly soft on high-DPI screens.
- A faint dotted ring is drawn under her feet. Check it on light and dark backgrounds and mention it in your report if it looks like a smudge.

These are limits of the art, not bugs in your build. The fixes are new art (section 11), not code tricks.

---

## 2. Asset facts (measured)

| Property | Value |
|---|---|
| File | `spritesheet.webp`, 714,604 bytes, RGBA with transparency |
| Sheet size | 1536 x 1872 px |
| Grid | 8 columns x 9 rows |
| Cell size | 192 x 208 px |
| Feet line | Bottom of the character is ~row 202-205 of each cell (a 0-3 px bob) |

Rows are **0-based from the top**. Verify them visually with the demo page (section 8) before trusting this table.

| Row | Filled cells | Content | Use |
|---|---|---|---|
| 0 | 7 (use first 6) | Neutral standing pose, bobs 0-1 px. The 7th cell differs slightly; ignore it. | `idle`, `talking` |
| 1 | 8 | Same neutral pose, bob only | unused |
| 2 | 8 | Neutral pose with legs apart, bob only | unused |
| 3 | 4 | Neutral pose, bob only | unused |
| 4 | 8 | Raised-hand wave in frames 3-5, eyes close in frame 5; frames 0-2 and 6-7 are neutral | `wave` |
| 5 | 8 | Red ✗ badge, worried pose | `error` |
| 6 | 6 | Neutral pose, identical to row 0 | unused |
| 7 | 6 | Holding a tablet/laptop, spinner dots at right (static), bob only | `thinking` |
| 8 | 6 | Wink, raised fist, green ✓ and sparkle marks, bob only | `success` |

Empty cells: row 0 col 7; row 3 cols 4-7; rows 6, 7, 8 cols 6-7. **Never play an empty cell.**

---

## 3. State design: what the site needs vs. what the art gives

| Chat event | Avatar state | Source | Notes |
|---|---|---|---|
| Page loads | `wave` then `idle` | row 4, row 0 | A greeting. |
| Nothing happening | `idle` | row 0 | Loops. |
| User is typing | `idle` + `is-attentive` CSS class | row 0 | No listening pose exists, so she leans slightly (CSS transform). |
| Message sent, waiting for first token | `thinking` | row 7 | The laptop badge is dev-flavoured but acceptable as "working on it". |
| Reply streaming | `talking` | row 0 at 12 fps + CSS bob | **Fake**: no mouth frames exist. |
| Reply finished, tagged `[happy]` | `wave` then `idle` | row 4 | The wave doubles as "happy". |
| Reply finished, tagged `[neutral]` or untagged | `idle` | row 0 | |
| Request failed | `error` then `idle` | row 5 | Red ✗ badge. |
| (optional) Something completed | `success` | row 8 | Shows a ✓ badge; suits "saved/done" moments, **not** affection. Leave unwired unless the owner asks. |

Only two emotion tags are supported (`neutral`, `happy`) because the art has nothing else.

---

## 4. Files to create or change

```
public/assets/avatar/
  spritesheet.webp            <- from the zip, unmodified
  ASSET-LICENCE.md            <- template from section 1, left for the owner
src/ (or your JS folder)
  avatar.js                   <- section 5
  chat-avatar.js              <- section 7 (hook wiring; adapt to the project)
styles
  avatar.css                  <- section 6 (or append to the existing stylesheet)
avatar-demo.html              <- section 8 (dev-only test page)
```

Use the project's own conventions (TypeScript, bundler, component framework) if it has them. The code below is plain ES modules; port it, keeping the behaviour. For React/Vue/Svelte, create the `Avatar` instance in the mount hook and call `destroy()` on unmount.

---

## 5. `avatar.js` (player)

This was tested in Node with a mocked DOM and a manual clock (state changes, looping, one-shot hold-then-return, stale-timer cancellation, reduced motion). It has **not** been run in a real browser, so verify that.

```js
// avatar.js: sprite-sheet avatar player. No dependencies.
// The sheet layout lives entirely in AVATAR_CONFIG, so swapping the art
// later means editing this object only.

export const AVATAR_CONFIG = {
  sheet: "/assets/avatar/spritesheet.webp",
  cell: { w: 192, h: 208 },          // one frame, in source pixels
  states: {
    // row = 0-based row in the sheet, frames = how many cells to play
    // still = frame shown when the user prefers reduced motion
    idle:     { row: 0, frames: 6, fps: 6,  loop: true,  still: 0 },
    talking:  { row: 0, frames: 6, fps: 12, loop: true,  still: 0 }, // idle pose, faster + CSS bob
    thinking: { row: 7, frames: 6, fps: 8,  loop: true,  still: 0 }, // laptop + spinner
    wave:     { row: 4, frames: 8, fps: 8,  loop: false, still: 4 }, // greeting / happy
    error:    { row: 5, frames: 8, fps: 8,  loop: false, still: 0 }, // red X badge
    success:  { row: 8, frames: 6, fps: 8,  loop: false, still: 0 }, // green check badge
  },
};

export class Avatar {
  constructor(el, config = AVATAR_CONFIG) {
    this.el = el;
    this.cfg = config;
    this.name = null;
    this.idx = 0;
    this.last = 0;
    this.raf = 0;
    this.timer = 0;
    this.opts = { then: null, holdMs: 0 };
    this._tick = this._tick.bind(this);

    this.mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reduced = this.mq.matches;
    this._onMq = (e) => {
      this.reduced = e.matches;
      if (this.name) this.play(this.name, this.opts);
    };
    this.mq.addEventListener("change", this._onMq);

    // Show the avatar only once the sheet has loaded.
    this.ready = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = resolve;
      img.onerror = () => reject(new Error(`Could not load ${config.sheet}`));
      img.src = config.sheet;
    })
      .then(() => this.el.classList.add("is-ready"))
      .catch((err) => console.error(err));
  }

  // play("wave", { then: "idle", holdMs: 400 })
  // Non-looping states hold their last frame, wait holdMs, then play `then`.
  play(name, { then = null, holdMs = 0 } = {}) {
    const s = this.cfg.states[name];
    if (!s) {
      console.warn(`Unknown avatar state: ${name}`);
      return;
    }
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);

    this.name = name;
    this.idx = 0;
    this.opts = { then, holdMs };
    this.el.dataset.state = name;
    this.el.classList.toggle("is-talking", name === "talking");

    if (this.reduced) {
      // One still frame per state, no continuous animation.
      this._show(s.still);
      if (!s.loop) this._queueThen(600);
      return;
    }
    this._show(0);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this._tick);
  }

  setAttentive(on) {
    this.el.classList.toggle("is-attentive", !!on);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.mq.removeEventListener("change", this._onMq);
  }

  _tick(t) {
    const s = this.cfg.states[this.name];
    if (t - this.last >= 1000 / s.fps) {
      this.last = t;
      if (this.idx + 1 < s.frames) {
        this.idx += 1;
      } else if (s.loop) {
        this.idx = 0;
      } else {
        this._queueThen();          // hold the last frame and stop stepping
        return;
      }
      this._show(this.idx);
    }
    this.raf = requestAnimationFrame(this._tick);
  }

  _queueThen(extraMs = 0) {
    const { then, holdMs } = this.opts;
    if (!then) return;
    this.timer = setTimeout(() => this.play(then), holdMs + extraMs);
  }

  _show(frame) {
    const s = this.cfg.states[this.name];
    this.el.style.setProperty("--fx", String(frame));
    this.el.style.setProperty("--fy", String(s.row));
  }
}
```

Design notes:

- `--fx` / `--fy` are the current column and row; CSS turns them into a background offset.
- Non-looping states hold their last frame, wait `holdMs`, then play `then`. Starting any new state cancels pending timers, so an old timeout can never override a newer state.
- Under `prefers-reduced-motion` there is no continuous animation: each state shows one still frame and one-shot states still hand over to `then`.
- `requestAnimationFrame` is already paused by browsers in background tabs. No extra visibility code is needed.

---

## 6. Markup and CSS

```html
<section class="companion" aria-label="Chat">
  <div class="messages" id="messages" role="log" aria-live="polite"></div>

  <div class="stage">
    <div class="avatar" id="avatar" data-state="idle" aria-hidden="true"></div>
  </div>

  <form class="composer" id="composer">
    <label class="sr-only" for="input">Message</label>
    <textarea id="input" rows="1" placeholder="Say something..."></textarea>
    <button type="submit">Send</button>
  </form>
</section>
```

If the project already has a chat layout, keep it and only insert the `.stage` block directly above the textbox/composer.

```css
:root {
  --avatar-w: 176px;                                  /* display width */
  --avatar-h: calc(var(--avatar-w) * 208 / 192);      /* keeps the 192:208 cell ratio */
}

.stage {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: center;                /* flex-start / flex-end to pin left / right */
  align-items: flex-start;
  height: calc(var(--avatar-h) * 0.88);   /* bottom 12% overlaps the composer */
  pointer-events: none;                   /* never block the textbox */
}

.avatar {
  --fx: 0;
  --fy: 0;
  width: var(--avatar-w);
  height: var(--avatar-h);
  background-image: url("/assets/avatar/spritesheet.webp");
  background-repeat: no-repeat;
  background-size: calc(var(--avatar-w) * 8) auto;   /* 8 columns; height follows the ratio */
  background-position:
    calc(var(--avatar-w) * var(--fx) * -1)
    calc(var(--avatar-h) * var(--fy) * -1);
  opacity: 0;                                         /* shown when the sheet has loaded */
  transition: opacity 0.25s, transform 0.2s;
}
.avatar.is-ready { opacity: 1; }

.avatar.is-attentive { transform: translateY(-2px) rotate(-1.5deg); }

@keyframes talk-bob {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-3px); }
}
.avatar.is-talking { animation: talk-bob 0.35s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .avatar { transition: none; }
  .avatar.is-attentive { transform: none; }
  .avatar.is-talking { animation: none; }
}

/* Small phones: shrink so the message list keeps room */
@media (max-width: 480px) { :root { --avatar-w: 120px; } }

.sr-only {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap;
}
```

Layout requirements:

- The stage has `pointer-events: none`, and the avatar inherits it. A tap on her must reach the textbox.
- Use `100dvh` (not `100vh`) for full-height chat layouts so mobile address bars don't clip the composer.
- Match the site's existing colours and fonts. Do not add new visual chrome around her.
- Shrink her while the mobile keyboard is open:

```js
if (window.visualViewport) {
  visualViewport.addEventListener("resize", () => {
    const keyboardOpen = visualViewport.height < window.innerHeight * 0.75;
    document.documentElement.style.setProperty("--avatar-w", keyboardOpen ? "72px" : "");
  });
}
```

---

## 7. Wiring the chat (`chat-avatar.js`)

**Integration points.** Find these in the existing code and add one call at each. Do not restructure the chat.

| Where in the existing code | Call |
|---|---|
| Textbox `input` event | `hooks.typing()` |
| Just before the request is sent | `hooks.sent()` |
| First streamed chunk arrives | `hooks.firstToken()` |
| Stream finished successfully | `hooks.done(emotion)` |
| Request failed / threw | `hooks.failed()` |

```js
import { Avatar } from "./avatar.js";

const avatar = new Avatar(document.getElementById("avatar"));
avatar.ready.then(() => avatar.play("wave", { then: "idle", holdMs: 300 }));

let attentiveTimer;

export const hooks = {
  typing() {
    avatar.setAttentive(true);
    clearTimeout(attentiveTimer);
    attentiveTimer = setTimeout(() => avatar.setAttentive(false), 2500);
  },
  sent() {
    clearTimeout(attentiveTimer);
    avatar.setAttentive(false);
    avatar.play("thinking");
  },
  firstToken() {
    avatar.play("talking");
  },
  done(emotion) {
    if (emotion === "happy") avatar.play("wave", { then: "idle", holdMs: 300 });
    else avatar.play("idle");
  },
  failed() {
    avatar.play("error", { then: "idle", holdMs: 1500 });
  },
};

// Emotion tags: the model starts each reply with [neutral] or [happy].
const EMOTIONS = new Set(["neutral", "happy"]);
const TAG_FULL = /^\s*\[(\w+)\]\s*/;
const TAG_PARTIAL = /^\s*\[\w*$/;          // tag still arriving across chunks

export function visibleText(raw) {
  return TAG_PARTIAL.test(raw) ? "" : raw.replace(TAG_FULL, "");
}
export function parseEmotion(raw) {
  const m = raw.match(TAG_FULL);
  const name = m ? m[1].toLowerCase() : "neutral";
  return EMOTIONS.has(name) ? name : "neutral";   // whitelist: never trust raw model output
}
```

**Reference handler** (only if the project has no streaming handler to hook into):

```js
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  addMessage("user", text);
  hooks.sent();

  const bubble = addMessage("bot", "");
  let raw = "";
  let first = true;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    if (!res.ok || !res.body) throw new Error("Bad response");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      if (first) { hooks.firstToken(); first = false; }
      bubble.textContent = visibleText(raw);          // textContent, never innerHTML
      messages.scrollTop = messages.scrollHeight;
    }
    hooks.done(parseEmotion(raw));
  } catch {
    bubble.textContent = "Something went wrong. Please try again.";
    hooks.failed();
  }
});

function addMessage(role, text) {
  const el = document.createElement("p");
  el.className = `msg ${role}`;
  el.textContent = text;
  messages.appendChild(el);
  return el;
}
```

**System prompt line** to add on the backend (do not show it to users):

```
Begin every reply with exactly one tag, either [neutral] or [happy], then a space, then your reply.
Never mention or explain the tag.
```

Backend rules:

- Strip the tag **before saving chat history** so it does not pollute later prompts.
- If the project's backend or streaming format differs (SSE, JSON lines, WebSocket), adapt `visibleText` and the chunk handling; keep the same five hook calls.
- If the existing chat uses a different sanitising approach for message text, keep it. Never insert model output with `innerHTML`.

---

## 8. Demo / test page (`avatar-demo.html`, dev only)

A standalone page with no backend that lets a human verify the art mapping. Requirements:

1. Loads `avatar.js`, `avatar.css` and the sheet, and shows the avatar on a light and a dark panel side by side.
2. One button per key of `AVATAR_CONFIG.states`, calling `avatar.play(key, { then: "idle", holdMs: 800 })`.
3. A toggle that shows the **raw sheet with a grid overlay** (8 x 9 cells, labelled `row,col`, 0-based) so the row table in section 2 can be checked by eye.
4. A slider that changes `--avatar-w` between 96 and 240 px.
5. A dummy textarea below the stage to check the overlap and that clicks pass through.
6. A short note telling the tester to switch on the OS "reduce motion" setting and reload to check the reduced-motion behaviour.

Do not ship this page to production. Note its path in your report.

---

## 9. Performance, accessibility, mobile

- The sheet is ~714 KB. Serve it with a hashed filename and `Cache-Control: public, max-age=31536000, immutable`. Do not re-encode it unless the owner asks; if you do, compare frames visually against the original and keep the original file.
- The avatar loads lazily in effect: the chat must be usable before `avatar.ready` resolves. If the sheet fails to load, log the error and leave the chat working with no avatar.
- The avatar is decorative: `aria-hidden="true"`. Never convey information only through her pose.
- Honour `prefers-reduced-motion` (already in the code and CSS).
- Do not add sound.
- No `localStorage`/cookies are needed for this feature.

---

## 10. Acceptance checklist

Verify each item, and mark items you could not verify as such in your report.

- [ ] Avatar appears above the textbox on desktop (1280 px) and phone (390 px); it does not cover message text.
- [ ] Tapping/clicking where she stands focuses the textbox (clicks pass through).
- [ ] On load: brief wave, then idle.
- [ ] Typing makes her lean slightly; stopping for ~2.5 s relaxes her.
- [ ] Sending a message shows the laptop/spinner pose until the first token.
- [ ] While the reply streams she bobs at the faster rate (talking).
- [ ] A `[happy]` reply ends with a wave then idle; a `[neutral]` or untagged reply ends on idle.
- [ ] A failed request shows the red ✗ pose, then returns to idle.
- [ ] No empty cell is ever shown (no blank flashes). Check every state in the demo page.
- [ ] The emotion tag is never visible to the user, even while it is still streaming in, and is not stored in history.
- [ ] With OS "reduce motion" on: no continuous animation, state changes still work.
- [ ] No console errors; chat still works if `spritesheet.webp` is blocked.
- [ ] `ASSET-LICENCE.md` exists with blanks for the owner, and your report flags the unconfirmed rights.

---

## 11. Replacing the art later (recommended before public launch)

Because the sheet layout lives in `AVATAR_CONFIG`, new art means: drop in a new sheet, edit the config, add states. No chat code changes.

For a proper companion character, commission an **original** sheet with real frame-to-frame animation:

| State | Frames | Notes |
|---|---|---|
| `idle` | 6-8 | Breathing, blink, small sway |
| `listening` | 4-6 | Head tilt / leaning in |
| `thinking` | 6 | No dev-style badges |
| `talking` | 6 | Real mouth shapes |
| `happy` | 6 | Smile / small bounce |
| `sad` | 6 | Sympathetic replies |
| `shy` | 6 | Blush, looks away |
| `error` | 6 | Confused / apologetic, no badge baked in |

Spec: transparent WebP or PNG, one row per state, identical column count, 256 x 256 px cells (or 192 x 208 to match this build), feet on the same line in every frame, under ~500 KB. Get a written commercial-use licence and the source files. Use an original character and design her as a clearly adult character with a non-explicit default look, because payment processors and app stores scrutinise companion apps.

If you later want a richer avatar (Live2D or a 3D VRM model), keep the same `Avatar` interface (`play(name, opts)`, `setAttentive(on)`, `destroy()`, `ready`) so the hook wiring in section 7 does not change.
