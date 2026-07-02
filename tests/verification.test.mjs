/*
 * Pool Water Console — chemistry VERIFICATION suite.
 *
 * The golden suite (dosing.test.mjs) locks the engine's behavior so it can't
 * drift. This suite proves the behavior is CORRECT in the first place, three
 * independent ways:
 *
 *   1. FIRST PRINCIPLES — every dosing constant is re-derived here from
 *      molecular weights, densities, and unit conversions, with none of the
 *      app's constants copied in. The app must agree with the chemistry to
 *      within stated tolerances (and where it deviates on purpose — e.g.
 *      baking soda runs ~7% rich — the deviation's direction is asserted).
 *   2. PROPERTIES — invariants that must hold across the whole input space,
 *      swept over grids and a seeded fuzzer: band ordering, linearity in
 *      volume, monotonicity, exact algebraic identities (CSI's log terms,
 *      the heat model's energy bookkeeping), and dose↔effect inverses.
 *   3. PUBLISHED CROSS-CHECKS — doses every pool tech knows by heart
 *      ("a gallon of 12.5% puts ~12 ppm in 10k gal", the TFP SLAM table),
 *      asserted against the engine.
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
const START = "/* ===== DOSE-ENGINE-START";
const END = "/* ===== DOSE-ENGINE-END";
const a = html.indexOf(START), b = html.indexOf(END);
assert.ok(a !== -1 && b !== -1 && b > a, "engine markers missing");
const DOSE = new Function(html.slice(a, b) + "\nreturn DOSE;")();

// ---------- independent unit & chemistry constants (NOT from the app) -------
const L_PER_GAL = 3.785411784;
const G_PER_OZ = 28.349523125;          // avoirdupois ounce
const ML_PER_FLOZ = 29.5735295625;      // US fluid ounce
const LB_PER_GAL_WATER = 8.345;         // lb of water per gallon
// grams of substance per +1 ppm in 10,000 gal (1 ppm = 1 mg/L)
const G_PER_PPM_10K = 10000 * L_PER_GAL / 1000; // 37.854 g
// molecular weights (g/mol)
const MW = {
  CaCO3: 100.09, NaHCO3: 84.007, HCl: 36.461, Cl2: 70.906,
  trichlor: 232.41, CYA: 129.07, dichlorDihydrate: 255.98,
  CaCl2: 110.98, CaCl2_2H2O: 147.01, CaOCl2: 142.98,
  borax: 381.37, boricAcid: 61.83, B: 10.811,
};

const within = (got, want, relTol, label) => {
  const rel = Math.abs(got - want) / Math.abs(want);
  assert.ok(rel <= relTol, `${label}: got ${got}, theory ${want} (off ${(rel * 100).toFixed(1)}%, allowed ${relTol * 100}%)`);
};
const near = (got, want, eps = 1e-9) =>
  assert.ok(Math.abs(got - want) <= eps, `expected ~${want}, got ${got}`);

// deterministic fuzzer — LCG so failures reproduce exactly
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 2 ** 32);
}

/* ============================ 1. FIRST PRINCIPLES ========================== */

test("stoichiometry: every liquid chlorine strength from trade-% definition", () => {
  // Trade %: grams of available Cl2 per 100 mL of product.
  for (const [key, pct, tol] of [
    ["liq125", 12.5, 0.04], ["liq10", 10, 0.04],
    ["bleach825", 8.25, 0.04], ["bleach6", 6, 0.04],
  ]) {
    const theoryFlOz = (G_PER_PPM_10K / (pct / 100)) / ML_PER_FLOZ;
    within(DOSE.CL[key].per, theoryFlOz, tol, `${key} fl oz per ppm per 10k gal`);
  }
});

test("stoichiometry: every dry chlorine strength from % available chlorine", () => {
  for (const [key, pct, tol] of [
    ["calhypo", 65, 0.04], ["dichlor", 56.5, 0.04], ["trichlor", 90, 0.04],
  ]) {
    const theoryOz = (G_PER_PPM_10K / (pct / 100)) / G_PER_OZ;
    within(DOSE.CL[key].per, theoryOz, tol, `${key} oz per ppm per 10k gal`);
  }
});

