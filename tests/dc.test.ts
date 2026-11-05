import { describe, expect, it } from 'vitest';
import { calculateRating, calculateTemperature, deriveGeometry } from '../src/engine';
import { DEFAULT_INSTALLATION, TECSUN_SIZES, tecsunCable } from '../src/engine/presets';
import type { CircuitSpec, InstallationSpec } from '../src/engine/types';

const acosh = (u: number) => Math.log(u + Math.sqrt(u * u - 1));

describe('DC circuits (IEC 60287-1-1 1.4.1.2)', () => {
  const cable = tecsunCable(240);
  const inst: InstallationSpec = { ...DEFAULT_INSTALLATION, type: 'direct', depth_m: 0.7 };

  it('TECSUN sizes use the datasheet diameters and resistances', () => {
    TECSUN_SIZES.forEach((s) => {
      const g = deriveGeometry(tecsunCable(s.area)).geometry;
      expect(g.De).toBeCloseTo((s.odMin + s.odMax) / 2, 6);
      expect(g.dc).toBe(s.dc);
      expect(Math.abs(g.DeBuilt - g.De)).toBeLessThan(0.3);
    });
  });

  it('a touching pair matches the DC rating equation with T4 by superposition', () => {
    const r = calculateRating(cable, inst);
    expect(r.ok).toBe(true);
    expect(r.positions).toHaveLength(2);
    // no skin, proximity, dielectric or screen losses
    expect(r.conductor.R).toBeCloseTo(0.082e-3 * (1 + 0.00393 * 70), 9);
    expect(r.conductor.ys + r.conductor.yp).toBe(0);
    expect(r.dielectric.Wd).toBe(0);
    expect(r.sheath.lambda1).toBe(0);
    const De = r.geometry.De;
    const L = 700;
    const T4 = (1 / (2 * Math.PI)) * (acosh((2 * L) / De) + Math.log(Math.hypot(De, 2 * L) / De));
    expect(r.thermal.t4.T4).toBeCloseTo(T4, 9);
    const I = Math.sqrt(70 / (r.conductor.R * (r.thermal.T1 + r.thermal.T3 + T4)));
    expect(r.I).toBeCloseTo(I, 6);
    const t = calculateTemperature(cable, inst, r.I);
    expect(t.conductor).toBeCloseTo(90, 4);
  });

  it('many string pairs close together: every circuit at its limit, or one current with the hottest at 90 °C', () => {
    const cab6 = tecsunCable(6);
    const circuits: CircuitSpec[] = Array.from({ length: 19 }, (_, i) => ({
      id: `s${i}`,
      name: `S${i + 2}`,
      cable: null,
      x_m: 0.05 * (i + 1),
      depth_m: 0.7,
      formation: 'flat',
      touching: true,
      spacing_mm: 100,
      transposed: false,
      bonding: 'both',
      crossBondLambda1: null,
      load: 'rated',
      current_A: 0,
    }));
    const own = calculateRating(cab6, { ...inst, circuits, ratingMode: 'own-limit' });
    expect(own.ok).toBe(true);
    own.system!.circuits.forEach((c) => expect(c.hottestTemp).toBeCloseTo(90, 4));
    const eq = calculateRating(cab6, { ...inst, circuits, ratingMode: 'equal-current' });
    expect(eq.ok).toBe(true);
    const temps = eq.system!.circuits.map((c) => c.hottestTemp);
    expect(Math.max(...temps)).toBeCloseTo(90, 4);
    eq.system!.circuits.forEach((c) => expect(c.I).toBeCloseTo(eq.I, 6));
    // a single pair alone carries more
    expect(calculateRating(cab6, inst).I).toBeGreaterThan(Math.max(...own.system!.circuits.map((c) => c.I)));
  });

  it('pairs one above the other and AC circuits can share a trench', () => {
    const stacked = calculateRating(cable, { ...inst, rotated: true });
    expect(stacked.ok).toBe(true);
    expect(stacked.positions[0].x).toBeCloseTo(stacked.positions[1].x, 9);
    const ac = DEFAULT_INSTALLATION;
    const mixed = calculateRating(cable, {
      ...inst,
      circuits: [
        {
          id: 'ac',
          name: 'AC',
          cable: { ...cable, system: 'ac' },
          x_m: 0.5,
          depth_m: 0.7,
          formation: 'trefoil',
          touching: true,
          spacing_mm: 100,
          transposed: false,
          bonding: ac.bonding,
          crossBondLambda1: null,
          load: 'fixed',
          current_A: 300,
        },
      ],
    });
    expect(mixed.ok).toBe(true);
    expect(mixed.system!.circuits[1].positions).toHaveLength(3);
    expect(mixed.I).toBeLessThan(calculateRating(cable, inst).I);
  });
});
