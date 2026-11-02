import { describe, expect, it } from 'vitest';
import {
  calculateRating,
  calculateTemperature,
  circleShape,
  exactInfluence,
  layoutCircuits,
  layoutFromInstallation,
  migrateTrench,
  numericOptions,
  numericRating,
  polygonShape,
  rectShape,
  solveNumeric,
  TRENCH_TEMPLATES,
  trenchToIec,
} from '../src/engine';
import type { InstallationSpec } from '../src/engine/types';
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
        const t2 = calculateTemperature(cable, inst, num.result.I, numericOptions(inst, num.numeric));
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
    const trench = base.trench!.shapes[0];
    const worseShape = { ...trench, bands: trench.bands!.map((z) => (z.material === 'cbs' ? { ...z, rho: 2.0 } : z)) };
    const worse = { ...base, trench: { ...base.trench!, shapes: [worseShape] } };
    const a = calculateRating(HV, base);
    const b = calculateRating(HV, worse);
    expect(b.I).toBeLessThan(a.I);
    expect(numericRating(HV, worse, b)!.result.I).toBeLessThan(numericRating(HV, base, a)!.result.I);
  });
});

describe('flexible cross-section', () => {
  const base = (): InstallationSpec => TRENCH_TEMPLATES[0].apply({ ...DEFAULT_INSTALLATION });

  it('opens an installation in the editor without changing its rating', () => {
    for (const type of ['direct', 'ducts', 'ductbank'] as const) {
      const inst: InstallationSpec = { ...DEFAULT_INSTALLATION, type, circuits: [] };
      const before = calculateRating(MV, inst);
      const after = calculateRating(MV, { ...inst, type: 'trench', trench: layoutFromInstallation(inst) });
      expect(before.ok && after.ok).toBe(true);
      expect(Math.abs(after.I - before.I) / before.I).toBeLessThan(type === 'ductbank' ? 0.01 : 1e-9);
    }
  });

  it('places every circuit for drawing even when the rating fails', () => {
    const inst = base();
    const rated = calculateRating(MV, inst);
    expect(rated.ok).toBe(true);
    const layout = layoutCircuits(MV, inst);
    expect(layout.map((c) => c.name)).toEqual(rated.system!.circuits.map((c) => c.name.replace(' (main)', '')));
    layout.forEach((c, i) =>
      c.positions.forEach((p, k) => {
        expect(p.x).toBeCloseTo(rated.system!.circuits[i].positions[k].x, 6);
        expect(p.y).toBeCloseTo(rated.system!.circuits[i].positions[k].y, 6);
      }),
    );
    // Move C2 onto C1: no rating, but the layout is still available
    const clash = { ...inst, circuits: inst.circuits.map((c, i) => (i === 0 ? { ...c, x_m: inst.mainX_m ?? 0, depth_m: inst.depth_m } : c)) };
    expect(calculateRating(MV, clash).ok).toBe(false);
    const drawn = layoutCircuits(MV, clash);
    expect(drawn).toHaveLength(layout.length);
    expect(drawn[1].positions[1].x).toBeCloseTo(drawn[0].positions[1].x, 6);
  });

  it('converts a project saved with the older single-trench format', () => {
    const old = {
      present: true,
      centreX_m: 0,
      depth_m: 1.0,
      bottomWidth_m: 0.8,
      topWidth_m: 0.8,
      surface: 'grass',
      ducted: false,
      layers: base().trench!.layers,
      zones: [{ id: 'z', name: 'Sand bedding', material: 'sand', rho: 1, top_m: 0.6, bottom_m: 1.0 }],
      slabs: [],
    };
    const t = migrateTrench(old);
    expect(t.shapes).toHaveLength(1);
    expect(t.shapes[0].kind).toBe('trench');
    expect(t.shapes[0].bands?.[0].name).toBe('Sand bedding');
    const inst = { ...base(), circuits: [], trench: t };
    expect(trenchToIec(inst).iec.backfill?.rho).toBe(1);
  });

  it('maps rectangles, circles and polygons around the cables to an IEC backfill rectangle', () => {
    const inst = { ...base(), circuits: [], mainX_m: 0 };
    const withShape = (sh: ReturnType<typeof rectShape>) => ({ ...inst, trench: { ...inst.trench!, shapes: [...inst.trench!.shapes, sh] } });
    const rect = trenchToIec(withShape(rectShape('Box', 'cbs', 0, 0.6, 0.5, 0.5))).iec.backfill!;
    expect(rect.width_m).toBeCloseTo(0.5, 9);
    expect(rect.centreDepth_m).toBeCloseTo(0.85, 9);
    const circ = trenchToIec(withShape(circleShape('Bore', 'bentonite', 0, 0.85, 0.5))).iec.backfill!;
    expect(circ.width_m).toBeCloseTo(0.25 / 0.5498, 6);
    const poly = trenchToIec(
      withShape(polygonShape('Fill', 'cbs', [[-0.3, 0.6], [0.3, 0.6], [0.4, 1.1], [-0.4, 1.1]])),
    ).iec.backfill!;
    expect(poly.width_m).toBeCloseTo(0.8, 9);
    expect(poly.height_m).toBeCloseTo(0.5, 9);
  });

  it('lays rotated formations out vertically or point-down', () => {
    const flat = { ...DEFAULT_INSTALLATION, formation: 'flat' as const, touching: false, spacing_mm: 200, depth_m: 1.2 };
    const v = calculateRating(MV, { ...flat, rotated: true });
    expect(new Set(v.positions.map((p) => p.x)).size).toBe(1);
    const tref = calculateRating(MV, { ...DEFAULT_INSTALLATION, rotated: true });
    expect(tref.positions[1].y).toBeGreaterThan(tref.positions[0].y); // apex at the bottom
    expect(Math.abs(tref.I / calculateRating(MV, DEFAULT_INSTALLATION).I - 1)).toBeLessThan(0.05);
  });

  it('lets each circuit be direct or in its own ducts', () => {
    const inst = base();
    inst.circuits = inst.circuits.map((c) => ({ ...c, ducted: true, duct: { material: 'PE' as const, innerD_mm: 100, outerD_mm: 110 }, x_m: 0.45 }));
    const r = calculateRating(MV, inst);
    expect(r.ok).toBe(true);
    expect(r.system!.circuits[0].ductD).toBeUndefined();
    expect(r.system!.circuits[1].ductD).toBe(110);
  });

  it('takes the rise from a heat source off the permissible rise (IEC superposition)', () => {
    const src = { id: 'h', name: 'Pipe', x_m: 0.8, depth_m: 0.8, diameter_mm: 200, W: 40 };
    const plain = calculateRating(MV, DEFAULT_INSTALLATION);
    const zero = calculateRating(MV, { ...DEFAULT_INSTALLATION, fromLayout: true, heatSources: [{ ...src, W: 0 }] });
    expect(zero.I).toBeCloseTo(plain.I, 6);
    // outside a cross-section layout, heat sources are ignored
    expect(calculateRating(MV, { ...DEFAULT_INSTALLATION, heatSources: [src] }).I).toBeCloseTo(plain.I, 9);
    const r = calculateRating(MV, { ...DEFAULT_INSTALLATION, fromLayout: true, heatSources: [src] });
    expect(r.I).toBeLessThan(plain.I);
    // closed form with the rise at the most heated cable (trefoil touching: same T4 for all three)
    const rho = DEFAULT_INSTALLATION.soilRho;
    const B = Math.max(
      ...r.positions.map((p) => (rho / (2 * Math.PI)) * 40 * Math.log(Math.hypot(p.x - 800, p.y + 800) / Math.hypot(p.x - 800, p.y - 800))),
    );
    const R = r.conductor.R;
    const l1 = r.sheath.lambda1;
    const I = Math.sqrt((70 - B) / (R * r.thermal.T1 + R * (1 + l1) * (r.thermal.T3 + r.thermal.t4.T4)));
    expect(r.I).toBeCloseTo(I, 4);
  });

  it('includes heat sources in the numerical model', () => {
    const inst = TRENCH_TEMPLATES.find((t) => t.id === 'district-heating')!.apply({ ...DEFAULT_INSTALLATION });
    const iec = calculateRating(MV, inst);
    expect(iec.ok).toBe(true);
    const num = numericRating(MV, inst, iec)!;
    expect(num.result.ok).toBe(true);
    expect(Math.abs(num.result.I / iec.I - 1)).toBeLessThan(0.06);
    const t = calculateTemperature(MV, inst, num.result.I, numericOptions(inst, num.numeric));
    expect(t.conductor).toBeCloseTo(90, 4);
    const cold = { ...inst, heatSources: inst.heatSources!.map((h) => ({ ...h, W: 0 })) };
    expect(numericRating(MV, cold, calculateRating(MV, cold))!.result.I).toBeGreaterThan(num.result.I);
  });
});
