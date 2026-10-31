import { describe, expect, it } from 'vitest';
import { calculateRating, calculateTemperature, deriveGeometry, sweepRating } from '../src/engine';
import { conductorAC, eddyCoefficients, sheathLossFactors, skinEffectFactor } from '../src/engine/losses';
import { DEFAULT_INSTALLATION, EXAMPLE_CABLES } from '../src/engine/presets';
import { buriedIsolatedT4, circuitPositions, ductBankRadius, groupT4 } from '../src/engine/thermal';
import type { CableSpec, CircuitSpec, InstallationSpec } from '../src/engine/types';

const MV = EXAMPLE_CABLES[0];
const HV = EXAMPLE_CABLES[1];
const CORR = EXAMPLE_CABLES[2];
const inst = (patch: Partial<InstallationSpec> = {}): InstallationSpec => ({ ...DEFAULT_INSTALLATION, ...patch });

describe('conductor losses (IEC 60287-1-1 2.1)', () => {
  it('skin effect formula pieces join up at xs = 2.8 and 3.8', () => {
    // The standard's three pieces meet to within ~0.001 (they are not exactly continuous).
    const low = 2.8 ** 4 / (192 + 0.8 * 2.8 ** 4);
    const mid = -0.136 - 0.0177 * 2.8 + 0.0563 * 2.8 ** 2;
    expect(Math.abs(low - mid)).toBeLessThan(0.002);
    expect(skinEffectFactor(2.8)).toBeCloseTo(low, 12);
    expect(skinEffectFactor(3.2)).toBeCloseTo(-0.136 - 0.0177 * 3.2 + 0.0563 * 3.2 ** 2, 12);
    expect(skinEffectFactor(4.5)).toBeCloseTo(0.354 * 4.5 - 0.733, 12);
    const mid38 = -0.136 - 0.0177 * 3.8 + 0.0563 * 3.8 ** 2;
    const high38 = 0.354 * 3.8 - 0.733;
    expect(Math.abs(mid38 - high38)).toBeLessThan(0.003);
  });

  it('computes R = R′(1 + ys + yp) from the IEC equations', () => {
    const R0 = 0.0283e-3;
    const r = conductorAC({ R0, alpha20: 3.93e-3, theta: 90, f: 50, ks: 1, kp: 1, dc: 30, s: 70 });
    const Rdc = R0 * (1 + 3.93e-3 * 70);
    const xs2 = ((8 * Math.PI * 50) / Rdc) * 1e-7;
    const ys = xs2 ** 2 / (192 + 0.8 * xs2 ** 2);
    const F = ys; // kp = ks = 1, so F(xp) equals ys
    const yp = F * (30 / 70) ** 2 * (0.312 * (30 / 70) ** 2 + 1.18 / (F + 0.27));
    expect(r.Rdc).toBeCloseTo(Rdc, 12);
    expect(r.ys).toBeCloseTo(ys, 10);
    expect(r.yp).toBeCloseTo(yp, 10);
    expect(r.R).toBeCloseTo(Rdc * (1 + ys + yp), 12);
  });
});

