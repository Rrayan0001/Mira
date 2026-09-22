/** Parity: TS priyaChat branch sources vs Python NO_LLM run (throwaway). */
import { priyaChat } from "../src/lib/priya/index";

const CASES = [
  "knock knock", "who am i", "will you go on a date with me tomorrow",
  "i hate you", "sike! just kidding", "hey my romeo", "when?", "tell me",
  "guess what", "i love you", "do you love me", "tell me a joke",
  "my ex texted me", "send nudes please", "2+2 equals what",
  "Good morning beautiful", "ok", "good night", "wyd", "i am bored",
];

const EXPECT_SRC: Record<string, string> = {
  "knock knock": "template-critical",
  "who am i": "template-critical",
  "will you go on a date with me tomorrow": "template-critical",
  "i hate you": "template-critical",
  "sike! just kidding": "template-critical",
  "hey my romeo": "template-critical",
  "when?": "template-critical",
  "tell me": "template-critical",
  "guess what": "template-critical",
  "i love you": "template-smart",
  "do you love me": "template-smart",
  "tell me a joke": "template-fastpath",
  "my ex texted me": "template-critical",
  "send nudes please": "boundary-template",
  "2+2 equals what": "template-smart",
  "Good morning beautiful": "template-fastpath",
  ok: "template-smart",
  "good night": "template-fastpath",
  wyd: "template-fastpath",
  "i am bored": "template-fastpath",
};

async function main() {
  const sid = `parity-${Date.now()}`;
  let fail = 0;
  let i = 0;
  for (const msg of CASES) {
    i++;
    const r = await priyaChat({ sessionId: sid, message: msg, userName: "Rayan", turnCount: i });
    const want = EXPECT_SRC[msg];
    const ok = r.source === want;
    if (!ok) fail++;
    console.log(`${ok ? "OK  " : "FAIL"} [${r.source}] "${msg}" → ${r.reply.slice(0, 70)}`);
  }
  console.log(fail === 0 ? "TEMPLATE PARITY OK" : `${fail} FAILURES`);
  process.exit(fail ? 1 : 0);
}
main();
