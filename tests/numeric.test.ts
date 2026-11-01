import { describe, expect, it } from 'vitest';
import {
  calculateRating,
  calculateTemperature,
  exactInfluence,
  numericRating,
  solveNumeric,
  TRENCH_TEMPLATES,
  trenchToIec,
} from '../src/engine';
import { DEFAULT_INSTALLATION, EXAMPLE_CABLES } from '../src/engine/presets';

const MV = EXAMPLE_CABLES[0];
const HV = EXAMPLE_CABLES[1];

describe('numerical ground model', () => {
  it('reproduces the exact solution for a single cable in uniform ground', () => {
    const objects = [{ x: 0, y: 800, r: 20 }];
    const res = solveNumeric({ objects, rhoAt: () => 1 });
    const exact = exactInfluence(objects, 0, 0);
    expect(Math.abs(res.Fraw[0][0] / exact - 1)).toBeLessThan(0.02);
    expect(res.F[0][0]).toBeCloseTo(exact, 3);
  });

  it('scales with the ground resistivity', () => {
    const objects = [{ x: 0, y: 1000, r: 25 }];
    const res = solveNumeric({ objects, rhoAt: () => 2 });
    expect(res.F[0][0] / (2 * exactInfluence(objects, 0, 0))).toBeCloseTo(1, 3);
  });

  it('agrees with the IEC backfill formula for a rectangular backfill (within 4 %)', () => {
    const objects = [{ x: 0, y: 1000, r: 25 }];
    const inBox = (x: number, y: number) => Math.abs(x) <= 300 && Math.abs(y - 1000) <= 200;
    const res = solveNumeric({
      objects,
      rhoAt: (x, y) => (inBox(x, y) ? 0.5 : 1.5),
      features: { xs: [-300, 300], ys: [800, 1200] },
    });
    const x = 400;
    const y = 600;
    const rb = Math.exp(0.5 * (x / y) * (4 / Math.PI - x / y) * Math.log(1 + (y * y) / (x * x)) + Math.log(x / 2));
    const iec = (0.5 / (2 * Math.PI)) * Math.acosh(1000 / 25) + (1 / (2 * Math.PI)) * Math.acosh(1000 / rb);
    expect(Math.abs(res.F[0][0] / iec - 1)).toBeLessThan(0.04);
  });

  it('keeps the shielding of touching cables close to the IEC touching formula (within 3 %)', () => {
    const objects = [-40, 0, 40].map((x) => ({ x, y: 800, r: 20 }));
    const res = solveNumeric({ objects, rhoAt: () => 1 });
    const centre = res.F[1][0] + res.F[1][1] + res.F[1][2];
    const u = (2 * 800) / 40;
    const iec = 0.475 * Math.log(2 * u) - 0.346;
    expect(Math.abs(centre / iec - 1)).toBeLessThan(0.03);
  });

  it('converges as the grid is refined', () => {
    const objects = [-40, 0, 40].map((x) => ({ x, y: 800, r: 20 }));
    const rhoAt = (_x: number, y: number) => (y < 1000 ? 1 : 2);
    const coarse = solveNumeric({ objects, rhoAt, features: { xs: [], ys: [1000] } });
    const fine = solveNumeric({ objects, rhoAt, features: { xs: [], ys: [1000] }, resolution: 8 });
    const sum = (F: number[][]) => F[1][0] + F[1][1] + F[1][2];
    expect(Math.abs(sum(coarse.F) / sum(fine.F) - 1)).toBeLessThan(0.015);
  });
});

describe('trench layouts', () => {
  it('maps the fill zone around the cables to the IEC backfill rectangle', () => {
    const inst = TRENCH_TEMPLATES[1].apply({ ...DEFAULT_INSTALLATION });
    const { iec } = trenchToIec(inst);
    expect(iec.type).toBe('direct');
    expect(iec.backfill?.rho).toBe(0.9);
    expect(iec.backfill?.height_m).toBeCloseTo(0.55, 9);
    expect(iec.soilRho).toBe(1.0);
  });

  it.each(TRENCH_TEMPLATES.map((t) => [t.label, t] as const))(
    '%s: numerical rating within 5 % of IEC and consistent with the temperature check',
    (_, t) => {
      for (const cable of [MV, HV]) {
        const inst = t.apply({ ...DEFAULT_INSTALLATION });
        const iec = calculateRating(cable, inst);
        expect(iec.ok).toBe(true);
        const num = numericRating(cable, inst, iec)!;
        expect(num.result.ok).toBe(true);
        expect(Math.abs(num.result.I / iec.I - 1)).toBeLessThan(0.05);
        const t2 = calculateTemperature(cable, inst, num.result.I, { numericF: num.numeric.F });
        expect(t2.conductor).toBeCloseTo(cable.maxTemp_C, 4);
        // the field is at ambient on the surface and hotter near the cables
        expect(num.field(0, 0)).toBeCloseTo(inst.ambient_C, 6);
        const p = num.result.positions[0];
        expect(num.field(p.x + 200, p.y)).toBeGreaterThan(inst.ambient_C + 5);
      }
    },
  );

  it('a better backfill raises both ratings', () => {
    const base = TRENCH_TEMPLATES[1].apply({ ...DEFAULT_INSTALLATION });
    const worse = { ...base, trench: { ...base.trench!, zones: base.trench!.zones.map((z) => (z.material === 'cbs' ? { ...z, rho: 2.0 } : z)) } };
    const a = calculateRating(HV, base);
    const b = calculateRating(HV, worse);
    expect(b.I).toBeLessThan(a.I);
    expect(numericRating(HV, worse, b)!.result.I).toBeLessThan(numericRating(HV, base, a)!.result.I);
  });
});