test("stoichiometry: baking soda vs NaHCO3→CaCO3 equivalence (deliberately rich)", () => {
  // TA is reported as ppm CaCO3 (eq wt 50.045); NaHCO3 delivers 1 eq per 84.007 g.
  const theoryOzPer10 = 10 * G_PER_PPM_10K * (MW.NaHCO3 / (MW.CaCO3 / 2)) / G_PER_OZ; // 22.4 oz
  const app = DOSE.bakingSodaOz(70, 80, 10000);
  // The app doses 24 oz — 5–10% richer than theory, and that bias must stay on
  // the HIGH side (slight TA overshoot is harmless; undershoot means re-dosing).
  assert.ok(app >= theoryOzPer10, `baking soda must not under-dose (app ${app}, theory ${theoryOzPer10})`);
  within(app, theoryOzPer10, 0.10, "baking soda oz per +10 ppm per 10k gal");
});

test("stoichiometry: cyanuric acid is dosed as the pure compound", () => {
  const theoryOzPer10 = 10 * G_PER_PPM_10K / G_PER_OZ; // 13.35 oz
  within(DOSE.cyaOz(30, 40, 10000), theoryOzPer10, 0.04, "CYA oz per +10 ppm per 10k gal");
});

test("stoichiometry: calcium chloride sits between the anhydrous and dihydrate forms", () => {
  // CH is ppm as CaCO3. Retail 'calcium increaser' is 77–94% CaCl2 flake, so the
  // honest per-ppm figure must land between pure anhydrous and pure dihydrate.
  const anhydrous = G_PER_PPM_10K * (MW.CaCl2 / MW.CaCO3) / G_PER_OZ;   // 1.48 oz
  const dihydrate = G_PER_PPM_10K * (MW.CaCl2_2H2O / MW.CaCO3) / G_PER_OZ; // 1.96 oz
  const appPerPpm = DOSE.calciumOz(199, 200, 10000);
  assert.ok(appPerPpm > anhydrous && appPerPpm < dihydrate,
    `CaCl2 ${appPerPpm} oz/ppm must lie in (${anhydrous.toFixed(2)}, ${dihydrate.toFixed(2)})`);
});

test("stoichiometry: salt is exact mass-fraction arithmetic", () => {
  // 1 ppm in 10k gal of water (83,450 lb) = 0.08345 lb NaCl. The app uses
  // 0.0834 — assert to 0.2%.
  const theoryLbPerPpm = 10000 * LB_PER_GAL_WATER / 1e6;
  within(DOSE.saltLb(3199, 3200, 10000), theoryLbPerPpm, 0.002, "salt lb per ppm per 10k gal");
});

test("stoichiometry: TA drop per fl oz of 31.45% muriatic acid", () => {
  // 31.45% w/w HCl, density 1.16 g/mL. Each mole neutralizes one equivalent
  // of alkalinity (50.045 g as CaCO3).
  const gHClPerFlOz = ML_PER_FLOZ * 1.16 * 0.3145;
  const theoryDropPer8 = 8 * (gHClPerFlOz / MW.HCl) * (MW.CaCO3 / 2) / G_PER_PPM_10K;
  within(DOSE.taDrop(8, 10000), theoryDropPer8, 0.02, "TA drop per 8 fl oz acid per 10k gal");
});

test("stoichiometry: trichlor's CYA-per-FC ratio from its molecular formula", () => {
  // Trichlor C3Cl3N3O3: available chlorine 3×Cl2/MW = 91.5% of mass; the
  // cyanurate backbone (129.07/232.41 = 55.5%) stays behind as CYA.
  const theoryRatio = (MW.CYA / MW.trichlor) / (3 * MW.Cl2 / MW.trichlor); // 0.607
  const e = DOSE.effectOf("trichlor", 8, 10000);
  within(e.cya / e.fc, theoryRatio, 0.02, "trichlor ppm CYA per ppm FC");
});

test("stoichiometry: dichlor's CYA-per-FC ratio from the dihydrate formula", () => {
  const theoryRatio = (MW.CYA / MW.dichlorDihydrate) / (2 * MW.Cl2 / MW.dichlorDihydrate); // 0.910
  const e = DOSE.effectOf("dichlor", 2.4, 10000);
  within(e.cya / e.fc, theoryRatio, 0.02, "dichlor ppm CYA per ppm FC");
});

