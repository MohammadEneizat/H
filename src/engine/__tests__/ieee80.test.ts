import { describe, it, expect } from 'vitest';
import { surfaceDeratingFactor } from '../soil';
import { tolerableVoltages } from '../safety';
import { decrementFactor } from '../fault';
import { sizeConductor } from '../conductor';
import { geometricFactors, gridGeometry, meshVoltage, stepVoltage, sverakResistance } from '../grid';
import { CONDUCTOR_MATERIALS } from '../materials';
import type { GridSpec } from '../types';

/**
 * The worked example of IEEE Std 80-2013, Annex B.1 — a 70 m × 70 m square grid with no ground rods.
 * Published intermediate values are quoted in each assertion.
 */
const B1 = {
  rho: 400,
  rhoS: 2500,
  hs: 0.102,
  ts: 0.5,
  h: 0.5,
  d: 0.01,
  side: 70,
  spacing: 7,
  IG: 1908,
};

const b1Grid: GridSpec = {
  lengthX: B1.side,
  lengthY: B1.side,
  spacing: B1.spacing,
  depth: B1.h,
  materialId: 'cu-annealed',
  conductorAreaMm2: 67.4,
  conductorDiameterM: B1.d,
  rodCount: 0,
  rodLength: 0,
  rodDiameterM: 0.0159,
  rodsOnPerimeter: false,
};

describe('IEEE Std 80-2013 Annex B.1 — square grid without ground rods', () => {
  const geom = gridGeometry(b1Grid);
  const f = geometricFactors(b1Grid, geom);

  it('derives 1540 m of buried conductor for an 11 × 11 grid', () => {
    expect(geom.conductorLength).toBeCloseTo(1540, 6);
    expect(geom.area).toBeCloseTo(4900, 6);
    expect(geom.perimeter).toBeCloseTo(280, 6);
  });

  it('computes the surface derating factor Cs = 0.74', () => {
    expect(surfaceDeratingFactor(B1.rho, B1.rhoS, B1.hs)).toBeCloseTo(0.7429, 3);
  });

  it('reproduces the published tolerable voltages for a 70 kg body', () => {
    const t = tolerableVoltages({
      weight: 70,
      shockDuration: B1.ts,
      rhoSoil: B1.rho,
      rhoSurface: B1.rhoS,
      surfaceThickness: B1.hs,
    });

    // B.1 prints Estep70 = 2686.6 V and Etouch70 = 838.2 V, but those figures carry Cs rounded to
    // 0.74 through the rest of the calculation. Cs is exactly 0.742857..., so carrying full
    // precision gives 2696.1 V and 840.5 V — 0.35% higher and slightly less conservative.
    expect(t.cs).toBeCloseTo(0.742857, 5);
    expect(t.stepLimit).toBeCloseTo(2696.1, 0);
    expect(t.touchLimit).toBeCloseTo(840.5, 0);

    // Substituting the standard's rounded Cs reproduces its printed values exactly, which confirms
    // the difference is intermediate rounding and not a difference in method.
    const ib = t.bodyCurrent;
    expect((1000 + 6 * 0.74 * B1.rhoS) * ib).toBeCloseTo(2686.6, 0);
    expect((1000 + 1.5 * 0.74 * B1.rhoS) * ib).toBeCloseTo(838.2, 0);
  });

  it('reproduces the published ground resistance Rg = 2.78 Ω', () => {
    const rg = sverakResistance(B1.rho, geom.totalLength, geom.area, B1.h);
    expect(rg).toBeGreaterThan(2.75);
    expect(rg).toBeLessThan(2.81);
  });

  it('reproduces the published geometric factors n = 11, Km = 0.89, Ki = 2.272, Ks = 0.406', () => {
    expect(f.na).toBeCloseTo(11, 6);
    expect(f.nb).toBeCloseTo(1, 6);
    expect(f.nc).toBeCloseTo(1, 6);
    expect(f.nd).toBeCloseTo(1, 6);
    expect(f.n).toBeCloseTo(11, 6);
    expect(f.km).toBeCloseTo(0.89, 2);
    expect(f.ki).toBeCloseTo(2.272, 3);
    expect(f.ks).toBeCloseTo(0.406, 3);
  });

  it('reproduces the published mesh voltage Em ≈ 1002 V', () => {
    const em = meshVoltage(B1.rho, f, B1.IG);
    expect(em).toBeGreaterThan(995);
    expect(em).toBeLessThan(1010);
  });

  it('finds the design non-compliant for touch and compliant for step, as B.1 concludes', () => {
    const t = tolerableVoltages({
      weight: 70,
      shockDuration: B1.ts,
      rhoSoil: B1.rho,
      rhoSurface: B1.rhoS,
      surfaceThickness: B1.hs,
    });
    // B.1 rejects this grid: Em (1002 V) exceeds Etouch70 (838 V), while Es is well within limits.
    expect(meshVoltage(B1.rho, f, B1.IG)).toBeGreaterThan(t.touchLimit);
    expect(stepVoltage(B1.rho, f, B1.IG)).toBeLessThan(t.stepLimit);
  });
});

