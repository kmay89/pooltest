/*
 * Pool Water Console — UI/display VERIFICATION suite.
 *
 * The engine suites prove the math. This suite proves what the USER SEES —
 * the dose list, badges, targets card, SLAM plan, what-if previews — matches
 * that math exactly. A correct engine behind a wrong label still mis-doses a
 * pool, so the display layer gets the same treatment:
 *
 *   - An independent re-implementation of the display CONTRACT (which step
 *     kind appears for which reading, per the band + test-tolerance rules;
 *     which badge word; which amounts) lives in this file, written from the
 *     documented rules — then hundreds of seeded scenarios drive the real DOM
 *     in Chromium and every rendered step, amount, and badge is checked
 *     against the contract and the engine.
 *   - Rendered amounts are parsed back out of their human formatting
 *     ("1.22 cups (9.8 fl oz)", "41 lb (2 × 40-lb bags)") and must equal the
 *     engine's ounces — which verifies the fmtFluid/fmtDry conversions and
 *     the wiring in one shot.
 *   - Safety-critical text is asserted present exactly when it should be:
 *     below-floor chlorine always doses, low salt is never softened, SLAM and
 *     the mustard playbook show the SAME shock number as the engine band,
 *     over-shock what-if previews warn, dilution percentages match drainPct.
 *
 * Requires Playwright + Chromium; skips (loudly) when unavailable so the
 * pure-math suites still run anywhere.
 *
 * Run:  node --test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, "..", "index.html");
const html = readFileSync(htmlPath, "utf8");
const A = html.indexOf("/* ===== DOSE-ENGINE-START");
const B = html.indexOf("/* ===== DOSE-ENGINE-END");
assert.ok(A !== -1 && B !== -1 && B > A, "engine markers missing");
const DOSE = new Function(html.slice(A, B) + "\nreturn DOSE;")();

// ---- optional Playwright ----------------------------------------------------
let chromium = null;
for (const spec of ["playwright", "/opt/node22/lib/node_modules/playwright/index.mjs"]) {
  try { ({ chromium } = await import(spec)); break; } catch { /* try next */ }
}
const executablePath = process.env.PLAYWRIGHT_BROWSERS_PATH
  ? join(process.env.PLAYWRIGHT_BROWSERS_PATH, "chromium") : undefined;

const SKIP = !chromium;
const maybe = (name, fn) => SKIP
  ? test(name, { skip: "playwright/chromium not available — UI suite needs a browser" }, () => {})
  : test(name, fn);

// one shared page for the whole file
let browser, page;
const consoleErrors = [];
if (!SKIP) {
  browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  page = await browser.newPage({ viewport: { width: 900, height: 1400 } });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" && !/net::|Failed to load resource/.test(t)) consoleErrors.push("console: " + t);
    if (/self-check/i.test(t)) consoleErrors.push("SELF-CHECK: " + t);
  });
  await page.goto(pathToFileURL(htmlPath).href);
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("poolWelcomed", "1");
    document.getElementById("welcomeSheet").hidden = true;
    document.getElementById("setup").open = true;
  });
  process.on("exit", () => { try { browser.close(); } catch {} });
}

// ---- shared helpers ---------------------------------------------------------
const r1 = (n) => Math.round(n * 10) / 10;
const lcg = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 2 ** 32); };