test("stoichiometry: cal-hypo's calcium-per-FC ratio from Ca(OCl)2", () => {
  // Pure Ca(OCl)2: 99.2% available chlorine, calcium reported as CaCO3.
  const avCl = 2 * MW.Cl2 / MW.CaOCl2;
  const theoryRatio = (MW.CaCO3 / MW.CaOCl2) / avCl; // 0.706
  const e = DOSE.effectOf("calhypo", 4, 10000);
  within(e.ch / e.fc, theoryRatio, 0.02, "cal-hypo ppm CH (as CaCO3) per ppm FC");
});

test("stoichiometry: borax and boric-acid routes deliver the same boron", () => {
  // Whatever 'ppm borate' convention the rates use, the two routes must agree
  // with each other on elemental boron — that's route-independence.
  const boraxB = DOSE.borateBoraxOz(0, 50, 10000) * (4 * MW.B / MW.borax);
  const boricB = DOSE.borateBoricOz(0, 50, 10000) * (MW.B / MW.boricAcid);
  within(boraxB, boricB, 0.02, "elemental boron, borax route vs boric-acid route");
});

test("stoichiometry: acid paired with borax at least neutralizes it (with margin)", () => {
  // Na2B4O7·10H2O + 2 HCl → 4 H3BO3 + 2 NaCl: 2 mol HCl per mol borax is the
  // stoichiometric floor; recipes run somewhat over to land pH mid-range.
  const molBorax = DOSE.borateBoraxOz(0, 50, 10000) * G_PER_OZ / MW.borax;
  const molHCl = DOSE.borateAcidFlOz(0, 50, 10000) * ML_PER_FLOZ * 1.16 * 0.3145 / MW.HCl;
  const ratio = molHCl / molBorax;
  assert.ok(ratio >= 2.0 && ratio <= 3.0, `HCl:borax mole ratio ${ratio.toFixed(2)} outside [2, 3]`);
});

test("stoichiometry: one 3\" puck's FC from mass × purity", () => {
  const theoryFc = (8 * G_PER_OZ * 0.90) / G_PER_PPM_10K; // 5.39 ppm per 10k gal
  within(DOSE.puckFc(10000), theoryFc, 0.03, "FC from one 8-oz 90% trichlor puck in 10k gal");
});

test("stoichiometry: Magnus saturation pressure vs steam-table anchors", () => {
  // Engineering steam-table values, inHg: 32°F → 0.1803, 60°F → 0.5218,
  // 80°F → 1.032, 100°F → 1.933, 212°F → 29.92 (boiling at 1 atm).
  within(DOSE.psatInHg(32), 0.1803, 0.01, "psat 32F");
  within(DOSE.psatInHg(60), 0.5218, 0.01, "psat 60F");
  within(DOSE.psatInHg(80), 1.032, 0.01, "psat 80F");
  within(DOSE.psatInHg(100), 1.933, 0.01, "psat 100F");
  // Boiling is far outside Magnus's calibrated range (−45…60°C) and far outside
  // any pool; 3% there is fine — what matters is the ≤0.3% accuracy above.
  within(DOSE.psatInHg(212), 29.92, 0.03, "psat at boiling");
});

/* ============================== 2. PROPERTIES ============================== */

test("property: FC band is well-ordered (min ≤ ideal ≤ max < shock) for every CYA, mode, strategy", () => {
  const strategies = [undefined, "steady", "crystal", "thrifty", "easy", "not_a_strategy"];
  for (let cya = 1; cya <= 300; cya++) {
    for (const salt of [false, true]) {
      for (const st of strategies) {
        const bd = DOSE.fcBand(cya, salt, st);
        const tag = `cya=${cya} salt=${salt} st=${st}`;
        assert.ok(bd.min <= bd.ideal, `min>ideal at ${tag}`);
        assert.ok(bd.ideal <= bd.max, `ideal>max at ${tag}`);
        assert.ok(bd.max < bd.shock, `max>=shock at ${tag}`);
        assert.ok(bd.min > 0 && Number.isFinite(bd.shock), `degenerate at ${tag}`);
      }
    }
  }
  // And the no-CYA fallback band obeys the same ordering.
  const n = DOSE.fcBand(0, false);
  assert.ok(n.min <= n.ideal && n.ideal <= n.max && n.max < n.shock && n.nocya);
});

