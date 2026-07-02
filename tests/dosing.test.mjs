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
  assert.equal(CL.trichlor.per, 1.5);
  // Side-effect flags that change the dose plan's wording must stay put.
  assert.equal(CL.calhypo.addsCH, true);
  assert.equal(CL.dichlor.addsCYA, true);
  assert.equal(CL.trichlor.addsCYA, true);
  // Trichlor dissolves over days — it must stay flagged slow so the UI never
  // offers it for a "raise FC now" dose.
  assert.equal(CL.trichlor.slow, true);
  assert.ok(!CL.liq125.addsCYA && !CL.liq125.addsCH);
});

test("balance targets: fresh-water vs salt-cell bands", () => {
  const fresh = DOSE.targets(false);
  assert.deepEqual(fresh.ph, { min: 7.4, ideal: 7.6, max: 7.8 });
  assert.deepEqual(fresh.ta, { min: 70, ideal: 80, max: 90 });
  assert.deepEqual(fresh.ch, { min: 150, ideal: 200, max: 250, optional: true });
  assert.deepEqual(fresh.cya, { min: 30, ideal: 40, max: 50 });
  // A salt cell shifts only the CYA band up; everything else holds.
  const salt = DOSE.targets(true);
  assert.deepEqual(salt.cya, { min: 60, ideal: 70, max: 80 });
  assert.deepEqual(salt.ph, fresh.ph);
  assert.deepEqual(salt.ta, fresh.ta);
});

test("calcium band follows the pool surface", () => {
  // Vinyl (default) is low and optional — a liner has nothing to etch.
  const vinyl = DOSE.targets(false, "vinyl");
  assert.deepEqual(vinyl.ch, { min: 150, ideal: 200, max: 250, optional: true });
  // Plaster genuinely needs calcium: 250–450, not optional.
  const plaster = DOSE.targets(false, "plaster");
  assert.deepEqual(plaster.ch, { min: 250, ideal: 350, max: 450, optional: false });
  // Fiberglass sits between.
  const fg = DOSE.targets(false, "fiberglass");
  assert.deepEqual(fg.ch, { min: 220, ideal: 270, max: 320, optional: false });
  // Unknown / omitted surface falls back to vinyl, never throws.
  assert.deepEqual(DOSE.targets(false).ch, vinyl.ch);
  assert.deepEqual(DOSE.targets(false, "concrete??").ch, vinyl.ch);
  // Surface never moves the non-calcium bands.
  assert.deepEqual(plaster.ph, vinyl.ph);
  assert.deepEqual(plaster.ta, vinyl.ta);
  assert.deepEqual(plaster.cya, vinyl.cya);
});

test("care strategies move the FC target inside the band, never the safety lines", () => {
  const base = DOSE.fcBand(40, false);           // steady default: 7.5%
  const crystal = DOSE.fcBand(40, false, "crystal"); // 9%
  const thrifty = DOSE.fcBand(40, false, "thrifty"); // same as steady — savings come from habits, not lower FC
  const easy = DOSE.fcBand(40, false, "easy");   // 8.5% margin for less-frequent testing
  near(base.ideal, 3);
  near(crystal.ideal, 3.6);
  near(thrifty.ideal, 3);
  near(easy.ideal, 3.4);
  // Floor and shock are SAFETY lines — identical in every strategy.
  for (const b of [base, crystal, thrifty, easy]) {
    near(b.min, 2);
    near(b.max, 4);
    assert.equal(b.shock, 16);
  }
  // Salt variants.
  near(DOSE.fcBand(70, true, "crystal").ideal, 4.9); // 70*0.07
  near(DOSE.fcBand(70, true, "easy").ideal, 4.6);    // 70*0.065, rounded to 0.1
  // Unknown strategy falls back to steady.
  near(DOSE.fcBand(40, false, "yolo").ideal, 3);
  // No-CYA fallback band ignores strategy (it's already a fixed floor case).
  assert.equal(DOSE.fcBand(0, false, "crystal").ideal, 2);
});

test("CSI (calcite saturation index) matches hand-computed Langelier values", () => {
  const close = (got, want) => assert.ok(Math.abs(got - want) < 0.005, `expected ~${want}, got ${got}`);
  // Balanced summer water: pH 7.6, TA 80, CH 300, CYA 40, 84°F, TDS 1000.
  close(DOSE.csi(7.6, 80, 300, 40, 84, 1000), -0.0105);
  // Fresh-fill vinyl water in spring: corrosive.
  close(DOSE.csi(7.2, 70, 150, 40, 60, 1000), -1.0394);
  // Hot, high-everything water: scale-forming.
  close(DOSE.csi(8.0, 120, 450, 0, 88, 1000), 0.8626);
  // The Orenda winterization case: same-ish chemistry, 40°F water goes aggressive.
  close(DOSE.csi(7.5, 80, 350, 30, 40, 1000), -0.5033);
  // Defaults: temp omitted → 84°F, TDS omitted → 1000.
  close(DOSE.csi(7.6, 80, 300, 40, null, null), DOSE.csi(7.6, 80, 300, 40, 84, 1000));
});

