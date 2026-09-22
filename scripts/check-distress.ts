import { getMoodEngine } from "../src/lib/priya/mood-engine";
import { mapPriyaToMira } from "../src/lib/priya/index";

const cases = [
  "ha just not in mood was crying early",
  "nothing just feeling sad",
  "i failed my exam, feeling terrible",
  "I am not sad, just tired",
  "never lonely, I love my life",
  "YOU ARE SO STUPID AND I AM CRYING",
  "Good morning beautiful",
];

for (const m of cases) {
  const eng = getMoodEngine(`distress-${m.slice(0, 8)}`);
  const upd = eng.update(m);
  const mapped = mapPriyaToMira(upd);
  console.log(
    `[${mapped.mood}/${mapped.confidence}] priya=${upd.label}/${upd.score} :: ${m} :: cues=${JSON.stringify(mapped.cues)}`,
  );
}