test("property: safety lines are strategy-invariant everywhere", () => {
  for (let cya = 1; cya <= 200; cya += 1) {
    for (const salt of [false, true]) {
      const base = DOSE.fcBand(cya, salt, "steady");
      for (const st of ["crystal", "thrifty", "easy"]) {
        const bd = DOSE.fcBand(cya, salt, st);
        assert.equal(bd.min, base.min, `floor moved: cya=${cya} salt=${salt} ${st}`);
        assert.equal(bd.max, base.max, `max moved: cya=${cya} salt=${salt} ${st}`);
        assert.equal(bd.shock, base.shock, `shock moved: cya=${cya} salt=${salt} ${st}`);
      }
    }
  }
});

test("property: every dose function is exactly linear in volume and in deficit", () => {
  const vols = [1000, 2500, 10000, 18000, 33000, 50000];
  for (const v of vols) {
    const k = v / 10000;
    near(DOSE.bakingSodaOz(60, 80, v), DOSE.bakingSodaOz(60, 80, 10000) * k, 1e-9);
    near(DOSE.cyaOz(0, 40, v), DOSE.cyaOz(0, 40, 10000) * k, 1e-9);
    near(DOSE.calciumOz(150, 350, v), DOSE.calciumOz(150, 350, 10000) * k, 1e-9);
    near(DOSE.saltLb(2000, 3200, v), DOSE.saltLb(2000, 3200, 10000) * k, 1e-9);
    near(DOSE.chlorineOz(3, "calhypo", v), DOSE.chlorineOz(3, "calhypo", 10000) * k, 1e-9);
    near(DOSE.acidOz(8.0, 7.6, v), DOSE.acidOz(8.0, 7.6, 10000) * k, 1e-9);
    near(DOSE.borateBoricOz(0, 40, v), DOSE.borateBoricOz(0, 40, 10000) * k, 1e-9);
  }
  // Deficit linearity: doubling the gap doubles the dose.
  near(DOSE.bakingSodaOz(40, 80, 10000), 2 * DOSE.bakingSodaOz(60, 80, 10000));
  near(DOSE.cyaOz(0, 40, 10000), 2 * DOSE.cyaOz(20, 40, 10000));
  near(DOSE.chlorineOz(4, "liq125", 10000), 2 * DOSE.chlorineOz(2, "liq125", 10000));
  // Zero deficit → exactly zero, for every function.
  near(DOSE.bakingSodaOz(80, 80, 10000), 0);
  near(DOSE.cyaOz(40, 40, 10000), 0);
  near(DOSE.calciumOz(300, 300, 10000), 0);
  near(DOSE.saltLb(3200, 3200, 10000), 0);
  near(DOSE.acidOz(7.6, 7.6, 10000), 0);
  near(DOSE.sodaAshOz(7.6, 7.6, 10000), 0);
  near(DOSE.borateBoraxOz(40, 40, 10000), 0);
});

test("property: chlorine products dose in exact proportion to their strengths", () => {
  // For the same ppm and volume, product A's dose / product B's dose must equal
  // per(A)/per(B) — i.e., one shared model, no per-product fudge factors.
  const keys = Object.keys(DOSE.CL);
  for (const p of keys) for (const q of keys) {
    const ratio = DOSE.chlorineOz(2.5, p, 12000) / DOSE.chlorineOz(2.5, q, 12000);
    near(ratio, DOSE.CL[p].per / DOSE.CL[q].per, 1e-9);
  }
});

