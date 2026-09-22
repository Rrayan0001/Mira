/** Parity check: TS scoreMessage vs Python score_message (throwaway dev script). */
import { readFileSync } from "node:fs";
import { scoreMessage } from "../src/lib/priya/mood-engine";

type Expected = { msg: string; score: number; sig: Record<string, unknown> }[];
const expected: Expected = JSON.parse(readFileSync("/tmp/opencode/mood-expected.json", "utf8"));

function normSig(sig: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sig)) {
    if (v === true) out[k] = true;
    else if (Array.isArray(v) && v.length > 0) out[k] = [...v].sort();
  }
  return out;
}

let fail = 0;
for (const e of expected) {
  const [score, sig] = scoreMessage(e.msg);
  const got = normSig(sig as unknown as Record<string, unknown>);
  const want = normSig(e.sig);
  // Intentional divergences from Python's raw-substring matching
  // (documented in mood-engine.ts hasLex): short keys need word
  // boundaries, so inflected/substring doubles don't count.
  // NOTE: Python clamps to ±9, so expected TS scores are hand-verified
  // raw recomputations, not want±refund.
  const TS_SCORE_OVERRIDE: Record<string, number> = {
    "Good morning beautiful, I missed you": 8.0, // raw 10.0 minus "miss"⊂"missed"
    "whatever, not my problem": -5.0, // minus "hate"⊂"whatever"
    "I CHEATED ON YOU last night, she kissed me": -9.0, // raw -10.0, no warm "kiss"
  };
  const dropHit = (key: string, list: string) => {
    const arr = want[list];
    if (Array.isArray(arr) && arr.includes(key)) {
      want[list] = arr.filter((x) => x !== key);
      if ((want[list] as string[]).length === 0) delete want[list];
    }
  };
  if (e.msg.includes("missed")) dropHit("miss", "affection_hits");
  if (e.msg.includes("whatever")) dropHit("hate", "rude_hits");
  if (e.msg.toLowerCase().includes("cheat")) dropHit("kiss", "affection_hits");
  const wantScore = TS_SCORE_OVERRIDE[e.msg] ?? e.score;
  const scoreOk = Math.abs(score - wantScore) < 1e-9;
  const sigOk = JSON.stringify(got) === JSON.stringify(want);
  if (!scoreOk || !sigOk) {
    fail++;
    console.log(`MISMATCH "${e.msg}"`);
    if (!scoreOk) console.log(`  score: got ${score}, want ${wantScore}`);
    if (!sigOk) console.log(`  sig got:  ${JSON.stringify(got)}\n  sig want: ${JSON.stringify(want)}`);
  }
}
console.log(fail === 0 ? `PARITY OK (${expected.length} cases)` : `${fail} FAILURES`);
process.exit(fail ? 1 : 0);
