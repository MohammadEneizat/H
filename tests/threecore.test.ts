import { describe, expect, it } from 'vitest';
import {
  calculateRating,
  calculateTemperature,
  deriveGeometry,
  layoutCircuits,
  numericRating,
  TRENCH_TEMPLATES,
  thermal,
} from '../src/engine';
import { DEFAULT_INSTALLATION, EXAMPLE_CABLES } from '../src/engine/presets';
import type { CableSpec, CircuitSpec, ConduitSpec, InstallationSpec } from '../src/engine/types';

const NA2XY3 = EXAMPLE_CABLES.find((c) => c.cores === 3)!;
const NA2XY1 = EXAMPLE_CABLES.find((c) => c.name.includes('1×240 mm² RM'))!;
const base: InstallationSpec = { ...DEFAULT_INSTALLATION, depth_m: 2, soilRho: 1, ambient_C: 20 };
const K: ConduitSpec = { id: 'k', name: 'DN160', x_m: 0, depth_m: 2, material: 'PE', innerD_mm: 141, outerD_mm: 160 };
const other = (patch: Partial<CircuitSpec> = {}): CircuitSpec => ({
  id: 'c2',
  name: 'C2',
  cable: null,
  x_m: 0,
  depth_m: 2,
  formation: 'trefoil',
  touching: true,
  spacing_mm: 100,
  transposed: false,
  bonding: 'both',
  crossBondLambda1: null,
  load: 'rated',
  current_A: 0,
  conduit: 'k',
  ...patch,
});
const acosh = (u: number) => Math.log(u + Math.sqrt(u * u - 1));

describe('three-core cables without metallic screen', () => {
  it('T1 of sector-shaped conductors follows IEC 60287-2-1 4.1.2.2.6', () => {
    const r = calculateRating(NA2XY3, { ...base, type: 'direct' });
    expect(r.ok).toBe(true);
    const g = deriveGeometry(NA2XY3).geometry;
    const tc = g.threeCore!;
    expect(tc.t).toBeCloseTo(3.4, 9);
    // r1 from πr²/3 − t·r = π·dx²/4
    expect((Math.PI * tc.r1 ** 2) / 3 - tc.t * tc.r1).toBeCloseTo((Math.PI * 18.2 ** 2) / 4, 6);
    const F2 = 1 + (3 * tc.t) / (2 * Math.PI * (18.2 + tc.t) - tc.t);
    const G = 3 * F2 * Math.log(tc.da / (2 * tc.r1));
    expect(r.thermal.T1).toBeCloseTo((3.5 / (2 * Math.PI)) * G, 9);
    expect(r.thermal.T3).toBeCloseTo((5 / (2 * Math.PI)) * Math.log(1 + (2 * 2.5) / tc.da), 9);
    expect(r.sheath.lambda1).toBe(0);
  });

  it('rating equals the IEC equation with n = 3 and the T4 of one cable', () => {
    const r = calculateRating(NA2XY3, { ...base, type: 'direct' });
    const De = r.geometry.De;
    const T4 = (1 / (2 * Math.PI)) * acosh((2 * 2000) / De);
    expect(r.thermal.t4.T4).toBeCloseTo(T4, 9);
    const R = r.conductor.R;
    const I = Math.sqrt(70 / (R * r.thermal.T1 + 3 * R * (r.thermal.T3 + T4)));
    expect(r.I).toBeCloseTo(I, 6);
    // proximity effect of sector conductors: two-thirds of the round-conductor value
    expect(r.conductor.yp).toBeGreaterThan(0);
  });

  it('a cable alone in a conduit is rated like a cable in its own duct', () => {
    const duct = { material: 'PE' as const, innerD_mm: 141, outerD_mm: 160, rho: null, U: null, V: null, Y: null };
    const own = calculateRating(NA2XY3, { ...base, type: 'ducts', duct });
    const inConduit = calculateRating(NA2XY3, { ...base, type: 'direct', conduits: [K], mainConduit: 'k' });
    expect(own.ok && inConduit.ok).toBe(true);
    expect(inConduit.I).toBeCloseTo(own.I, 6);
  });
});