test("property: effectOf is the exact inverse of every dose function", () => {
  const rnd = lcg(42);
  for (let i = 0; i < 200; i++) {
    const vol = 1000 + Math.floor(rnd() * 49000);
    const oz = 0.5 + rnd() * 300;
    for (const p of Object.keys(DOSE.CL)) {
      near(DOSE.chlorineOz(DOSE.effectOf(p, oz, vol).fc, p, vol), oz, 1e-6);
    }
    near(DOSE.bakingSodaOz(80, 80 + DOSE.effectOf("bakingsoda", oz, vol).ta, vol), oz, 1e-6);
    near(DOSE.cyaOz(30, 30 + DOSE.effectOf("cyagran", oz, vol).cya, vol), oz, 1e-6);
    near(DOSE.calciumOz(200, 200 + DOSE.effectOf("calchl", oz, vol).ch, vol), oz, 1e-6);
    near(DOSE.sodaAshOz(7.4, 7.4 + DOSE.effectOf("sodaash", oz, vol).ph, vol), oz, 1e-6);
    // Acid: pH move inverts against acidOz at the TA-80 baseline, and its TA
    // side-effect must equal taDrop exactly.
    const eA = DOSE.effectOf("acid", oz, vol);
    near(DOSE.acidOz(7.6 - eA.ph, 7.6, vol), oz, 1e-6);
    near(-eA.ta, DOSE.taDrop(oz, vol), 1e-9);
  }
});

test("property: acid dose scales with TA exactly as the buffer model states", () => {
  for (const ta of [-50, 0, 10, 48, 60, 80, 100, 120, 160, 400, 1000]) {
    const expectFactor = Math.max(0.6, Math.min(1.5, ta / 80));
    if (ta > 0) near(DOSE.acidOz(8.0, 7.6, 10000, ta), 16 * expectFactor, 1e-9);
  }
  // Junk TA falls back to baseline, never NaN.
  for (const junk of [null, undefined, NaN]) {
    near(DOSE.acidOz(8.0, 7.6, 10000, junk), 16, 1e-9);
  }
});

test("property: CSI obeys its own logarithms exactly", () => {
  const base = [7.5, 90, 250, 30, 82, 1000];
  const csi = (...args) => DOSE.csi(...args);
  // Doubling calcium raises CSI by exactly log10(2).
  near(csi(7.5, 90, 500, 30, 82, 1000) - csi(7.5, 90, 250, 30, 82, 1000), Math.log10(2), 1e-9);
  // Doubling carbonate alkalinity raises CSI by exactly log10(2):
  // carbAlk = TA − CYA/3, so compare TA 100/CYA 30 (90) with TA 190/CYA 30 (180).
  near(csi(7.5, 190, 250, 30, 82, 1000) - csi(7.5, 100, 250, 30, 82, 1000), Math.log10(2), 1e-9);
  // pH enters with slope exactly 1.
  near(csi(7.9, 90, 250, 30, 82, 1000) - csi(7.4, 90, 250, 30, 82, 1000), 0.5, 1e-9);
  // 10× TDS lowers CSI by exactly 0.1.
  near(csi(...base) - DOSE.csi(7.5, 90, 250, 30, 82, 10000), 0.1, 1e-9);
  // Warmer water is always more scale-forming (monotone in temperature).
  let prev = -Infinity;
  for (let t = 32; t <= 105; t += 1) {
    const v = DOSE.csi(7.5, 90, 250, 30, t, 1000);
    assert.ok(v > prev, `CSI not increasing at ${t}F`);
    prev = v;
  }
  // CYA correction: more CYA (less carbonate alkalinity) always lowers CSI.
  assert.ok(csi(7.5, 90, 250, 90, 82, 1000) < csi(7.5, 90, 250, 0, 82, 1000));
});