// Drive one full scenario in-page and return the rendered state.
async function runScenario(cfg) {
  return page.evaluate((cfg) => {
    const $ = (id) => document.getElementById(id);
    const set = (id, v) => { const el = $(id); if (!el) return; el.value = v == null ? "" : String(v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    document.querySelector(`#methodSeg [data-method="${cfg.method}"]`).click();
    document.querySelector(`#strategySeg [data-strategy="${cfg.strategy}"]`).click();
    set("vol", cfg.vol);
    $("surface").value = cfg.surface; $("surface").dispatchEvent(new Event("change", { bubbles: true }));
    $("product").value = cfg.product; $("product").dispatchEvent(new Event("change", { bubbles: true }));
    for (const k of ["fc", "tc", "ph", "ta", "cya", "ch", "salt"]) set(k, cfg.readings[k]);
    // balance workflow
    document.querySelector('#modePick [data-mode="balance"]').click();
    $("calc").click();
    const steps = [...document.querySelectorAll("#results .step")].map((st) => ({
      key: st.id.replace("step-", ""),
      cls: [...st.classList].find((c) => c.indexOf("s-") === 0),
      isAction: st.getAttribute("data-action") === "1",
      amt: st.querySelector(".amt") ? st.querySelector(".amt").textContent : null,
      what: st.querySelector(".what") ? st.querySelector(".what").textContent : null,
      compact: st.querySelector(".compact") ? st.querySelector(".compact").textContent : null,
      why: st.querySelector(".why") ? st.querySelector(".why").textContent : null,
    }));
    const badges = {};
    for (const k of ["fc", "ph", "ta", "cya", "ch", "salt"]) {
      const b = $("pb_" + k);
      const row = $("pw_" + k);
      badges[k] = { word: b ? b.textContent : null, hidden: !!(row && row.style.display === "none") };
    }
    return { steps, badges, targets: $("targetsGrid").innerText };
  }, cfg);
}

// Parse a rendered amount back to ounces (prefers the canonical parenthetical).
function parseOz(txt) {
  if (!txt) return null;
  let m = txt.match(/\(([\d.,]+)\s*fl oz\)/); if (m) return parseFloat(m[1].replace(/,/g, ""));
  m = txt.match(/\(([\d.,]+)\s*oz\)/); if (m) return parseFloat(m[1].replace(/,/g, ""));
  m = txt.match(/^([\d.,]+)\s*fl oz/); if (m) return parseFloat(m[1].replace(/,/g, ""));
  m = txt.match(/^([\d.,]+)\s*oz\b/); if (m) return parseFloat(m[1].replace(/,/g, ""));
  m = txt.match(/^([\d.,]+)\s*lb\b/); if (m) return parseFloat(m[1].replace(/,/g, "")) * 16;
  return null;
}

/* ---------- the independent display contract (the SPEC) --------------------
 * Re-written here from the documented rules, NOT copied from run():
 * kinds: good | close | action | info | wait. Amounts in product oz where a
 * number must render. */
function expectedPlan(cfg) {
  const R = cfg.readings, vol = cfg.vol, salt = cfg.method === "salt";
  const T = DOSE.targets(salt, cfg.surface);
  const TOL = DOSE.TOL;
  const out = [];
  const band = (v, lo, hi, tol) => v < lo - tol ? "low" : v > hi + tol ? "high" : (v < lo || v > hi) ? "close" : "good";
  if (R.ta != null) {
    const w = band(R.ta, T.ta.min, T.ta.max, TOL.ta);
    if (w === "low") out.push({ key: "ta", kind: "action", oz: DOSE.bakingSodaOz(R.ta, T.ta.ideal, vol), alert: R.ta < T.ta.min * 0.8 });
    else if (w === "high") out.push({ key: "ta", kind: "action", oz: null, alert: R.ta > T.ta.max * 1.4 });
    else out.push({ key: "ta", kind: w });
  }
  if (R.ph != null) {
    const w = band(R.ph, T.ph.min, T.ph.max, TOL.ph);
    if (w === "high") out.push({ key: "ph", kind: "action", oz: DOSE.acidOz(R.ph, T.ph.ideal, vol, R.ta ?? null), alert: R.ph > 8.0 });
    else if (w === "low") out.push({ key: "ph", kind: "action", oz: DOSE.sodaAshOz(R.ph, T.ph.ideal, vol), alert: R.ph < 7.0 });
    else out.push({ key: "ph", kind: w });
  }
  if (R.ch != null) {
    const w = band(R.ch, T.ch.min, T.ch.max, TOL.ch);
    if (w === "low") out.push({ key: "ch", kind: "action", oz: DOSE.calciumOz(R.ch, T.ch.ideal, vol), alert: !(T.ch.optional || R.ch >= T.ch.min * 0.8) });
    else if (w === "high") out.push({ key: "ch", kind: "action", oz: null, swapPct: Math.round(DOSE.drainPct(R.ch, T.ch.ideal) * 100), alert: R.ch > T.ch.max * 1.4 });
    else out.push({ key: "ch", kind: w });
  }
  if (R.cya != null) {
    const w = band(R.cya, T.cya.min, T.cya.max, TOL.cya);
    if (w === "low") out.push({ key: "cya", kind: "action", oz: DOSE.cyaOz(R.cya, T.cya.ideal, vol), alert: R.cya < 20 });
    else if (w === "high") out.push({ key: "cya", kind: "action", oz: null, swapPct: Math.round(DOSE.drainPct(R.cya, T.cya.ideal) * 100), alert: R.cya > (salt ? 110 : 80) });
    else out.push({ key: "cya", kind: w });
  }
  if (R.fc != null) {
    const b = DOSE.fcBand(R.cya ?? null, salt, cfg.strategy);
    if (R.fc < b.min) out.push({ key: "fc", kind: "action", oz: DOSE.chlorineOz(b.ideal - R.fc, cfg.product, vol), alert: R.fc < b.min * 0.6 });
    else if (R.fc < b.ideal - TOL.fc) out.push({ key: "fc", kind: "info", oz: DOSE.chlorineOz(b.ideal - R.fc, cfg.product, vol) });
    else if (R.fc > b.max + TOL.fc) out.push({ key: "fc", kind: "wait" });
    else out.push({ key: "fc", kind: "good" });
  }
  if (salt && R.salt != null) {
    const SB = DOSE.SALT;
    if (R.salt < SB.min) out.push({ key: "salt", kind: "action", oz: DOSE.saltLb(R.salt, SB.ideal, vol) * 16, alert: R.salt < SB.min * 0.8 });
    else if (R.salt > SB.max + TOL.salt) out.push({ key: "salt", kind: "action", oz: null, swapPct: Math.round(DOSE.drainPct(R.salt, SB.ideal) * 100), alert: R.salt > SB.max * 1.25 });
    else if (R.salt > SB.max) out.push({ key: "salt", kind: "close" });
    else out.push({ key: "salt", kind: "good" });
  }
  return out;
}

function expectedBadge(k, v, cfg) {
  if (v == null) return "Not measured";
  const salt = cfg.method === "salt";
  if (k === "fc") {
    // Badge must use the measured CYA — or the honest no-CYA band when unset —
    // exactly like the dose list. A silently-assumed CYA is a contradiction.
    const b = DOSE.fcBand(cfg.readings.cya ?? null, salt, cfg.strategy);
    if (v < b.min) return v < b.min * 0.6 ? "Very low" : "Low";
    if (v > b.max) return v <= b.max + DOSE.TOL.fc ? "Close enough" : (v > b.max * 1.5 ? "Very high" : "High");
    return "In range";
  }
  const T = DOSE.targets(salt, cfg.surface);
  const bands = { ph: [7.4, 7.8], ta: [70, 90], cya: [T.cya.min, T.cya.max], ch: [T.ch.min, T.ch.max], salt: [DOSE.SALT.min, DOSE.SALT.max] };
  const [lo, hi] = bands[k];
  const tl = DOSE.TOL[k], tlLow = k === "salt" ? 0 : tl;
  if (v < lo) {
    if (tlLow && v >= lo - tlLow) return "Close enough";
    return v < lo * 0.8 ? "Very low" : "Low";
  }
  if (v > hi) {
    if (v <= hi + tl) return "Close enough";
    return v > hi * 1.25 ? "Very high" : "High";
  }
  return "In range";
}

// Seeded scenario generator, biased hard toward band edges (where bugs live).
function genScenario(rnd) {
  const surfaces = ["vinyl", "fiberglass", "plaster"];
  const strategies = ["steady", "crystal", "thrifty", "easy"];
  const methods = ["manual", "pucks", "salt"];
  const products = ["liq125", "liq10", "bleach825", "bleach6", "calhypo", "dichlor"];
  const cfg = {
    vol: [3000, 8000, 10000, 15000, 24000][Math.floor(rnd() * 5)],
    surface: surfaces[Math.floor(rnd() * 3)],
    strategy: strategies[Math.floor(rnd() * 4)],
    method: methods[Math.floor(rnd() * 3)],
    product: products[Math.floor(rnd() * 6)],
    readings: {},
  };
  const salt = cfg.method === "salt";
  const T = DOSE.targets(salt, cfg.surface);
  const place = (lo, hi, tol, step) => {
    const r = rnd();
    let v;
    if (r < 0.10) return null;                                  // not measured
    if (r < 0.30) v = lo + rnd() * (hi - lo);                   // in band
    else if (r < 0.45) v = lo - rnd() * tol * 0.95;             // low, within tolerance
    else if (r < 0.60) v = lo - tol - (0.1 + rnd()) * tol * 3;  // clearly low
    else if (r < 0.75) v = hi + rnd() * tol * 0.95;             // high, within tolerance
    else if (r < 0.90) v = hi + tol + (0.1 + rnd()) * tol * 3;  // clearly high
    else v = Math.max(0, lo - tol * 8 * rnd());                 // very low
    return Math.max(0, Math.round(v / step) * step);
  };
  cfg.readings.ta = place(T.ta.min, T.ta.max, DOSE.TOL.ta, 1);
  cfg.readings.ph = (() => { const v = place(7.4, 7.8, DOSE.TOL.ph, 0.01); return v == null ? null : Math.min(9.9, Math.max(6.0, v)); })();
  cfg.readings.ch = place(T.ch.min, T.ch.max, DOSE.TOL.ch, 5);
  cfg.readings.cya = place(T.cya.min, T.cya.max, DOSE.TOL.cya, 1);
  const b = DOSE.fcBand(cfg.readings.cya ?? null, salt, cfg.strategy);
  cfg.readings.fc = place(b.min, b.max, DOSE.TOL.fc, 0.1);
  cfg.readings.salt = salt ? place(DOSE.SALT.min, DOSE.SALT.max, DOSE.TOL.salt, 10) : null;
  cfg.readings.tc = null;
  return cfg;
}

const KIND_TO_CLS = { action: ["s-warn", "s-alert"], info: ["s-info"], wait: ["s-warn"], good: ["s-good"], close: ["s-good"] };

/* ================================ TESTS ==================================== */

maybe("UI contract: every rendered step, amount, and badge matches the spec (200 seeded scenarios)", async () => {
  const rnd = lcg(20260702);
  for (let i = 0; i < 200; i++) {
    const cfg = genScenario(rnd);
    const got = await runScenario(cfg);
    const want = expectedPlan(cfg);
    const tag = `#${i} ${JSON.stringify(cfg)}`;
    // Same steps, same order.
    assert.deepEqual(got.steps.map((s) => s.key), want.map((w) => w.key), `step set/order differs ${tag}`);
    for (let j = 0; j < want.length; j++) {
      const w = want[j], g = got.steps[j];
      // Kind ↔ class, and the alert/warn severity split.
      assert.ok(KIND_TO_CLS[w.kind].includes(g.cls), `kind ${w.kind} rendered as ${g.cls} for ${w.key} ${tag}`);
      if (w.kind === "action") assert.equal(g.cls, w.alert ? "s-alert" : "s-warn", `severity for ${w.key} ${tag}`);
      // Actionability flag drives the progress checklist — must match kind.
      assert.equal(g.isAction, w.kind === "action" || w.kind === "info" || w.kind === "wait", `data-action for ${w.key} ${tag}`);
      // Tolerance steps must say so; good steps must not demand anything.
      if (w.kind === "close") assert.ok(/within test tolerance/i.test(g.compact || ""), `close step lacks tolerance text ${w.key} ${tag}`);
      // Amounts: parse the human formatting back to oz and compare to engine.
      if (w.kind === "action" && w.oz != null) {
        const oz = parseOz(g.amt);
        assert.ok(oz != null, `no parsable amount for ${w.key}: "${g.amt}" ${tag}`);
        const tol = Math.max(0.06, w.oz * 0.02, w.key === "salt" ? 8 : 0);
        assert.ok(Math.abs(oz - w.oz) <= tol, `${w.key} amount ${oz} oz != engine ${w.oz.toFixed(2)} oz ${tag}`);
      }
      if (w.kind === "info" && w.oz != null) {
        const oz = parseOz(g.amt);
        assert.ok(oz != null && Math.abs(oz - w.oz) <= Math.max(0.06, w.oz * 0.02), `fc top-up amount ${tag}`);
      }
      // Dilution steps must show the exact drainPct percentage.
      if (w.swapPct != null) {
        const m = (g.amt || "").match(/Swap ~(\d+)%/);
        assert.ok(m, `no swap %% for ${w.key}: "${g.amt}" ${tag}`);
        assert.equal(Number(m[1]), w.swapPct, `swap %% for ${w.key} ${tag}`);
      }
      // SAFETY: below-floor FC and below-band salt must always be action steps.
      if (w.key === "fc" && cfg.readings.fc != null) {
        const bd = DOSE.fcBand(cfg.readings.cya ?? null, cfg.method === "salt", cfg.strategy);
        if (cfg.readings.fc < bd.min) assert.equal(w.kind, "action", `below-floor FC softened ${tag}`);
      }
      if (w.key === "salt" && cfg.readings.salt != null && cfg.readings.salt < DOSE.SALT.min) {
        assert.equal(w.kind, "action", `below-band salt softened ${tag}`);
      }
    }
    // Badges agree with the spec for every visible row.
    for (const k of ["fc", "ph", "ta", "cya", "ch", "salt"]) {
      if (k === "salt" && cfg.method !== "salt") { assert.ok(got.badges.salt.hidden, `salt row visible without a cell ${tag}`); continue; }
      const wantWord = expectedBadge(k, cfg.readings[k], cfg);
      assert.equal(got.badges[k].word, wantWord, `badge for ${k} ${tag}`);
      // A badge must never contradict the plan: "In range"/"Close enough" rows
      // can't have an alert/warn ACTION step (info top-ups are allowed), and
      // Low/High rows can't render as "good".
      const step = want.find((w) => w.key === k);
      if (step) {
        if ((wantWord === "In range" || wantWord === "Close enough") && step.kind === "action")
          assert.fail(`badge says ${wantWord} but plan demands action for ${k} ${tag}`);
        if (/Low|High/.test(wantWord) && (step.kind === "good" || step.kind === "close"))
          assert.fail(`badge says ${wantWord} but plan shows ${step.kind} for ${k} ${tag}`);
      }
    }
  }
  assert.deepEqual(consoleErrors, [], "console must stay clean through the sweep");
});

maybe("UI contract: deterministic band-edge matrix (exact boundaries, every parameter)", async () => {
  // Exactly AT the edge, one test-step inside tolerance, one past it — the
  // three readings a strip user actually argues about.
  const T = DOSE.targets(false, "vinyl");
  const cases = [];
  const push = (readings) => cases.push({ vol: 10000, surface: "vinyl", strategy: "steady", method: "manual", product: "liq125", readings: { fc: null, ph: null, ta: null, cya: null, ch: null, salt: null, tc: null, ...readings } });
  for (const [lo, hi, tol, k] of [[T.ta.min, T.ta.max, DOSE.TOL.ta, "ta"], [T.cya.min, T.cya.max, DOSE.TOL.cya, "cya"], [T.ch.min, T.ch.max, DOSE.TOL.ch, "ch"]]) {
    for (const v of [lo, lo - tol, lo - tol - 1, hi, hi + tol, hi + tol + 1]) push({ [k]: v });
  }
  for (const v of [7.4, 7.3, 7.29, 7.8, 7.9, 7.91]) push({ ph: v });
  const b = DOSE.fcBand(40, false, "steady"); // min 2 ideal 3 max 4
  for (const v of [b.min, b.min - 0.1, b.ideal - 0.5, b.ideal - 0.6, b.max + 0.5, b.max + 0.6]) push({ cya: 40, fc: r1(v) });
  for (const c of cases) {
    const got = await runScenario(c);
    const want = expectedPlan(c);
    assert.deepEqual(got.steps.map((s) => s.key), want.map((w) => w.key), JSON.stringify(c));
    for (let j = 0; j < want.length; j++) {
      assert.ok(KIND_TO_CLS[want[j].kind].includes(got.steps[j].cls),
        `at edge ${JSON.stringify(c.readings)}: ${want[j].key} expected ${want[j].kind}, saw ${got.steps[j].cls}`);
    }
  }
});

maybe("targets card shows the engine's numbers for every surface × method × strategy", async () => {
  for (const surface of ["vinyl", "fiberglass", "plaster"]) {
    for (const method of ["manual", "salt"]) {
      for (const strategy of ["steady", "crystal", "easy"]) {
        const got = await runScenario({ vol: 10000, surface, strategy, method, product: "liq125", readings: {} });
        const T = DOSE.targets(method === "salt", surface);
        const st = DOSE.STRATEGIES[strategy];
        const pct = Math.round((method === "salt" ? st.fcMulSalt : st.fcMul) * 1000) / 10;
        const tag = `${surface}/${method}/${strategy}`;
        assert.ok(got.targets.includes(`${pct}% of CYA`), `FC %% for ${tag}: ${got.targets}`);
        assert.ok(got.targets.includes(`${T.ta.min} – ${T.ta.max} ppm`), `TA band ${tag}`);
        assert.ok(got.targets.includes(`${T.cya.min} – ${T.cya.max} ppm`), `CYA band ${tag}`);
        assert.ok(got.targets.includes(`${T.ch.min} – ${T.ch.max}${T.ch.optional ? " (optional)" : " ppm"}`), `CH band ${tag}`);
        if (method === "salt") assert.ok(got.targets.includes(`${DOSE.SALT.min} – ${DOSE.SALT.max}`), `salt band ${tag}`);
        else assert.ok(!/2700/.test(got.targets), `salt band shown without a cell ${tag}`);
      }
    }
  }
});

maybe("SLAM plan, mustard playbook, and the engine band all show the same shock number", async () => {
  for (const cya of [15, 30, 40, 55, 70, 90]) { // 15 exercises the 10-ppm floor
    const shock = DOSE.fcBand(cya, false).shock;
    const seen = await page.evaluate((cya) => {
      const $ = (id) => document.getElementById(id);
      document.querySelector('#methodSeg [data-method="manual"]').click();
      for (const k of ["fc", "tc", "ph", "ta", "ch", "salt"]) { const el = $(k); if (el) { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); } }
      $("cya").value = String(cya); $("cya").dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector('#modePick [data-mode="slam"]').click();
      $("calc").click();
      const slamTxt = document.getElementById("results").innerText;
      document.querySelector('.tabbar [data-tab="fixit"]').click();
      const mustard = document.getElementById("mustardDose").innerText;
      document.querySelector('.tabbar [data-tab="dose"]').click();
      return { slamTxt, mustard };
    }, cya);
    const m = seen.slamTxt.match(/reach (\d+) ppm|hold (\d+) ppm/);
    assert.ok(m, `no shock number in SLAM at CYA ${cya}`);
    assert.equal(Number(m[1] || m[2]), shock, `SLAM shows wrong shock at CYA ${cya}`);
    assert.ok(new RegExp(`\\b${shock} ppm\\b`).test(seen.mustard), `mustard playbook disagrees at CYA ${cya}: ${seen.mustard.slice(0, 120)}`);
    assert.ok(/swim/i.test(seen.slamTxt), `SLAM lacks the no-swim warning at CYA ${cya}`);
  }
});

maybe("what-if previews match effectOf, and over-shock previews warn", async () => {
  const grid = [
    { item: "liq125", amt: 128, unit: "1", fc: 2, cya: 40 },   // a gallon: lands ~14 — over shock? shock 16, no
    { item: "calhypo", amt: 5, unit: "16", fc: 3, cya: 40 },   // 5 lb cal-hypo: +40 ppm — way past shock 16
    { item: "dichlor", amt: 1, unit: "16", fc: null, cya: 40 },
    { item: "bakingsoda", amt: 3, unit: "16", fc: null, cya: null },
    { item: "acid", amt: 16, unit: "1", fc: null, cya: null },
  ];
  for (const g of grid) {
    const res = await page.evaluate((g) => {
      const $ = (id) => document.getElementById(id);
      for (const k of ["fc", "tc", "ph", "ta", "cya", "ch", "salt"]) { const el = $(k); if (el) { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); } }
      if (g.fc != null) { $("fc").value = g.fc; $("fc").dispatchEvent(new Event("input", { bubbles: true })); }
      if (g.cya != null) { $("cya").value = g.cya; $("cya").dispatchEvent(new Event("input", { bubbles: true })); }
      $("fxCard").open = true;
      $("fxItem").value = g.item; $("fxItem").dispatchEvent(new Event("change", { bubbles: true }));
      $("fxUnit").value = g.unit; $("fxUnit").dispatchEvent(new Event("change", { bubbles: true }));
      $("fxAmt").value = g.amt; $("fxAmt").dispatchEvent(new Event("input", { bubbles: true }));
      return document.getElementById("fxOut").innerText;
    }, g);
    const e = DOSE.effectOf(g.item, g.amt * Number(g.unit), 10000);
    for (const [k, v] of Object.entries(e)) {
      const expTxt = (k === "ph" ? Math.abs(v).toFixed(2) : r1(Math.abs(v)));
      assert.ok(res.includes(String(expTxt)), `what-if ${g.item}: missing ${k} delta ${expTxt} in "${res.slice(0, 140)}"`);
    }
    if (g.fc != null && e.fc) {
      const b = DOSE.fcBand(g.cya ?? null, false, "steady");
      const over = g.fc + e.fc > b.shock + 2;
      assert.equal(/beyond shock level/.test(res), over, `over-shock warning wrong for ${g.item} (lands ${g.fc + e.fc}, shock ${b.shock})`);
    }
  }
});