test("dilution math: fraction of water to swap", () => {
  near(DOSE.drainPct(100, 50), 0.5);
  near(DOSE.drainPct(80, 40), 0.5);
  near(DOSE.drainPct(120, 40), 2 / 3);
  // Already at/below target, or junk input → no drain.
  near(DOSE.drainPct(40, 50), 0);
  near(DOSE.drainPct(0, 50), 0);
  near(DOSE.drainPct(NaN, 50), 0);
});

test("effects-of-adding inverts the dose math exactly", () => {
  // 21 fl oz of 12.5% liquid in 10k gal = the +2 ppm golden dose, inverted.
  near(DOSE.effectOf("liq125", 21, 10000).fc, 2);
  // Dichlor: +1 ppm FC brings 0.9 ppm CYA along.
  const d = DOSE.effectOf("dichlor", 2.4, 10000);
  near(d.fc, 1); near(d.cya, 0.9);
  // Trichlor: 0.61 ppm CYA per ppm FC (one 8-oz puck).
  const t = DOSE.effectOf("trichlor", 8, 10000);
  near(t.fc, 16 / 3); near(t.cya, (16 / 3) * 0.61);
  // Cal-hypo: ~0.7 ppm CH per ppm FC.
  const c = DOSE.effectOf("calhypo", 4, 10000);
  near(c.fc, 2); near(c.ch, 1.4);
  // Dry balance chems invert their dose functions.
  near(DOSE.effectOf("bakingsoda", 48, 10000).ta, 20);
  near(DOSE.effectOf("cyagran", 26, 10000).cya, 20);
  near(DOSE.effectOf("calchl", 92, 10000).ch, 50);
  // Acid: both the pH move and the TA side-effect.
  const a = DOSE.effectOf("acid", 16, 10000);
  near(a.ph, -0.4); near(a.ta, -6.2);
  // Soda ash: pH up and the TA it drags along.
  const s = DOSE.effectOf("sodaash", 12, 10000);
  near(s.ph, 0.4); near(s.ta, 8.4);
  // Volume scaling.
  near(DOSE.effectOf("liq125", 21, 20000).fc, 1);
  // Unknown item throws — never a silent zero.
  assert.throws(() => DOSE.effectOf("mystery_powder", 10, 10000), /Unknown item/);
});

test("cost per +1 ppm FC: built-in benchmarks and shelf-price checks", () => {
  // Built-in rough prices: per-oz cost × oz-per-ppm × volume factor.
  near(DOSE.costPerPpm("liq125", 10000), 10.5 * 0.06);
  near(DOSE.costPerPpm("calhypo", 10000), 2.0 * 0.30);
  near(DOSE.costPerPpm("liq125", 20000), 10.5 * 0.06 * 2);
  // A $5 gallon (128 fl oz) of 12.5%: 10.5 oz/ppm × $0.0390625/oz ≈ $0.41/ppm.
  near(DOSE.customCostPerPpm("liq125", 5, 128, 10000), 10.5 * (5 / 128));
  // Junk price/size → null, not NaN.
  assert.equal(DOSE.customCostPerPpm("liq125", 0, 128, 10000), null);
  assert.equal(DOSE.customCostPerPpm("liq125", 5, 0, 10000), null);
  assert.throws(() => DOSE.costPerPpm("nope", 10000), /Unknown chlorine product/);
});

