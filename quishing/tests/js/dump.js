// Utilisé par le test Python de parité : affiche les résultats JS en JSON.
const A = require("../../js/analyzer.js");
const rules = require("../../data/rules.json");
const cases = require("../cases.json");
const out = cases.map((c) => {
  const r = A.analyze(c.payload, rules, c.ctx);
  return { name: c.name, verdict: r.verdict, score: r.score, reasons: r.reasons.map((x) => [x.id, x.points, x.message]), type: r.payload.type, target: r.target };
});
process.stdout.write(JSON.stringify(out));