maybe("unit grammar: fluids render in fl oz/cups/qt/gal, dry in oz/lb — never crossed", async () => {
  const rnd = lcg(777);
  for (let i = 0; i < 40; i++) {
    const fluid = rnd() > 0.5;
    const product = fluid ? ["liq125", "liq10", "bleach6"][Math.floor(rnd() * 3)] : ["calhypo", "dichlor"][Math.floor(rnd() * 2)];
    const cya = 30 + Math.floor(rnd() * 50);
    const b = DOSE.fcBand(cya, false, "steady");
    const fc = Math.max(0, r1(b.min - 0.2 - rnd() * b.min));
    const cfg = { vol: [8000, 10000, 20000, 30000][Math.floor(rnd() * 4)], surface: "vinyl", strategy: "steady", method: "manual", product, readings: { fc, cya, ph: null, ta: null, ch: null, salt: null, tc: null } };
    const got = await runScenario(cfg);
    const fcStep = got.steps.find((s) => s.key === "fc");
    if (!fcStep || !fcStep.amt) continue;
    if (fluid) assert.ok(/fl oz|cup|qt|gal/.test(fcStep.amt) && !/\blb\b/.test(fcStep.amt), `fluid ${product} rendered dry: "${fcStep.amt}"`);
    else assert.ok(!/fl oz|gal|qt/.test(fcStep.amt), `dry ${product} rendered fluid: "${fcStep.amt}"`);
    // Unit thresholds: gal ⇒ ≥128 fl oz, qt ⇒ ≥32, cups ⇒ ≥8; lb ⇒ ≥16 oz.
    const oz = parseOz(fcStep.amt);
    if (/gal/.test(fcStep.amt)) assert.ok(oz >= 128);
    else if (/qt/.test(fcStep.amt)) assert.ok(oz >= 32 && oz < 128);
    else if (/cup/.test(fcStep.amt)) assert.ok(oz >= 8 && oz < 32);
    if (/\blb\b/.test(fcStep.amt)) assert.ok(oz >= 16);
  }
});