describe('IEEE Std 80-2013 Table 10 — decrement factor Df', () => {
  const cases: [number, number, number][] = [
    // [tf (s), X/R, published Df]
    [0.5, 10, 1.026],
    [0.5, 20, 1.052],
    [0.5, 30, 1.077],
    [0.25, 10, 1.052],
    [0.1, 20, 1.232],
    [0.1, 30, 1.316],
    [1.0, 40, 1.052],
  ];

  it.each(cases)('tf = %s s, X/R = %s gives Df = %s', (tf, xr, expected) => {
    expect(decrementFactor(tf, xr, 60)).toBeCloseTo(expected, 3);
  });

  // Equation (79) depends on tf and X/R only through the ratio Ta/tf, so any two cases sharing that
  // ratio must agree exactly. This pins the formula's structure independently of any table lookup.
  it('depends on tf and X/R only through Ta/tf', () => {
    expect(decrementFactor(0.5, 40, 60)).toBeCloseTo(decrementFactor(0.25, 20, 60), 10);
    expect(decrementFactor(1.0, 20, 60)).toBeCloseTo(decrementFactor(0.5, 10, 60), 10);
  });

  it('decays toward unity as the fault duration grows', () => {
    expect(decrementFactor(0.05, 30, 60)).toBeGreaterThan(decrementFactor(0.5, 30, 60));
    expect(decrementFactor(30, 30, 60)).toBeCloseTo(1, 2);
  });

  it('increases with X/R at a fixed duration', () => {
    const at = (xr: number) => decrementFactor(0.5, xr, 60);
    expect(at(40)).toBeGreaterThan(at(30));
    expect(at(30)).toBeGreaterThan(at(20));
    expect(at(20)).toBeGreaterThan(at(10));
  });

  it('is unity when there is no dc offset', () => {
    expect(decrementFactor(0.5, 0, 60)).toBe(1);
  });

  it('scales with system frequency through Ta', () => {
    // A 50 Hz system has a 20% longer dc time constant for the same X/R.
    expect(decrementFactor(0.5, 30, 50)).toBeGreaterThan(decrementFactor(0.5, 30, 60));
  });
});

describe('IEEE Std 80-2013 Table 2 — conductor sizing constant Kf', () => {
  /**
   * Kf is defined so that Akcmil = I(kA) · Kf · √tc at an ambient of 40 °C. Recovering it from the
   * Equation (37) implementation exercises every material constant in the table.
   */
  const published: Record<string, number> = {
    'cu-annealed': 7.0,
    'cu-hard': 7.06,
    'cu-hard-brazed': 11.78,
    'ccs-40': 10.45,
    'ccs-30': 12.06,
    'ccs-rod-20': 14.64,
    'al-ec': 12.12,
    'al-5005': 12.41,
    'al-6201': 12.47,
    acs: 17.2,
    'steel-1020': 15.95,
    'ss-clad-rod': 14.72,
    'zn-steel-rod': 28.96,
    'ss-304': 30.05,
  };

  it.each(CONDUCTOR_MATERIALS.map((m) => [m.id, m.name] as const))(
    'material %s (%s) reproduces its published Kf',
    (id) => {
      const expected = published[id];
      expect(expected, `no published Kf for ${id}`).toBeDefined();
      // 1 kA for 1 s, ambient 40 °C, at the material's own fusing temperature.
      const r = sizeConductor(1000, 1, id, 40);
      expect(r.areaKcmil).toBeCloseTo(expected, 1);
    },
  );

  it('sizes roughly 2.5 mm² per kA for copper at 0.5 s, the familiar rule of thumb', () => {
    const r = sizeConductor(20_000, 0.5, 'cu-annealed', 40);
    expect(r.areaMm2 / 20).toBeGreaterThan(2.4);
    expect(r.areaMm2 / 20).toBeLessThan(2.6);
  });

  it('clamps the maximum temperature to the material fusing point', () => {
    const r = sizeConductor(10_000, 0.5, 'cu-annealed', 40, 5000);
    expect(r.maxTemp).toBe(1083);
  });

  it('requires more copper for a brazed joint limited to 250 °C', () => {
    const fusing = sizeConductor(10_000, 0.5, 'cu-annealed', 40);
    const brazed = sizeConductor(10_000, 0.5, 'cu-annealed', 40, 250);
    expect(brazed.areaMm2).toBeGreaterThan(fusing.areaMm2);
  });
});