test("property: the heat model keeps honest energy books", () => {
  const rnd = lcg(7);
  for (let i = 0; i < 300; i++) {
    const o = {
      area: 100 + rnd() * 900, vol: 3000 + rnd() * 30000,
      waterF: 60 + rnd() * 35, airF: 35 + rnd() * 55,
      rh: rnd(), windMph: rnd() * 12, hours: 1 + rnd() * 23,
      clear: rnd() > 0.5,
    };
    const u = DOSE.nightHeat({ ...o, covered: false });
    const c = DOSE.nightHeat({ ...o, covered: true });
    const tag = JSON.stringify(o);
    // Energy bookkeeping: dropF × thermal mass == btu, exactly.
    near(u.dropF * o.vol * 8.34, u.btu, 1e-6);
    // Evaporated gallons ↔ latent heat: gal × 8.34 lb × 1050 BTU/lb equals the
    // evaporative flux integrated over area and time.
    near(u.evapGal * 8.34 * 1050, u.qEvap * o.area * o.hours, 1e-4);
    // The cover never makes things worse (when the pool is losing heat).
    if (u.btu > 0) assert.ok(c.btu < u.btu, `cover didn't help: ${tag}`);
    assert.ok(c.evapGal <= u.evapGal + 1e-12, `cover increased evaporation: ${tag}`);
    // No NaN anywhere.
    for (const k of ["qEvap", "qRad", "qConv", "btu", "dropF", "evapGal", "evapIn"]) {
      assert.ok(Number.isFinite(u[k]) && Number.isFinite(c[k]), `NaN in ${k}: ${tag}`);
    }
    // Evaporation and radiation are one-way (out of the pool); only convection may reverse.
    assert.ok(u.qEvap >= 0 && u.qRad >= 0);
  }
  // Monotone in wind and in the water–air gap; clear sky loses more than overcast.
  const base = { area: 346, vol: 10000, airF: 62, rh: 0.55, hours: 12, clear: true, covered: false };
  let prevBtu = -Infinity;
  for (const w of [0, 1, 2, 4, 8, 12]) {
    const v = DOSE.nightHeat({ ...base, waterF: 84, windMph: w }).btu;
    assert.ok(v > prevBtu, `not monotone in wind at ${w}`);
    prevBtu = v;
  }
  prevBtu = -Infinity;
  for (const wf of [66, 72, 78, 84, 90]) {
    const v = DOSE.nightHeat({ ...base, waterF: wf, windMph: 2 }).btu;
    assert.ok(v > prevBtu, `not monotone in water temp at ${wf}`);
    prevBtu = v;
  }
  assert.ok(
    DOSE.nightHeat({ ...base, waterF: 84, windMph: 2 }).btu >
    DOSE.nightHeat({ ...base, waterF: 84, windMph: 2, clear: false }).btu,
    "clear sky must lose more than overcast");
  // Cover reduction lands in the published 50–85% window across a realistic grid.
  for (const waterF of [76, 80, 84, 88]) for (const airF of [55, 62, 70]) for (const wind of [0.5, 2, 5]) {
    const u = DOSE.nightHeat({ ...base, waterF, airF, windMph: wind });
    const c = DOSE.nightHeat({ ...base, waterF, airF, windMph: wind, covered: true });
    if (u.btu > 1000) {
      const red = 1 - c.btu / u.btu;
      assert.ok(red > 0.5 && red < 0.85, `cover reduction ${red} outside [0.5,0.85] at ${waterF}/${airF}/${wind}`);
    }
  }
});

test("property: temperature forecast converges to a stable equilibrium and stays ordered", () => {
  const env = { area: 346, vol: 10000 };
  const rnd = lcg(99);
  for (let trial = 0; trial < 40; trial++) {
    const day = {
      hiF: 55 + rnd() * 45, loF: 40 + rnd() * 35,
      sunMJ: rnd() * 28, rh: 0.2 + rnd() * 0.7,
      windMph: 0.5 + rnd() * 6, clear: rnd() > 0.5,
    };
    if (day.loF > day.hiF) [day.loF, day.hiF] = [day.hiF, day.loF];
    const days = Array(30).fill(day);
    for (const covered of [false, true]) {
      const t = DOSE.tempForecast(60 + rnd() * 30, days, { ...env, covered });
      // Clamped to the sane band throughout.
      assert.ok(Math.min(...t) >= 50 && Math.max(...t) <= 95);
      // Converged: the last daily step is tiny.
      assert.ok(Math.abs(t[29] - t[28]) < 0.75, `not converging: step ${Math.abs(t[29] - t[28])}`);
      // No single day moves an implausible amount.
      for (let i = 1; i < 30; i++) assert.ok(Math.abs(t[i] - t[i - 1]) < 16, "daily swing too large");
    }
    const unc = DOSE.tempForecast(75, days, { ...env, covered: false });
    const cov = DOSE.tempForecast(75, days, { ...env, covered: true });
    for (let i = 0; i < 30; i++) assert.ok(cov[i] >= unc[i] - 1e-9, "cover fell behind open water");
  }
});

test("property: dilution math is exact set-algebra", () => {
  const rnd = lcg(2024);
  for (let i = 0; i < 500; i++) {
    const target = 10 + rnd() * 200;
    const current = target + rnd() * 400;
    const p = DOSE.drainPct(current, target);
    assert.ok(p >= 0 && p < 1);
    // Replacing fraction p with 0-ppm water lands exactly on target.
    near(current * (1 - p), target, 1e-9);
  }
});

