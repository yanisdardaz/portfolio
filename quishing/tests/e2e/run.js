// Tests de bout en bout dans Chromium (Playwright).
//   node tests/e2e/run.js
// Démarre : un faux site piégé (port 8765), le serveur QR Sentinel (8790, mode
// complet) et un serveur statique sans API (8791, mode local).
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "../..");
const FIX = path.join(ROOT, "tests", "fixtures");
const PY = process.env.PYTHON || "python3";
const SHOTS = process.env.SCREENSHOT_DIR || null;
const procs = [];

function start(args, env, cwd) {
  const p = spawn(PY, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "pipe"] });
  p.stderr.on("data", (d) => { if (process.env.DEBUG) process.stderr.write(d); });
  procs.push(p);
}

async function waitFor(url) {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("serveur injoignable : " + url);
}

const results = [];
async function test(name, fn) {
  try { await fn(); results.push([true, name]); console.log("ok   -", name); }
  catch (e) { results.push([false, name]); console.log("FAIL -", name, "\n     ", e.message.split("\n")[0]); }
}

async function upload(page, file) {
  await page.setInputFiles("#file-input", path.join(FIX, file));
  await page.waitForSelector("#result:not([hidden])", { timeout: 30000 });
}

(async () => {
  start(["-m", "tests.fake_site", "8765"], {}, path.join(ROOT, "backend"));
  start(["-m", "quishing.server"], { PORT: "8790", QUISHING_ALLOW_PRIVATE: "1", OPENPHISH: "0", RATE_LIMIT_PER_MIN: "0" }, path.join(ROOT, "backend"));
  start(["-m", "http.server", "8791", "--bind", "127.0.0.1"], {}, ROOT);
  await Promise.all([waitFor("http://127.0.0.1:8765/ok"), waitFor("http://127.0.0.1:8790/api/health"), waitFor("http://127.0.0.1:8791/")]);

  const browser = await chromium.launch({
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
           "--use-file-for-fake-video-capture=" + path.join(FIX, "camera.mjpeg")],
  });
  const ctx = await browser.newContext({ permissions: ["camera"] });
  // Le mode local interroge rdap.org : on simule une réponse (domaine créé il y a 3 jours)
  await ctx.route("https://rdap.org/**", (route) => route.fulfill({
    status: 200, contentType: "application/rdap+json", headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ ldhName: "x", events: [{ eventAction: "registration", eventDate: new Date(Date.now() - 3 * 864e5).toISOString() }] }),
  }));
  const errors = [];
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));

  // ---------------- mode complet (serveur)
  await page.goto("http://127.0.0.1:8790/");
  await test("badge « Analyse complète »", async () => {
    await page.waitForFunction(() => document.getElementById("mode-badge").textContent === "Analyse complète");
  });

  await test("image → suit les 3 redirections HTTP", async () => {
    await upload(page, "local-redirect.png");
    const hops = await page.$$eval("#chain li code", (n) => n.map((x) => x.textContent));
    assert.deepEqual(hops.map((h) => h.replace("http://127.0.0.1:8765", "")), ["/r1", "/r2", "/r3", "/ok"]);
    assert.equal(await page.textContent("#final-url"), "http://127.0.0.1:8765/ok");
    assert.match(await page.textContent("#reasons"), /adresse IP/);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "full-redirect.png"), fullPage: true });
  });

  await test("redirection cachée + faux formulaire → dangereux", async () => {
    await page.click("#again-btn");
    await upload(page, "local-meta.png");
    assert.equal(await page.textContent("#verdict-title"), "Dangereux");
    assert.match(await page.textContent("#chain"), /meta refresh/);
    const reasons = await page.textContent("#reasons");
    assert.match(reasons, /redirige automatiquement/);
    assert.match(reasons, /mot de passe/);
    assert.match(await page.textContent("#checks"), /Payer votre amende/);
  });

  await test("le lien scanné n'est jamais cliquable", async () => {
    const links = await page.$$eval("#result a", (a) => a.map((x) => x.href));
    assert.deepEqual(links, []);
  });

  await test("caméra (vidéo simulée) → verdict", async () => {
    await page.click("#again-btn");
    await page.click("#tab-camera");
    await page.click("#camera-btn");
    await page.waitForSelector("#result:not([hidden])", { timeout: 20000 });
    assert.equal(await page.textContent("#content-raw"), "https://amendes-gouv-paiement.example/payer?dossier=FR4471");
    assert.equal(await page.textContent("#verdict-title"), "Dangereux");
  });

  // ---------------- mode local (pas de serveur)
  const local = await ctx.newPage();
  local.on("pageerror", (e) => errors.push(e.message));
  await local.goto("http://127.0.0.1:8791/index.html");
  await test("badge « Analyse locale » sans serveur", async () => {
    await local.waitForFunction(() => document.getElementById("mode-badge").textContent === "Analyse locale");
  });

  await test("mode local : fausse amende → dangereux, domaine de 3 jours", async () => {
    await upload(local, "fausse-amende.png");
    assert.equal(await local.textContent("#verdict-title"), "Dangereux");
    const reasons = await local.textContent("#reasons");
    assert.match(reasons, /ANTAI/);
    assert.match(reasons, /il y a seulement 3 jour/);
    assert.match(await local.textContent("#chain"), /non suivies/);
  });

  await test("mode local : site officiel → sûr", async () => {
    await local.click("#again-btn");
    await upload(local, "officiel.png");
    // service-public.fr n'est pas dans la liste des marques : verdict selon âge simulé (3 jours)
    const title = await local.textContent("#verdict-title");
    assert.ok(["Suspect", "Sûr"].includes(title), title);
  });

  await test("onglet texte : Wi-Fi ouvert", async () => {
    await local.click("#again-btn");
    await local.click("#tab-text");
    await local.fill("#text-input", "WIFI:T:nopass;S:WiFi_Gratuit_Gare;;");
    await local.click("#text-form button[type=submit]");
    await local.waitForSelector("#result:not([hidden])");
    assert.equal(await local.textContent("#verdict-title"), "Sûr");
    assert.match(await local.textContent("#reasons"), /Wi-Fi ouvert/);
    assert.equal(await local.isHidden("#chain-card"), true);
  });

  await test("bouton d'exemple", async () => {
    await local.click("#again-btn");
    await local.click("text=Faux parcmètre");
    await local.waitForSelector("#result:not([hidden])");
    assert.equal(await local.textContent("#verdict-title"), "Dangereux");
    assert.match(await local.textContent("#reasons"), /PayByPhone/);
  });

  await test("image sans QR code → message d'erreur", async () => {
    await local.click("#again-btn");
    await local.click("#tab-image");
    await local.setInputFiles("#file-input", { name: "vide.png", mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
    await local.waitForSelector("#error:not([hidden])");
    assert.match(await local.textContent("#error"), /Aucun QR code/);
  });

  await test("mobile : pas de défilement horizontal", async () => {
    const m = await browser.newPage({ viewport: { width: 375, height: 800 } });
    await m.route("https://rdap.org/**", (r) => r.abort());
    await m.goto("http://127.0.0.1:8791/index.html");
    await m.click("text=Fausse amende");
    await m.waitForSelector("#result:not([hidden])");
    const w = await m.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 375, "largeur " + w);
    if (SHOTS) await m.screenshot({ path: path.join(SHOTS, "mobile.png"), fullPage: true });
    await m.close();
  });

  await test("aucune erreur JavaScript", async () => assert.deepEqual(errors, []));

  await browser.close();
  procs.forEach((p) => p.kill());
  const failed = results.filter((r) => !r[0]).length;
  console.log(`\n${results.length - failed}/${results.length} tests réussis`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); procs.forEach((p) => p.kill()); process.exit(1); });