describe('sheath losses (IEC 60287-1-1 2.3)', () => {
  const base = {
    R: 30e-6,
    Rs: 150e-6,
    rhoS: 2.1e-8,
    d: 60,
    Ds: 62,
    ts: 1,
    s: 70,
    omega: 2 * Math.PI * 50,
    formation: 'trefoil' as const,
    transposed: false,
    bonding: 'both' as const,
    milliken: false,
    crossBondLambda1: 0.03,
  };

  it('trefoil, both ends bonded: λ1′ = (Rs/R)/(1 + (Rs/X)²), no eddy losses', () => {
    const out = sheathLossFactors(base);
    const X = 2 * base.omega * 1e-7 * Math.log((2 * base.s) / base.d);
    const expected = (base.Rs / base.R) / (1 + (base.Rs / X) ** 2);
    out.cables.forEach((c) => {
      expect(c.lambda1p).toBeCloseTo(expected, 12);
      expect(c.lambda1pp).toBe(0);
    });
  });

  it('flat, untransposed: outer lagging cable has the largest circulating loss', () => {
    const out = sheathLossFactors({ ...base, formation: 'flat' });
    const [lead, centre, lag] = out.cables.map((c) => c.lambda1p);
    expect(lag).toBeGreaterThan(lead);
    expect(lead).toBeGreaterThan(centre);
  });

  it('single-point bonding: no circulating losses, eddy losses from 2.3.6', () => {
    const out = sheathLossFactors({ ...base, bonding: 'single' });
    const m = (base.omega / base.Rs) * 1e-7;
    const { l0, d1, d2 } = eddyCoefficients(m, base.d / (2 * base.s), 'trefoil');
    const beta1 = Math.sqrt((4 * Math.PI * base.omega) / (1e7 * base.rhoS));
    const gs = 1 + (base.ts / base.Ds) ** 1.74 * (beta1 * base.Ds * 1e-3 - 1.6);
    const expected = (base.Rs / base.R) * (gs * l0 * (1 + d1 + d2) + (beta1 * base.ts) ** 4 / 12e12);
    out.cables.forEach((c) => {
      expect(c.lambda1p).toBe(0);
      expect(c.lambda1pp).toBeCloseTo(expected, 12);
    });
  });

  it('cross bonding adds the entered unbalance factor to the eddy losses', () => {
    const out = sheathLossFactors({ ...base, bonding: 'cross', crossBondLambda1: 0.05 });
    const single = sheathLossFactors({ ...base, bonding: 'single' });
    out.cables.forEach((c, i) => {
      expect(c.lambda1p).toBe(0.05);
      expect(c.lambda1pp).toBeCloseTo(single.cables[i].lambda1pp, 12);
    });
  });

  it('Milliken conductor, both ends bonded: eddy losses reduced by Ft', () => {
    const out = sheathLossFactors({ ...base, milliken: true });
    const single = sheathLossFactors({ ...base, bonding: 'single' });
    const X = 2 * base.omega * 1e-7 * Math.log((2 * base.s) / base.d);
    const M = base.Rs / X;
    const Ft = (M * M) / (M * M + 1);
    expect(out.Ft).toBeCloseTo(Ft, 12);
    expect(out.cables[0].lambda1pp).toBeCloseTo(single.cables[0].lambda1pp * Ft, 12);
  });
});

describe('external thermal resistance (IEC 60287-2-1 2.2)', () => {
  it('flat spaced superposition equals ρ/2π·ln{(u + √(u²−1))[1 + (2L/s1)²]}', () => {
    const rho = 1.2;
    const L = 1000;
    const De = 50;
    const s = 200;
    const g = groupT4(rho, De, circuitPositions('flat', s, L), 'flat', false, L);
    const u = (2 * L) / De;
    const expected = (rho / (2 * Math.PI)) * Math.log((u + Math.sqrt(u * u - 1)) * (1 + ((2 * L) / s) ** 2));
    expect(g.hottest).toBe(1);
    expect(g.T4).toBeCloseTo(expected, 10);
  });

  it('touching trefoil and flat use the closed formulas', () => {
    const u = (2 * 800) / 40;
    expect(groupT4(1, 40, [], 'trefoil', true, 800).T4).toBeCloseTo((1.5 / Math.PI) * (Math.log(2 * u) - 0.63), 12);
    expect(groupT4(1, 40, [], 'flat', true, 800).T4).toBeCloseTo(0.475 * Math.log(2 * u) - 0.346, 12);
  });

  it('isolated cable: ρ/2π·ln(u + √(u²−1))', () => {
    expect(buriedIsolatedT4(1, 1000, 100)).toBeCloseTo((1 / (2 * Math.PI)) * Math.acosh(20), 12);
  });

  it('duct bank equivalent radius of a square bank', () => {
    // ln rb = ½(4/π − 1)·ln 2 + ln(x/2)
    const x = 600;
    const expected = Math.exp(0.5 * (4 / Math.PI - 1) * Math.log(2) + Math.log(x / 2));
    expect(ductBankRadius(x, x)).toBeCloseTo(expected, 9);
  });
});

describe('cable geometry from datasheet layers', () => {
  it('builds diameters and t1 for a wire-screened cable', () => {
    const { geometry: g, errors } = deriveGeometry(MV);
    expect(errors).toEqual([]);
    expect(g.Di).toBeCloseTo(18.4 + 2 * 0.7 + 2 * 5.5, 9);
    expect(g.Dunder).toBeCloseTo(g.Di + 2 * 0.8 + 2 * 0.6, 9);
    expect(g.dMean).toBeCloseTo(g.Dunder + 0.8, 9);
    expect(g.t1).toBeCloseTo((g.Dunder - 18.4) / 2, 9);
    expect(g.De).toBeCloseTo(g.Dunder + 2 * 0.8 + 2 * 2.5, 9);
  });

  it('uses the mean internal diameter for T1 of a corrugated sheath', () => {
    const { geometry: g } = deriveGeometry(CORR);
    expect(g.Dit).toBeCloseTo(g.Dunder, 9);
    expect(g.t1).toBeCloseTo(((g.Dit! + g.Doc!) / 2 - 1.6 - 34) / 2, 9);
    expect(g.De).toBeCloseTo(88 + 2 * 4, 9);
  });

  it('reports missing datasheet values', () => {
    const bad: CableSpec = { ...MV, screen: { ...MV.screen, area_mm2: null } };
    expect(deriveGeometry(bad).errors.length).toBe(1);
  });
});