describe('several circuits in one conduit', () => {
  const two: InstallationSpec = { ...base, type: 'direct', conduits: [K], mainConduit: 'k', circuits: [other()], ratingMode: 'equal-current' };

  it('two cables share the conduit: group diameter 1.65·De and the heat of both', () => {
    const r = calculateRating(NA2XY3, two);
    expect(r.ok).toBe(true);
    const c = r.system!.circuits;
    expect(c[0].I).toBeCloseTo(c[1].I, 6);
    // Hand calculation of the conductor temperature at the rating (IEC 60287-2-1 4.2.7)
    const I = r.I;
    const Wc = I * I * r.conductor.R;
    const Q = 6 * Wc;
    const De = r.geometry.De;
    const Deq = 1.65 * De;
    const T4w = (3.5 / (2 * Math.PI)) * Math.log(160 / 141);
    const T4g = (1 / (2 * Math.PI)) * acosh((2 * 2000) / 160);
    let T4a = 0.5;
    let thetaM = 50;
    for (let k = 0; k < 200; k++) {
      T4a = thermal.ductAirT4(1.87, 0.312, 0.0037, thetaM, Deq);
      thetaM = 20 + Q * (T4w + T4g) + 0.5 * Q * T4a;
    }
    const thetaC = 20 + Wc * r.thermal.T1 + 3 * Wc * r.thermal.T3 + Q * (T4a + T4w + T4g);
    expect(thetaC).toBeCloseTo(90, 2);
    expect(r.thermal.t4.T4p).toBeCloseTo(T4a, 4);
  });

  it('is cooler with one cable per conduit, and hotter than one cable alone', () => {
    const shared = calculateRating(NA2XY3, two).I;
    const alone = calculateRating(NA2XY3, { ...base, type: 'direct', conduits: [K], mainConduit: 'k' }).I;
    const K2: ConduitSpec = { ...K, id: 'k2', x_m: 0.3 };
    const apart = calculateRating(NA2XY3, { ...two, conduits: [K, K2], circuits: [other({ conduit: 'k2', x_m: 0.3 })] }).I;
    expect(shared).toBeLessThan(apart);
    expect(apart).toBeLessThan(alone);
  });

  it('checks a load with the other circuit fixed', () => {
    const fixed = { ...two, ratingMode: 'own-limit' as const, circuits: [other({ load: 'fixed', current_A: 254 })] };
    const t = calculateTemperature(NA2XY3, fixed, 254);
    expect(t.ok).toBe(true);
    const r = calculateRating(NA2XY3, fixed);
    expect(t.conductor > 90).toBe(254 > r.I);
  });

  it('draws the cables inside the conduit', () => {
    const lay = layoutCircuits(NA2XY3, two);
    expect(lay).toHaveLength(2);
    lay.forEach((c) => {
      expect(c.cablePositions).toHaveLength(1);
      const p = c.cablePositions[0];
      expect(Math.hypot(p.x, p.y - 2000) + c.De / 2).toBeLessThanOrEqual(141 / 2 + 1e-6);
    });
    expect(Math.hypot(lay[0].cablePositions[0].x - lay[1].cablePositions[0].x, 0)).toBeCloseTo(lay[0].De, 3);
  });

  it('six single-core cables are extrapolated beyond the IEC table, with a warning', () => {
    const r = calculateRating(NA2XY1, { ...two, ratingMode: 'own-limit' });
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes('up to four cables'))).toBe(true);
  });

  it('the numerical model agrees with IEC for the conduit template', () => {
    const inst = TRENCH_TEMPLATES.find((t) => t.id === 'lv-conduit')!.apply({ ...DEFAULT_INSTALLATION });
    const iec = calculateRating(NA2XY3, inst);
    const num = numericRating(NA2XY3, inst, iec)!;
    expect(iec.ok && num.result.ok).toBe(true);
    expect(Math.abs(num.result.I - iec.I) / iec.I).toBeLessThan(0.03);
  });
});

describe('single-core cable without metallic screen', () => {
  it('has no screen losses and rates above the same cable with a bonded screen', () => {
    const r = calculateRating(NA2XY1, { ...DEFAULT_INSTALLATION });
    expect(r.ok).toBe(true);
    expect(r.sheath.lambda1).toBe(0);
    const screened: CableSpec = {
      ...NA2XY1,
      screen: { ...NA2XY1.screen, form: 'wires', material: 'Cu', thickness_mm: 0.8, area_mm2: 25 },
    };
    expect(calculateRating(screened, { ...DEFAULT_INSTALLATION }).I).toBeLessThan(r.I);
  });
});