maybe("combined-chlorine line: the number, the verdict, and the 0.5 boundary", async () => {
  for (const [fc, tc, cc, ok] of [[3, 3.2, 0.2, true], [3, 3.5, 0.5, true], [3, 3.6, 0.6, false], [4, 4, 0, true]]) {
    const res = await page.evaluate(([fc, tc]) => {
      const $ = (id) => document.getElementById(id);
      for (const k of ["ph", "ta", "cya", "ch", "salt"]) { const el = $(k); if (el) { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); } }
      $("fc").value = fc; $("fc").dispatchEvent(new Event("input", { bubbles: true }));
      $("tc").value = tc; $("tc").dispatchEvent(new Event("input", { bubbles: true }));
      const el = document.getElementById("ccLine");
      return { text: el.innerText, cls: el.className };
    }, [fc, tc]);
    assert.ok(res.text.includes(`${cc} ppm`), `CC number at fc=${fc} tc=${tc}: "${res.text}"`);
    assert.equal(/\bok\b/.test(res.cls), ok, `CC verdict at cc=${cc}`);
    if (!ok) assert.ok(/[Ss]hock/.test(res.text), "elevated CC must recommend shocking");
  }
});

maybe("volume calculator display matches its stated formulas", async () => {
  for (const [shape, a2, b2, d, factor] of [["round", 21, 0, 3.5, 5.9], ["oval", 24, 12, 4, 5.9], ["rect", 32, 16, 5, 7.5]]) {
    const shown = await page.evaluate(([shape, a2, b2, d]) => {
      const $ = (id) => document.getElementById(id);
      $("volCalc").hidden = false;
      $("vcShape").value = shape; $("vcShape").dispatchEvent(new Event("change", { bubbles: true }));
      $("vcA").value = a2; $("vcA").dispatchEvent(new Event("input", { bubbles: true }));
      if (b2) { $("vcB").value = b2; $("vcB").dispatchEvent(new Event("input", { bubbles: true })); }
      $("vcDepth").value = d; $("vcDepth").dispatchEvent(new Event("input", { bubbles: true }));
      return document.getElementById("vcOut").textContent;
    }, [shape, a2, b2, d]);
    const raw = shape === "round" ? a2 * a2 * d * factor : a2 * b2 * d * factor;
    const expect = Math.round(raw / 50) * 50;
    assert.ok(shown.replace(/,/g, "").includes(String(expect)), `${shape}: shown "${shown}" expected ${expect}`);
  }
});

maybe("teardown: zero console errors across the entire UI sweep", async () => {
  assert.deepEqual(consoleErrors, []);
  await browser.close();
});