test("property: shelf-price math is consistent with the built-in benchmarks", () => {
  for (const p of Object.keys(DOSE.CL)) {
    for (const vol of [5000, 10000, 24000]) {
      // Pricing a container at exactly the built-in per-oz cost must reproduce
      // costPerPpm for any container size.
      for (const sizeOz of [32, 128, 640]) {
        near(DOSE.customCostPerPpm(p, DOSE.CL[p].cost * sizeOz, sizeOz, vol),
             DOSE.costPerPpm(p, vol), 1e-9);
      }
    }
  }
});

test("property: tolerances are narrower than the bands they soften", () => {
  const T = DOSE.targets(false, "vinyl");
  assert.ok(DOSE.TOL.ph < (7.8 - 7.4));
  assert.ok(DOSE.TOL.ta < (T.ta.max - T.ta.min));
  assert.ok(DOSE.TOL.cya < (T.cya.max - T.cya.min));
  for (const surface of ["vinyl", "fiberglass", "plaster"]) {
    const ch = DOSE.targets(false, surface).ch;
    assert.ok(DOSE.TOL.ch < (ch.max - ch.min), `TOL.ch too wide for ${surface}`);
  }
  assert.ok(DOSE.TOL.salt < (DOSE.SALT.max - DOSE.SALT.min));
  // FC: tolerance must be smaller than the band at the lowest supported CYA.
  const bd = DOSE.fcBand(1, false);
  assert.ok(DOSE.TOL.fc < (bd.max - bd.min));
});

test("property: all target bands are well-ordered for every surface and mode", () => {
  for (const surface of ["vinyl", "fiberglass", "plaster", "bogus", undefined]) {
    for (const salt of [false, true]) {
      const T = DOSE.targets(salt, surface);
      for (const k of ["ph", "ta", "ch", "cya"]) {
        assert.ok(T[k].min < T[k].ideal && T[k].ideal < T[k].max, `${k} band disordered (${surface}, salt=${salt})`);
      }
    }
  }
  assert.ok(DOSE.SALT.min < DOSE.SALT.ideal && DOSE.SALT.ideal < DOSE.SALT.max);
  assert.ok(DOSE.BORATE.min < DOSE.BORATE.ideal && DOSE.BORATE.ideal < DOSE.BORATE.max);
});

test("property: numeric hygiene under fuzz — no NaN, no Infinity, loud errors for junk", () => {
  const rnd = lcg(1337);
  for (let i = 0; i < 400; i++) {
    const vol = 500 + rnd() * 60000;
    const v1 = rnd() * 400, v2 = rnd() * 400;
    for (const fn of [
      () => DOSE.bakingSodaOz(v1, v2, vol),
      () => DOSE.sodaAshOz(6 + rnd() * 3, 6 + rnd() * 3, vol),
      () => DOSE.acidOz(6 + rnd() * 3, 6 + rnd() * 3, vol, rnd() * 300),
      () => DOSE.calciumOz(v1, v2, vol),
      () => DOSE.cyaOz(v1, v2, vol),
      () => DOSE.saltLb(v1 * 20, v2 * 20, vol),
      () => DOSE.taDrop(rnd() * 100, vol),
      () => DOSE.csi(6 + rnd() * 3, 1 + v1, 1 + v2, rnd() * 150, 32 + rnd() * 70, 100 + rnd() * 9000),
      () => DOSE.puckFc(vol, rnd() * 10),
      () => DOSE.pucksPerWeek(vol, rnd() * 6, 0.5 + rnd() * 8),
      () => DOSE.borateBoraxOz(rnd() * 50, rnd() * 50, vol),
      () => DOSE.costPerPpm("liq125", vol),
    ]) {
      const out = fn();
      assert.ok(Number.isFinite(out), `non-finite output: ${fn.toString()}`);
    }
  }
  // Unknown identifiers must throw, never return a silent zero dose.
  assert.throws(() => DOSE.chlorineOz(2, "mystery", 10000), /Unknown chlorine product/);
  assert.throws(() => DOSE.effectOf("mystery", 10, 10000), /Unknown item/);
  assert.throws(() => DOSE.costPerPpm("mystery", 10000), /Unknown chlorine product/);
  assert.throws(() => DOSE.customCostPerPpm("mystery", 5, 128, 10000), /Unknown chlorine product/);
});

