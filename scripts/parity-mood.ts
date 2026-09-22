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
  const scoreOk = Math.abs(score - e.score) < 1e-9;
  const sigOk = JSON.stringify(got) === JSON.stringify(want);
  if (!scoreOk || !sigOk) {
    fail++;
    console.log(`MISMATCH "${e.msg}"`);
    if (!scoreOk) console.log(`  score: got ${score}, want ${e.score}`);
    if (!sigOk) console.log(`  sig got:  ${JSON.stringify(got)}\n  sig want: ${JSON.stringify(want)}`);
  }
}
console.log(fail === 0 ? `PARITY OK (${expected.length} cases)` : `${fail} FAILURES`);
process.exit(fail ? 1 : 0);
