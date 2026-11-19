// Tests du moteur JavaScript : node --test tests/js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const A = require("../../js/analyzer.js");
const rules = require("../../data/rules.json");
const cases = require("../cases.json");

for (const c of cases) {
  test(`cas partagé : ${c.name}`, () => {
    const r = A.analyze(c.payload, rules, c.ctx);
    const ids = r.reasons.map((x) => x.id);
    const e = c.expect;
    assert.equal(r.verdict, e.verdict, `verdict (${r.score} pts, raisons ${ids.join(", ")})`);
    if (e.score !== undefined) assert.equal(r.score, e.score);
    if (e.type) assert.equal(r.payload.type, e.type);
    for (const id of e.has || []) assert.ok(ids.includes(id), `devrait contenir ${id} : ${ids}`);
    for (const id of e.not || []) assert.ok(!ids.includes(id), `ne devrait pas contenir ${id}`);
    for (const reason of r.reasons) assert.ok(reason.message && !/\{\w+\}/.test(reason.message), "message complet");
  });
}

test("domaine enregistrable", () => {
  const d = (h) => A.registrableDomain(h, rules);
  assert.equal(d("www.example.com"), "example.com");
  assert.equal(d("a.b.example.co.uk"), "example.co.uk");
  assert.equal(d("www.impots.gouv.fr"), "impots.gouv.fr");
  assert.equal(d("evil.github.io"), "evil.github.io");
  assert.equal(d("x.y.evil.netlify.app"), "evil.netlify.app");
  assert.equal(d("localhost"), "localhost");
  assert.equal(d("10.0.0.1"), "10.0.0.1");
});

test("détection des adresses IP", () => {
  for (const h of ["1.2.3.4", "[::1]", "3232235777", "0xC0A80001"]) assert.ok(A.isIPHost(h), h);
  for (const h of ["example.com", "999.1.1.1", "1.2.3"]) assert.ok(!A.isIPHost(h), h);
});

test("mots-clés de marque", () => {
  assert.ok(A.keywordInHost("paypal", "paypalsecure.com"));
  assert.ok(A.keywordInHost("ups", "ups-livraison.fr"));
  assert.ok(!A.keywordInHost("ups", "groups.com"));
  assert.ok(A.keywordInHost("ameli", "amelisante.fr"));
  assert.ok(!A.keywordInHost("apple", "pineapple.com"));
});

test("Wi-Fi : échappements", () => {
  const p = A.parsePayload(String.raw`WIFI:S:Mon\;Reseau;T:WPA;P:a\:b;;`);
  assert.equal(p.data.ssid, "Mon;Reseau");
  assert.equal(p.data.open, false);
});

test("score borné entre 0 et 100", () => {
  const r = A.analyze("http://paypal-amazon-ameli-login-verify.xyz:8080/a/b/c/d?" + "x".repeat(200), rules);
  assert.ok(r.score <= 100 && r.score >= 0);
  const ok = A.analyze("https://www.impots.gouv.fr/", rules, { domainAgeDays: 9999, ageChecked: true });
  assert.equal(ok.score, 0);
});