test("overnight heat model: saturation pressure and the three loss paths", () => {
  const close = (got, want, eps = 0.01) => assert.ok(Math.abs(got - want) <= eps, `expected ~${want}, got ${got}`);
  // Magnus saturation vapor pressure at 84°F ≈ 1.1726 inHg.
  close(DOSE.psatInHg(84), 1.172631, 1e-4);
  // Reference night: 346 ft² (21-ft round), 10k gal, 84°F water, 62°F clear
  // night, 55% RH, 2 mph near-surface wind, 12 h. Hand-computed goldens.
  const base = { area: 346, vol: 10000, waterF: 84, airF: 62, rh: 0.55, windMph: 2, hours: 12, clear: true };
  const u = DOSE.nightHeat({ ...base, covered: false });
  close(u.qEvap, 73.4558);   // evaporation dominates…
  close(u.qRad, 34.949);     // …then radiation to the clear sky…
  close(u.qConv, 35.2);      // …then convection.
  close(u.btu, 596246.86, 5);
  close(u.dropF, 7.1492);    // ~7°F overnight — matches real uncovered pools
  close(u.evapGal, 34.8279); // ~0.16" of water gone by morning
  close(u.evapIn, 0.1615, 1e-3);
  // Same night with the bubble cover on.
  const c = DOSE.nightHeat({ ...base, covered: true });
  close(c.btu, 125653.07, 5);
  close(c.dropF, 1.5066);    // cover keeps ~5.6°F
  close(c.evapGal, 1.0448);  // and ~34 gallons
  // The published "cover cuts heat loss 50–80%" claim falls out of the physics.
  const reduction = 1 - c.btu / u.btu;
  assert.ok(reduction > 0.5 && reduction < 0.85, `reduction ${reduction}`);
  // Muggy air warmer than the water → no evaporative flux, never negative.
  assert.equal(DOSE.nightHeat({ ...base, waterF: 70, airF: 80, rh: 0.9, covered: false }).qEvap, 0);
  // Overcast sky radiates less than clear.
  const cloudy = DOSE.nightHeat({ ...base, clear: false, covered: false });
  assert.ok(cloudy.qRad < u.qRad);
});

test("test-resolution tolerances are locked (the anti-annoyance layer)", () => {
  // These decide when the app says "within test tolerance — no dose" instead
  // of prescribing a correction a home test couldn't even verify. Widening
  // them hides real problems; narrowing them nags users over noise.
  assert.deepEqual(DOSE.TOL, { fc: 0.5, ph: 0.1, ta: 10, cya: 10, ch: 25 });
});

test("puck (3\" trichlor tablet) math for the feeder", () => {
  // One 8-oz puck in 10k gal: 8 / 1.5 oz-per-ppm = +5.33 ppm FC…
  near(DOSE.puckFc(10000), 16 / 3);
  // …and 61% of that as permanent CYA: +3.25 ppm.
  near(DOSE.puckCya(10000), (16 / 3) * 0.61);
  // Bigger pool, smaller per-puck bump.
  near(DOSE.puckFc(20000), 8 / 3);
  // Summer demand of 2.5 ppm/day → 17.5 ppm/week → ~3.3 pucks/wk in 10k gal.
  near(DOSE.pucksPerWeek(10000, 2.5), 17.5 / (16 / 3));
  // Default demand (no arg) is the 2.5 ppm/day summer figure.
  near(DOSE.pucksPerWeek(10000), DOSE.pucksPerWeek(10000, 2.5));
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

test("pH down: muriatic acid, 8 fl oz per -0.2 pH / 10k gal at TA 80", () => {
  near(DOSE.acidOz(8.0, 7.6, 10000), 16); // (0.4/0.2)*8, TA omitted → assume 80
  near(DOSE.acidOz(7.8, 7.6, 10000), 8);
});

test("acid dose scales with alkalinity (more buffer needs more acid)", () => {
  // TA 80 is the baseline — passing it changes nothing.
  near(DOSE.acidOz(8.0, 7.6, 10000, 80), 16);
  // TA 120 buffers 1.5× harder → 24 fl oz.
  near(DOSE.acidOz(8.0, 7.6, 10000, 120), 24);
  // Very low TA swings easily; the factor floors at 0.6 so a soft-buffered
  // pool is never told to pour a full-strength dose.
  near(DOSE.acidOz(8.0, 7.6, 10000, 40), 16 * 0.6);
  near(DOSE.acidOz(8.0, 7.6, 10000, 10), 16 * 0.6);
  // And it caps at 1.5× so a stale high-TA reading can't demand a mega-dose.
  near(DOSE.acidOz(8.0, 7.6, 10000, 400), 16 * 1.5);
  // A junk TA value falls back to the baseline, never NaN.
  near(DOSE.acidOz(8.0, 7.6, 10000, NaN), 16);
  near(DOSE.acidOz(8.0, 7.6, 10000, null), 16);
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

test("an unknown chlorine product fails loudly, never as a silent zero dose", () => {
  // A bad product key must throw, not return 0 — "add nothing" would be a
  // dangerous, hidden mis-dose. Valid keys are unaffected.
  assert.throws(() => DOSE.chlorineOz(2, "not_a_product", 10000), /Unknown chlorine product/);
  near(DOSE.chlorineOz(2, "liq125", 10000), 21);
});

test("acid also nudges TA down — that side note must stay honest", () => {
  // 8 fl oz of 31.45% muriatic in 10k gal neutralizes ~3.1 ppm of alkalinity
  // (2.37 mol HCl against CaCO3-equivalent buffer in 37,854 L).
  near(DOSE.taDrop(8, 10000), 3.1);
  near(DOSE.taDrop(16, 10000), 6.2);
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
