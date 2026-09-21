// faust-avatar-player.ts: sprite-sheet avatar player. No dependencies.
// TypeScript port of the spec's avatar.js — behaviour kept identical.
// The sheet layout lives entirely in AVATAR_CONFIG, so swapping the art
// later means editing this object only. pet.json is desktop-app metadata
// and is never loaded at runtime.

import type { Mood } from "@/lib/moods";

export type FaustStateName =
  | "idle"
  | "talking"
  | "thinking"
  | "wave"
  | "error"
  | "success";

export type FaustLoopName = "idle" | "talking" | "thinking";

type StateDef = {
  row: number; // 0-based row in the sheet
  frames: number; // how many cells to play (never an empty cell)
  fps: number;
  loop: boolean;
  still: number; // frame shown when the user prefers reduced motion
};

export const AVATAR_CONFIG = {
  sheet: "/assets/avatar/spritesheet.webp",
  cell: { w: 192, h: 208 }, // one frame, in source pixels
  states: {
    // Deliberately slow, near stop-motion pace, so each action reads
    // instead of flashing by. Non-looping states also hold their last
    // frame (see holdMs at the call sites) before handing over.
    idle: { row: 0, frames: 6, fps: 3, loop: true, still: 0 },
    talking: { row: 0, frames: 6, fps: 6, loop: true, still: 0 }, // idle pose, faster + CSS bob
    thinking: { row: 7, frames: 6, fps: 4, loop: true, still: 0 }, // laptop + spinner
    wave: { row: 4, frames: 8, fps: 3, loop: false, still: 4 }, // greeting / happy, ~2.7s
    error: { row: 5, frames: 8, fps: 3, loop: false, still: 0 }, // red X badge
    success: { row: 8, frames: 6, fps: 4, loop: false, still: 0 }, // green check badge
  } satisfies Record<FaustStateName, StateDef>,
};

type PlayOpts = {
  then?: FaustStateName | null;
  holdMs?: number;
  /** Play a looping state exactly once, then hand over to `then`. */
  once?: boolean;
};

/**
 * One reaction per mood, using existing sheet states only (no new art,
 * no new motion). `null` = no one-shot; she simply settles back to idle.
 * Fired when a reply finishes; streaming/typing/error keep priority.
 */
export const MOOD_REACTIONS: Record<
  Mood,
  { state: FaustStateName; holdMs: number } | null
> = {
  happy: { state: "wave", holdMs: 1400 },
  sacred: { state: "success", holdMs: 1200 },
  anxious: { state: "thinking", holdMs: 1500 },
  sad: null,
  angry: null,
  tired: null,
  lonely: null,
  neutral: null,
};

export class Avatar {
  readonly ready: Promise<void>;

  private el: HTMLDivElement;
  private cfg = AVATAR_CONFIG;
  private name: FaustStateName | null = null;
  private idx = 0;
  private last = 0;
  private raf = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private opts: Required<PlayOpts> = { then: null, holdMs: 0, once: false };
  private mq: MediaQueryList;
  private reduced: boolean;
  private dead = false;
  private onMq: (e: MediaQueryListEvent) => void;
  private tick: (t: number) => void;

  constructor(el: HTMLDivElement) {
    this.el = el;
    this.tick = this.tickFn.bind(this);

    this.mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reduced = this.mq.matches;
    this.onMq = (e) => {
      this.reduced = e.matches;
      if (this.name) this.play(this.name, this.opts);
    };
    this.mq.addEventListener("change", this.onMq);

    // Show the avatar only once the sheet has loaded. The chat stays
    // usable before that — a failed sheet just means no avatar.
    this.ready = new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () =>
        reject(new Error(`Could not load ${this.cfg.sheet}`));
      img.src = this.cfg.sheet;
    })
      .then(() => {
        this.el.classList.add("is-ready");
      })
      .catch((err: unknown) => {
        console.error(err);
      });
  }

  // play("wave", { then: "idle", holdMs: 400 })
  // Non-looping states hold their last frame, wait holdMs, then play `then`.
  // Pass once:true to run a looping state exactly once before handing over.
  play(
    name: FaustStateName,
    { then = null, holdMs = 0, once = false }: PlayOpts = {},
  ): void {
    if (this.dead) return;
    const s = this.cfg.states[name];
    if (!s) {
      console.warn(`Unknown avatar state: ${name}`);
      return;
    }
    cancelAnimationFrame(this.raf);
    if (this.timer) clearTimeout(this.timer);

    this.name = name;
    this.idx = 0;
    this.opts = { then, holdMs, once };
    this.el.dataset.state = name;
    this.el.classList.toggle("is-talking", name === "talking");

    if (this.reduced) {
      // One still frame per state, no continuous animation.
      this.show(s.still);
      if (!s.loop) this.queueThen(600);
      return;
    }
    this.show(0);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  setAttentive(on: boolean): void {
    this.el.classList.toggle("is-attentive", !!on);
  }

  destroy(): void {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    if (this.timer) clearTimeout(this.timer);
    this.mq.removeEventListener("change", this.onMq);
  }

  private tickFn(t: number): void {
    if (this.dead || !this.name) return;
    const s = this.cfg.states[this.name];
    if (t - this.last >= 1000 / s.fps) {
      this.last = t;
      if (this.idx + 1 < s.frames) {
        this.idx += 1;
      } else if (s.loop && !this.opts.once) {
        this.idx = 0;
      } else {
        this.queueThen(); // hold the last frame and stop stepping
        return;
      }
      this.show(this.idx);
    }
    this.raf = requestAnimationFrame(this.tick);
  }

  private queueThen(extraMs = 0): void {
    if (this.dead) return;
    const { then, holdMs } = this.opts;
    if (!then) return;
    this.timer = setTimeout(() => this.play(then), holdMs + extraMs);
  }

  private show(frame: number): void {
    if (!this.name) return;
    const s = this.cfg.states[this.name];
    this.el.style.setProperty("--fx", String(frame));
    this.el.style.setProperty("--fy", String(s.row));
  }
}