/* ========================= 3. PUBLISHED CROSS-CHECKS ======================= */

test("cross-check: the doses every pool tech knows by heart", () => {
  // "A gallon of 12.5% raises 10,000 gal by about 12 ppm."
  const gal125 = DOSE.effectOf("liq125", 128, 10000).fc;
  assert.ok(gal125 > 11.5 && gal125 < 12.8, `gallon of 12.5% gave ${gal125} ppm`);
  // "A 1-lb bag of 65% cal-hypo raises 10,000 gal by about 8 ppm."
  const bagCalHypo = DOSE.effectOf("calhypo", 16, 10000).fc;
  assert.ok(bagCalHypo > 7.5 && bagCalHypo < 8.4, `1 lb cal-hypo gave ${bagCalHypo} ppm`);
  // "A pound of trichlor is good for ~10.5 ppm in 10k gal."
  const lbTrichlor = DOSE.effectOf("trichlor", 16, 10000).fc;
  assert.ok(lbTrichlor > 10 && lbTrichlor < 11.2, `1 lb trichlor gave ${lbTrichlor} ppm`);
  // "A 40-lb bag of salt raises 10,000 gal by ~480 ppm."
  const bagPpm = 40 / DOSE.saltLb(0, 1, 10000);
  assert.ok(bagPpm > 465 && bagPpm < 495, `40-lb salt bag gave ${bagPpm} ppm`);
  // "About 1.4 lb of baking soda per +10 ppm TA per 10k gal."
  const bs = DOSE.bakingSodaOz(70, 80, 10000) / 16;
  assert.ok(bs > 1.35 && bs < 1.55, `baking soda ${bs} lb per +10 TA`);
  // "The TFP 50-ppm borate recipe: ~4.75 boxes of borax + ~2 gal of acid per 10k gal."
  const boxes = DOSE.borateBoraxOz(0, 50, 10000) / 76;
  const acidGal = DOSE.borateAcidFlOz(0, 50, 10000) / 128;
  assert.ok(boxes > 4.4 && boxes < 5.1, `borax boxes ${boxes}`);
  assert.ok(acidGal > 1.7 && acidGal < 2.1, `borate acid ${acidGal} gal`);
});

test("cross-check: the TFP SLAM table", () => {
  // Published shock levels by CYA (troublefreepool.com FC/CYA chart).
  const table = { 30: 12, 40: 16, 50: 20, 60: 24, 70: 28, 80: 32, 90: 36, 100: 40 };
  for (const [cya, slam] of Object.entries(table)) {
    assert.equal(DOSE.fcBand(Number(cya), false).shock, slam, `SLAM at CYA ${cya}`);
  }
});

test("cross-check: FC targets track the TFP percentages at standard CYAs", () => {
  for (const cya of [30, 40, 50, 60, 70, 80]) {
    const bd = DOSE.fcBand(cya, false);
    near(bd.min, Math.max(2, Math.round(cya * 0.05 * 10) / 10), 1e-9);
    near(bd.ideal, Math.round(cya * 0.075 * 10) / 10, 1e-9);
    near(bd.max, Math.round(cya * 0.10 * 10) / 10, 1e-9);
  }
  // Salt pools: leaner target (6%), CYA band 60–80 — the SWG convention.
  const s = DOSE.targets(true);
  assert.equal(s.cya.min, 60); assert.equal(s.cya.max, 80);
  near(DOSE.fcBand(70, true).ideal, 4.2, 1e-9);
});

test("cross-check: industry balance bands (APSP/TFP consensus)", () => {
  const T = DOSE.targets(false, "plaster");
  // pH 7.4–7.8 and plaster calcium 250–450 are the textbook plaster numbers.
  assert.equal(T.ph.min, 7.4); assert.equal(T.ph.max, 7.8);
  assert.equal(T.ch.min, 250); assert.equal(T.ch.max, 450);
  // Salt band brackets the common cell spec (2700–3400 sweet spot ~3200).
  assert.ok(DOSE.SALT.min <= 2700 && DOSE.SALT.max >= 3400);
  assert.equal(DOSE.SALT.ideal, 3200);
});
