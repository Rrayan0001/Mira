"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Avatar, type FaustLoopName, type FaustStateName } from "@/lib/faust-avatar-player";

type Props = {
  /** Continuous state driven by the chat: idle | talking | thinking. */
  loop: FaustLoopName;
  /** One-shot reaction (mood mapped to an existing state). Increment n to fire. */
  signal: { state: FaustStateName; holdMs: number; n: number };
  /** Increment to play error → idle (request failed). */
  failed: number;
  /** User is actively typing — she leans in slightly. */
  attentive: boolean;
  /** Mobile keyboard open — shrink so the feed keeps room. */
  compact: boolean;
  /** Placement: in-flow centered above the composer, or viewport-docked. */
  side?: "center" | "left" | "right";
};

/**
 * Faust sprite avatar above the chat textbox. Decorative only
 * (aria-hidden); the chat works identically if the sheet never loads.
 */
export default function FaustAvatar({
  loop,
  signal,
  failed,
  attentive,
  compact,
  side = "center",
}: Props) {
  const avatarRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Avatar | null>(null);
  const mountedRef = useRef(false);
  const loopRef = useRef<FaustLoopName>(loop);
  useEffect(() => {
    loopRef.current = loop;
  });

  // Travel waypoints for side-docked placement, driven by window events
  // from the chat ("faust-travel"): rest → left → upper-right → center.
  // "center" auto-glides home after a beat.
  const [waypoint, setWaypoint] = useState<"rest" | "left" | "upper-right" | "center">("rest");
  useEffect(() => {
    if (side === "center") return;
    let homeTimer: ReturnType<typeof setTimeout> | undefined;
    const onTravel = (e: Event) => {
      const to = (e as CustomEvent<"rest" | "left" | "upper-right" | "center">).detail;
      if (to !== "rest" && to !== "left" && to !== "upper-right" && to !== "center") return;
      clearTimeout(homeTimer);
      setWaypoint(to);
      if (to === "center") {
        homeTimer = setTimeout(() => setWaypoint("rest"), 1800);
      }
    };
    window.addEventListener("faust-travel", onTravel);
    return () => {
      window.removeEventListener("faust-travel", onTravel);
      clearTimeout(homeTimer);
    };
  }, [side]);

  // Mount: create the player, greet with a wave once the sheet loads —
  // unless a chat turn is already in flight, which takes precedence.
  useEffect(() => {
    if (!avatarRef.current) return;
    const player = new Avatar(avatarRef.current);
    playerRef.current = player;
    mountedRef.current = true;
    void player.ready.then(() => {
      if (!mountedRef.current) return;
      if (loopRef.current === "idle") {
        player.play("wave", { then: "idle", holdMs: 300 });
      } else {
        player.play(loopRef.current);
      }
    });
    return () => {
      mountedRef.current = false;
      player.destroy();
      playerRef.current = null;
    };
  }, []);

  // Continuous state. Declared before the one-shots so a celebrate/fail
  // set in the same tick wins (effects run in declaration order).
  useEffect(() => {
    playerRef.current?.play(loop);
  }, [loop]);

  // One-shot: request failed → red ✗ pose, then idle.
  useEffect(() => {
    if (failed > 0) playerRef.current?.play("error", { then: "idle", holdMs: 1500 });
  }, [failed]);

  // One-shot mood reaction, then back to idle.
  useEffect(() => {
    if (signal.n > 0) {
      playerRef.current?.play(signal.state, {
        then: "idle",
        holdMs: signal.holdMs,
        once: true,
      });
    }
  }, [signal]);

  useEffect(() => {
    playerRef.current?.setAttentive(attentive);
  }, [attentive]);

  const sideClass =
    side === "left" ? " is-side-left" : side === "right" ? " is-side-right" : "";
  const wpClass =
    side !== "center" && waypoint !== "rest" ? ` wp-${waypoint}` : "";
  return (
    <div className={`faust-stage${sideClass}${wpClass}`} aria-hidden="true">
      <div
        ref={avatarRef}
        className="faust-avatar"
        data-state="idle"
        style={{ "--faust-w": compact ? "72px" : undefined } as CSSProperties}
      />
    </div>
  );
}