describe('rating (IEC 60287-1-1 1.4)', () => {
  it('matches a step-by-step hand calculation: MV cable, trefoil touching, single-point bonded', () => {
    const r = calculateRating(MV, inst({ bonding: 'single' }));
    expect(r.ok).toBe(true);

    // Independent calculation following the standard, spreadsheet style.
    const f = 50;
    const w = 2 * Math.PI * f;
    const dc = 18.4;
    const Dunder = 18.4 + 2 * (0.7 + 5.5 + 0.8 + 0.6);
    const d = Dunder + 0.8;
    const Ds = Dunder + 1.6;
    const De = Ds + 5;
    const s = De;
    const Rdc = (0.125 / 1000) * (1 + 4.03e-3 * 70);
    const xs2 = ((8 * Math.PI * f) / Rdc) * 1e-7;
    const ys = xs2 ** 2 / (192 + 0.8 * xs2 ** 2);
    const F = ys;
    const yp = F * (dc / s) ** 2 * (0.312 * (dc / s) ** 2 + 1.18 / (F + 0.27));
    const R = Rdc * (1 + ys + yp);
    const T1 = (3.5 / (2 * Math.PI)) * Math.log(1 + (2 * ((Dunder - dc) / 2)) / dc);
    const T3 = (3.5 / (2 * Math.PI)) * Math.log(1 + (2 * 2.5) / Ds);
    const u = (2 * 800) / De;
    const T4 = (1.5 / Math.PI) * 1.0 * (Math.log(2 * u) - 0.63);
    const Rs20 = 1.7241e-8 / 25e-6;
    const ts = 25 / (Math.PI * d);
    let thetaS = 80;
    let I = 0;
    for (let k = 0; k < 100; k++) {
      const kT = 1 + 3.93e-3 * (thetaS - 20);
      const Rs = Rs20 * kT;
      const rhoS = 1.7241e-8 * kT;
      const m = (w / Rs) * 1e-7;
      const r2 = d / (2 * s);
      const l0 = 3 * ((m * m) / (1 + m * m)) * r2 * r2;
      const d1 = m <= 0.1 ? 0 : (1.14 * m ** 2.45 + 0.33) * r2 ** (0.92 * m + 1.66);
      const beta1 = Math.sqrt((4 * Math.PI * w) / (1e7 * rhoS));
      const gs = 1 + (ts / Ds) ** 1.74 * (beta1 * Ds * 1e-3 - 1.6);
      const l1 = (Rs / R) * (gs * l0 * (1 + d1) + (beta1 * ts) ** 4 / 12e12);
      I = Math.sqrt((90 - 20) / (R * T1 + R * (1 + l1) * (T3 + T4)));
      thetaS = 90 - I * I * R * T1;
    }
    expect(r.conductor.R).toBeCloseTo(R, 14);
    expect(r.thermal.T1).toBeCloseTo(T1, 12);
    expect(r.thermal.T3).toBeCloseTo(T3, 12);
    expect(r.thermal.t4.T4).toBeCloseTo(T4, 12);
    expect(r.I).toBeCloseTo(I, 6);
  });

  const cases: [string, CableSpec, Partial<InstallationSpec>][] = [
    ['MV direct trefoil, both ends', MV, {}],
    ['MV direct flat spaced, single point', MV, { formation: 'flat', touching: false, spacing_mm: 90, bonding: 'single' }],
    ['MV direct, two-zone soil', MV, { soilModel: 'two-zone' }],
    ['MV ducts flat', MV, { type: 'ducts', formation: 'flat', touching: false, spacing_mm: 200 }],
    ['MV duct bank', MV, { type: 'ductbank', depth_m: 1 }],
    ['MV air trefoil, solar', MV, { type: 'air', ambient_C: 30, air: { ...DEFAULT_INSTALLATION.air, solar: true } }],
    ['HV flat cross-bonded', HV, { formation: 'flat', touching: false, spacing_mm: 250, bonding: 'cross', depth_m: 1.2 }],
    ['HV flat both ends untransposed', HV, { formation: 'flat', touching: false, spacing_mm: 250, depth_m: 1.2 }],
    ['Corrugated trefoil, single point', CORR, { bonding: 'single', depth_m: 1.2 }],
  ];

  it.each(cases)('%s: the conductor reaches exactly θmax at the rated current', (_, cable, patch) => {
    const i = inst(patch);
    const r = calculateRating(cable, i);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    const t = calculateTemperature(cable, i, r.I);
    expect(t.conductor).toBeCloseTo(cable.maxTemp_C, 6);
  });

  it('rating falls with depth, soil resistivity and ambient temperature', () => {
    const depth = sweepRating(MV, inst(), 'depth_m', [0.6, 0.8, 1.0, 1.5]).map((p) => p.I);
    const rho = sweepRating(MV, inst(), 'soilRho', [0.7, 1.0, 1.5, 2.5]).map((p) => p.I);
    const amb = sweepRating(MV, inst(), 'ambient_C', [10, 20, 30]).map((p) => p.I);
    for (const series of [depth, rho, amb]) {
      for (let i = 1; i < series.length; i++) expect(series[i]).toBeLessThan(series[i - 1]);
    }
  });

  it('single-point bonding rates higher than both-ends bonding for a lead-sheathed HV cable', () => {
    const p = { formation: 'flat' as const, touching: false, spacing_mm: 250, depth_m: 1.2 };
    const both = calculateRating(HV, inst({ ...p, bonding: 'both' })).I;
    const single = calculateRating(HV, inst({ ...p, bonding: 'single' })).I;
    const cross = calculateRating(HV, inst({ ...p, bonding: 'cross' })).I;
    expect(single).toBeGreaterThan(cross);
    expect(cross).toBeGreaterThan(both);
  });

  it('dielectric losses follow the IEC 60287-1-1 Table 3 threshold', () => {
    expect(calculateRating(HV, inst()).dielectric.Wd).toBe(0);
    const forced = calculateRating(HV, inst({ forceDielectric: true }));
    const C = (2.5 / (18 * Math.log(forced.geometry.Di / forced.geometry.dcScreen))) * 1e-9;
    expect(forced.dielectric.Wd).toBeCloseTo(2 * Math.PI * 50 * C * 76e3 ** 2 * 0.001, 9);
    const hv220: CableSpec = { ...HV, U0_kV: 127 };
    expect(calculateRating(hv220, inst()).dielectric.included).toBe(true);
  });

  it('two-zone drying-out never rates above the moist-soil value', () => {
    const moist = calculateRating(MV, inst()).I;
    const dry = calculateRating(MV, inst({ soilModel: 'two-zone' }));
    expect(dry.I).toBeLessThanOrEqual(moist);
    expect(dry.cases.length).toBe(2);
  });

  it('avoiding drying-out keeps the cable surface at θx', () => {
    const i = inst({ soilModel: 'avoid-drying', criticalTemp_C: 50 });
    const r = calculateRating(MV, i);
    const t = calculateTemperature(MV, inst(), r.I);
    expect(t.surface).toBeCloseTo(50, 4);
    expect(t.conductor).toBeLessThan(90);
  });

  it('a datasheet AC resistance replaces the calculated one', () => {
    const withRac: CableSpec = { ...MV, conductor: { ...MV.conductor, Rac_ohm_km: 0.17 } };
    const r = calculateRating(withRac, inst());
    expect(r.conductor.fromDatasheet).toBe(true);
    expect(r.conductor.R).toBeCloseTo(0.17e-3, 12);
    expect(r.I).toBeLessThan(calculateRating(MV, inst()).I);
  });

  it('rejects impossible layouts', () => {
    expect(calculateRating(MV, inst({ touching: false, spacing_mm: 20 })).ok).toBe(false);
    expect(
      calculateRating(MV, inst({ type: 'ducts', duct: { ...DEFAULT_INSTALLATION.duct, innerD_mm: 35 } })).ok,
    ).toBe(false);
    expect(
      calculateRating(MV, inst({ type: 'ductbank', bank: { width_m: 0.2, height_m: 0.2, concreteRho: 1 } })).ok,
    ).toBe(false);
  });
});

