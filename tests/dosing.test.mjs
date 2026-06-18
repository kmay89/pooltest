/*
 * Pool Water Console — dosing-math regression suite.
 *
 * WHY THIS EXISTS
 * ---------------
 * The app turns a water test into an exact amount of chemical to pour into a
 * pool. If a constant in the dosing math drifts — a typo, a bad refactor, a
 * "harmless" tidy-up — the number a real person reads off the screen and adds
 * to their water changes, and an over-dose is hard to undo. These tests are the
 * certification: they pull the ACTUAL shipping engine out of index.html and
 * assert known, hand-checked doses. If any real-world amount would change, the
 * suite fails before the change can ship.
 *
 * HOW IT WORKS
 * ------------
 * index.html is a single self-contained file. The dosing math lives in one
 * clearly delimited, DOM-free block marked DOSE-ENGINE-START / DOSE-ENGINE-END.
 * We read the file, slice out that exact block, evaluate it in isolation, and
 * test the same code the browser runs — no copy, no drift.
 *
 * Run:  node --test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "..", "index.html"), "utf8");

// --- Extract the certified engine straight from the shipping file -----------
const START = "/* ===== DOSE-ENGINE-START";
const END = "/* ===== DOSE-ENGINE-END";
const a = html.indexOf(START);
const b = html.indexOf(END);
assert.ok(a !== -1 && b !== -1 && b > a,
  "Could not find the DOSE-ENGINE markers in index.html. If you renamed them, update this test.");
const block = html.slice(a, b);
// The block is `... var DOSE=(function(){...})(); ...`; eval it and hand DOSE back.
const DOSE = new Function(block + "\nreturn DOSE;")();

// A close-enough comparison for floating-point oz; doses are shown to 0.1 oz.
const near = (got, want, eps = 1e-9) =>
  assert.ok(Math.abs(got - want) <= eps, `expected ~${want}, got ${got}`);

// ---------------------------------------------------------------------------
test("chlorine product table: locked strengths, costs and flags", () => {
  const CL = DOSE.CL;
  assert.equal(CL.liq125.per, 10.5);
  assert.equal(CL.liq10.per, 13);
  assert.equal(CL.bleach825.per, 16);
  assert.equal(CL.bleach6.per, 21);
  assert.equal(CL.calhypo.per, 2.0);
  assert.equal(CL.dichlor.per, 2.4);
  // Side-effect flags that change the dose plan's wording must stay put.
  assert.equal(CL.calhypo.addsCH, true);
  assert.equal(CL.dichlor.addsCYA, true);
  assert.ok(!CL.liq125.addsCYA && !CL.liq125.addsCH);
});

test("balance targets: fresh-water vs salt-cell bands", () => {
  const fresh = DOSE.targets(false);
  assert.deepEqual(fresh.ph, { min: 7.4, ideal: 7.6, max: 7.8 });
  assert.deepEqual(fresh.ta, { min: 70, ideal: 80, max: 90 });
  assert.deepEqual(fresh.ch, { min: 150, ideal: 200, max: 250 });
  assert.deepEqual(fresh.cya, { min: 30, ideal: 40, max: 50 });
  // A salt cell shifts only the CYA band up; everything else holds.
  const salt = DOSE.targets(true);
  assert.deepEqual(salt.cya, { min: 60, ideal: 70, max: 80 });
  assert.deepEqual(salt.ph, fresh.ph);
  assert.deepEqual(salt.ta, fresh.ta);
});

test("FC band scales with CYA (the one rule that matters most)", () => {
  // Fresh water at CYA 40: target 7.5%, floor 5%, shock 40%.
  const f = DOSE.fcBand(40, false);
  near(f.min, 2);     // max(2, 40*0.05) = 2
  near(f.ideal, 3);   // 40*0.075
  near(f.max, 4);     // 40*0.10
  assert.equal(f.shock, 16); // round(40*0.4)
  // Salt cell runs a touch leaner with a hard floor of 3.
  const s = DOSE.fcBand(70, true);
  near(s.min, 3.5);   // 70*0.05
  near(s.ideal, 4.2); // 70*0.06
  near(s.max, 5.6);   // 70*0.08
  assert.equal(s.shock, 28);
  // Salt floor never drops below 3 even at low CYA.
  assert.equal(DOSE.fcBand(40, true).min, 3); // max(3, 40*0.05=2)
});

test("FC band with no stabilizer falls back to a fixed low band", () => {
  for (const cya of [null, 0]) {
    const b = DOSE.fcBand(cya, false);
    assert.deepEqual(
      { min: b.min, ideal: b.ideal, max: b.max, shock: b.shock, nocya: b.nocya },
      { min: 1, ideal: 2, max: 3, shock: 10, nocya: true }
    );
  }
});

test("alkalinity dose: baking soda, 24 oz per +10 ppm / 10k gal", () => {
  near(DOSE.bakingSodaOz(60, 80, 10000), 48);  // (20/10)*24
  near(DOSE.bakingSodaOz(75, 80, 10000), 12);  // (5/10)*24
  near(DOSE.bakingSodaOz(80, 80, 10000), 0);   // already on target
});

test("pH down: muriatic acid, 8 fl oz per -0.2 pH / 10k gal", () => {
  near(DOSE.acidOz(8.0, 7.6, 10000), 16); // (0.4/0.2)*8
  near(DOSE.acidOz(7.8, 7.6, 10000), 8);
});

test("pH up: soda ash, 6 oz per +0.2 pH / 10k gal", () => {
  near(DOSE.sodaAshOz(7.2, 7.6, 10000), 12); // (0.4/0.2)*6
  near(DOSE.sodaAshOz(7.4, 7.6, 10000), 6);
});

test("calcium: calcium chloride, ~1.84 oz per +1 ppm / 10k gal", () => {
  near(DOSE.calciumOz(150, 200, 10000), 92); // 1.84*50
});

test("stabilizer: cyanuric acid, 13 oz per +10 ppm / 10k gal", () => {
  near(DOSE.cyaOz(20, 40, 10000), 26); // (20/10)*13
  near(DOSE.cyaOz(0, 40, 10000), 52);
});

test("chlorine dose uses the right product strength", () => {
  near(DOSE.chlorineOz(2, "liq125", 10000), 21);   // +2 ppm * 10.5
  near(DOSE.chlorineOz(2, "calhypo", 10000), 4);    // granular, 2 oz/ppm
  near(DOSE.chlorineOz(3, "bleach6", 10000), 63);   // weak bleach needs more
});

test("acid also nudges TA down — that side note must stay honest", () => {
  // An 8 fl oz acid dose drops TA ~5 ppm in 10k gal.
  near(DOSE.taDrop(8, 10000), 5);
  near(DOSE.taDrop(16, 10000), 10);
});

test("every dose scales linearly with pool volume", () => {
  // Double the water, double the chemical. Half the water, half.
  near(DOSE.bakingSodaOz(60, 80, 20000), 96);
  near(DOSE.cyaOz(20, 40, 5000), 13);
  near(DOSE.chlorineOz(2, "liq125", 20000), 42);
  near(DOSE.acidOz(8.0, 7.6, 5000), 8);
});

test("a perfectly balanced pool asks for nothing", () => {
  near(DOSE.bakingSodaOz(80, 80, 10000), 0);
  near(DOSE.sodaAshOz(7.6, 7.6, 10000), 0);
  near(DOSE.acidOz(7.6, 7.6, 10000), 0);
  near(DOSE.calciumOz(200, 200, 10000), 0);
  near(DOSE.cyaOz(40, 40, 10000), 0);
  near(DOSE.chlorineOz(0, "liq125", 10000), 0);
});