describe('several circuits (IEC 60287-2-1 2.2.3.1)', () => {
  const other = (patch: Partial<CircuitSpec> = {}): CircuitSpec => ({
    id: 'c2',
    name: 'C2',
    cable: null,
    x_m: 0.5,
    depth_m: 0.8,
    formation: 'trefoil',
    touching: true,
    spacing_mm: 100,
    transposed: false,
    bonding: 'both',
    crossBondLambda1: null,
    load: 'rated',
    current_A: 0,
    ...patch,
  });

  it('a circuit far away, or one carrying no current, leaves the rating unchanged', () => {
    const single = calculateRating(MV, inst()).I;
    expect(calculateRating(MV, inst({ circuits: [other({ x_m: 2000 })] })).I).toBeCloseTo(single, 3);
    expect(calculateRating(MV, inst({ circuits: [other({ load: 'fixed', current_A: 0 })] })).I).toBeCloseTo(single, 9);
  });

  it('two identical circuits side by side: both rate lower and equally, in either mode', () => {
    const single = calculateRating(MV, inst()).I;
    const own = calculateRating(MV, inst({ circuits: [other()] }));
    const equal = calculateRating(MV, inst({ circuits: [other()], ratingMode: 'equal-current' }));
    expect(own.I).toBeLessThan(single);
    expect(own.system!.circuits[1].I).toBeCloseTo(own.I, 6);
    expect(equal.I).toBeCloseTo(own.I, 6);
  });

  it('each rated circuit reaches exactly its maximum temperature (own-limit mode)', () => {
    const i = inst({ circuits: [other({ x_m: 0.4 }), other({ id: 'c3', name: 'C3', x_m: -0.4 })] });
    const r = calculateRating(MV, i);
    expect(r.ok).toBe(true);
    r.system!.circuits.forEach((c) => expect(c.hottestTemp).toBeCloseTo(90, 6));
    // the middle circuit is heated most, so it rates lowest
    expect(r.I).toBeLessThan(r.system!.circuits[1].I);
    expect(calculateTemperature(MV, i, r.I).conductor).toBeCloseTo(90, 5);
  });

  it('matches superposition over all six cables for equally loaded, equal-loss circuits', () => {
    const flat = { formation: 'flat' as const, touching: false, spacing_mm: 100, transposed: true, depth_m: 1 };
    const i = inst({ ...flat, ratingMode: 'equal-current', circuits: [other({ ...flat, x_m: 0.5 })] });
    const r = calculateRating(MV, i);
    expect(r.ok).toBe(true);
    const De = r.geometry.De;
    const xs = [-100, 0, 100, 400, 500, 600];
    const y = 1000;
    const T4s = xs.map((xp) => {
      let sum = Math.acosh((2 * y) / De);
      xs.forEach((xk) => {
        if (xk !== xp) sum += Math.log(Math.hypot(xp - xk, 2 * y) / Math.abs(xp - xk));
      });
      return (1 / (2 * Math.PI)) * sum;
    });
    const T4 = Math.max(...T4s);
    const R = r.conductor.R;
    const l1 = r.sheath.lambda1;
    const I = Math.sqrt((90 - 20) / (R * r.thermal.T1 + R * (1 + l1) * (r.thermal.T3 + T4)));
    expect(r.I).toBeCloseTo(I, 6);
  });

  it('a heavily loaded neighbour reduces the rating and is flagged when it overheats', () => {
    const r = calculateRating(MV, inst({ circuits: [other({ cable: HV, x_m: 0.6, depth_m: 1, load: 'fixed', current_A: 1600 })] }));
    expect(r.ok).toBe(true);
    expect(r.I).toBeLessThan(calculateRating(MV, inst()).I);
    expect(r.warnings.some((w) => w.includes('C2 reaches'))).toBe(true);
  });

  it('rejects circuits that overlap', () => {
    const r = calculateRating(MV, inst({ circuits: [other({ x_m: 0.02 })] }));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/overlap/);
  });

  it('works in ducts and in a shared duct bank', () => {
    const ducts = calculateRating(MV, inst({ type: 'ducts', circuits: [other({ x_m: 0.4 })] }));
    expect(ducts.ok).toBe(true);
    expect(ducts.I).toBeLessThan(calculateRating(MV, inst({ type: 'ducts' })).I);
    const bank = calculateRating(
      MV,
      inst({
        type: 'ductbank',
        depth_m: 1,
        bank: { width_m: 0.8, height_m: 0.5, concreteRho: 1, centreX_m: 0.15, centreDepth_m: null },
        circuits: [other({ x_m: 0.3, depth_m: 1 })],
      }),
    );
    expect(bank.ok).toBe(true);
    expect(bank.system!.circuits[1].I).toBeCloseTo(bank.I, 6);
  });
});
