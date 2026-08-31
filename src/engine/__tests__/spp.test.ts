import { describe, it, expect } from 'vitest';
import {
  combineTraverseModels,
  equivalentUniformResistivity,
  fitTwoLayer,
  twoLayerApparentResistivity,
  wennerApparentResistivity,
} from '../soil';
import { tolerableVoltages } from '../safety';
import { blockEquivalentRod, rodBedResistance, rodResistance, solveRodLengthForResistance } from '../auxiliary';
import { conductorVoltageDrop } from '../conductor';
import { defaultStudy, makeRegion } from '../defaults';
import { runStudy } from '../study';

describe('Wenner traverse interpretation (IEEE Std 81)', () => {
  it('converts measured resistance to apparent resistivity as 2·π·a·R', () => {
    expect(wennerApparentResistivity(3, 5.305)).toBeCloseTo(100, 0);
  });

  it('reduces to the top-layer resistivity at very small spacing', () => {
    expect(twoLayerApparentResistivity(0.01, 50, 500, 3)).toBeCloseTo(50, 0);
  });

  it('approaches the bottom-layer resistivity at very large spacing', () => {
    const deep = twoLayerApparentResistivity(2000, 50, 500, 3);
    expect(deep).toBeGreaterThan(400);
  });

  it('recovers a known two-layer model from synthetic traverse data', () => {
    const rho1 = 80;
    const rho2 = 400;
    const h = 2.5;
    const spacings = [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];
    const points = spacings.map((a) => ({
      spacing: a,
      resistance: twoLayerApparentResistivity(a, rho1, rho2, h) / (2 * Math.PI * a),
    }));

    const fit = fitTwoLayer(points);
    expect(fit).not.toBeNull();
    expect(fit!.rho1).toBeCloseTo(rho1, -0.5);
    expect(fit!.rho2).toBeGreaterThan(300);
    expect(fit!.rho2).toBeLessThan(520);
    expect(fit!.h).toBeGreaterThan(2.0);
    expect(fit!.h).toBeLessThan(3.1);
    expect(fit!.rmsError).toBeLessThan(0.02);
  });

  it('returns null when there are too few points to constrain three parameters', () => {
    expect(fitTwoLayer([{ spacing: 1, resistance: 10 }])).toBeNull();
  });
});

describe('IEEE Std 2778-2020, 5.1.2 — combining short and long traverses', () => {
  it('reproduces the Table 1 sample soil model', () => {
    // Table 1: short traverse gives 50 Ω·m for 2 m over 120 Ω·m; the nearby long traverse gives a
    // 65 Ω·m bottom layer beginning at a cumulative depth of 35 m.
    const combined = combineTraverseModels(
      { rho1: 50, rho2: 120, h: 2 },
      { rho1: 30, rho2: 65, h: 35 },
    );

    expect(combined).toHaveLength(3);
    expect(combined[0].rho).toBe(50);
    expect(combined[0].thickness).toBe(2);
    expect(combined[1].rho).toBe(120);
    expect(combined[1].thickness).toBeCloseTo(33, 6);
    expect(combined[2].rho).toBe(65);
    // The upper layers come from the short traverse, the bottom from the long one.
    const cumulative = combined[0].thickness + combined[1].thickness;
    expect(cumulative).toBeCloseTo(35, 6);
  });
});

describe('Equivalent uniform resistivity', () => {
  const soil = [
    { rho: 50, thickness: 2 },
    { rho: 120, thickness: 33 },
    { rho: 65, thickness: 0 },
  ];

  it('sits between the extreme layer resistivities for every method', () => {
    for (const method of ['apparent', 'arithmetic', 'harmonic'] as const) {
      const r = equivalentUniformResistivity(soil, 30, method);
      expect(r).toBeGreaterThan(49);
      expect(r).toBeLessThan(121);
    }
  });

  it('tends to the top layer at shallow depth of investigation', () => {
    expect(equivalentUniformResistivity(soil, 0.5, 'arithmetic')).toBeCloseTo(50, 0);
  });

  it('weights toward the deeper layers as the depth of investigation grows', () => {
    const shallow = equivalentUniformResistivity(soil, 3, 'arithmetic');
    const deep = equivalentUniformResistivity(soil, 30, 'arithmetic');
    expect(deep).toBeGreaterThan(shallow);
  });

  it('passes a single-layer model straight through', () => {
    expect(equivalentUniformResistivity([{ rho: 200, thickness: 0 }], 20)).toBe(200);
  });
});

describe('IEEE Std 2778-2020, 5.4.4 — footwear and glove credit', () => {
  const base = {
    weight: 70 as const,
    shockDuration: 0.5,
    rhoSoil: 100,
    rhoSurface: 0,
    surfaceThickness: 0,
  };

  it('raises both limits when footwear resistance is credited', () => {
    const bare = tolerableVoltages(base);
    const shod = tolerableVoltages({ ...base, footwearResistance: 2000 });
    expect(shod.stepLimit).toBeGreaterThan(bare.stepLimit);
    expect(shod.touchLimit).toBeGreaterThan(bare.touchLimit);
    // Footwear appears in series in each foot path: step gains 2·Rshoe·IB, touch gains Rshoe/2·IB.
    const ib = bare.bodyCurrent;
    expect(shod.stepLimit - bare.stepLimit).toBeCloseTo(2 * 2000 * ib, 3);
    expect(shod.touchLimit - bare.touchLimit).toBeCloseTo((2000 / 2) * ib, 3);
  });

  it('always reports the un-credited limits alongside for comparison', () => {
    const shod = tolerableVoltages({ ...base, footwearResistance: 2000, gloveResistance: 10_000 });
    expect(shod.stepLimitBare).toBeLessThan(shod.stepLimit);
    expect(shod.touchLimitBare).toBeLessThan(shod.touchLimit);
  });

  it('applies glove resistance to touch only, in series with the body', () => {
    const bare = tolerableVoltages(base);
    const gloved = tolerableVoltages({ ...base, gloveResistance: 5000 });
    expect(gloved.stepLimit).toBeCloseTo(bare.stepLimit, 6);
    expect(gloved.touchLimit - bare.touchLimit).toBeCloseTo(5000 * bare.bodyCurrent, 3);
  });

  it('withholds the credit outside the plant fence', () => {
    const study = defaultStudy();
    study.footwearResistance = 2000;
    study.regions = [
      makeRegion('inside', { insidePlant: true }),
      makeRegion('outside', { insidePlant: false }),
    ];
    const result = runStudy(study);
    const inside = result.regions.find((r) => r.regionName === 'inside')!;
    const outside = result.regions.find((r) => r.regionName === 'outside')!;
    expect(inside.tolerance.touchLimit).toBeGreaterThan(outside.tolerance.touchLimit);
    expect(outside.tolerance.touchLimit).toBeCloseTo(outside.tolerance.touchLimitBare, 6);
    expect(outside.warnings.some((w) => w.includes('5.4.4'))).toBe(true);
  });
});

describe('IEEE Std 2778-2020, 4.3 & 5.4.2 — auxiliary array grounding', () => {
  it('gives a plausible single-rod resistance (≈ ρ/3 for a 3 m rod)', () => {
    const r = rodResistance(100, 3, 0.016);
    expect(r).toBeGreaterThan(28);
    expect(r).toBeLessThan(38);
  });

  it('scales inversely with soil resistivity', () => {
    expect(rodResistance(200, 3, 0.016)).toBeCloseTo(2 * rodResistance(100, 3, 0.016), 6);
  });

  it('a rod bed never reaches the ideal 1/n resistance, because of mutual coupling', () => {
    const single = rodResistance(100, 3, 0.016);
    const bed = rodBedResistance(100, 16, 3, 0.016, 5);
    expect(bed).toBeGreaterThan(single / 16);
    expect(bed).toBeLessThan(single);
  });

  it('mutual coupling weakens as the posts are spread further apart', () => {
    const tight = rodBedResistance(100, 16, 3, 0.016, 2);
    const loose = rodBedResistance(100, 16, 3, 0.016, 20);
    expect(loose).toBeLessThan(tight);
  });

  it('inverts the rod resistance formula consistently', () => {
    const target = rodResistance(150, 7.3, 0.02);
    expect(solveRodLengthForResistance(150, target, 0.02)).toBeCloseTo(7.3, 2);
  });

  it('reduces a block of posts to an equivalent rod much longer than one post', () => {
    const block = blockEquivalentRod(100, 400, 2, 0.1, 5, 1);
    expect(block.effectiveCount).toBe(400);
    expect(block.assemblyResistance).toBeLessThan(rodResistance(100, 2, 0.1));
    expect(block.equivalentRodLength).toBeGreaterThan(2);
    // The coupling factor quantifies how far the bed falls short of n independent rods.
    expect(block.couplingFactor).toBeGreaterThan(1);
  });

  it('derates posts that are not in solid contact with native soil', () => {
    const full = blockEquivalentRod(100, 400, 2, 0.1, 5, 1.0);
    const coated = blockEquivalentRod(100, 400, 2, 0.1, 5, 0.25);
    expect(coated.effectiveCount).toBe(100);
    expect(coated.assemblyResistance).toBeGreaterThan(full.assemblyResistance);
  });

  it('contributes nothing when no post is in contact with the soil', () => {
    const none = blockEquivalentRod(100, 400, 2, 0.1, 5, 0);
    expect(none.effectiveCount).toBe(0);
    expect(none.assemblyResistance).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('IEEE Std 2778-2020, 5.4.1 — longitudinal conductor drop', () => {
  it('computes the dc resistance of a copper run', () => {
    // 2/0 AWG copper (67.4 mm²) at 1000 m: ρ·L/A = 1.72e-8 × 1000 / 67.4e-6 ≈ 0.255 Ω.
    const d = conductorVoltageDrop(1000, 1000, 67.4, 'cu-annealed');
    expect(d.resistance).toBeCloseTo(0.255, 2);
    expect(d.drop).toBeCloseTo(255, 0);
  });

  it('shows steel array frames dropping far more voltage than copper', () => {
    const copper = conductorVoltageDrop(1000, 200, 67.4, 'cu-annealed');
    const steel = conductorVoltageDrop(1000, 200, 67.4, 'steel-1020');
    expect(steel.drop / copper.drop).toBeGreaterThan(5);
  });

  it('scales linearly with run length', () => {
    const short = conductorVoltageDrop(1000, 100, 67.4, 'cu-annealed');
    const long = conductorVoltageDrop(1000, 400, 67.4, 'cu-annealed');
    expect(long.drop / short.drop).toBeCloseTo(4, 6);
  });

  it('sends only part of the grid current down the run, not all of it', () => {
    const r = runStudy(defaultStudy()).regions[0];
    expect(r.auxRunFraction).toBeGreaterThan(0);
    expect(r.auxRunFraction).toBeLessThan(1);
    expect(r.auxRunCurrent).toBeCloseTo(r.current.maxGridCurrent * r.auxRunFraction, 6);
    // Irun = IG · Rlocal / (Rlocal + Rrun + Rrest)
    const expected =
      r.localElectrodeResistance / (r.localElectrodeResistance + r.auxDropResistance + r.groundResistance);
    expect(r.auxRunFraction).toBeCloseTo(expected, 9);
  });

  it('drives more current down the run as the local electrode gets worse', () => {
    const base = defaultStudy();
    const good = runStudy({ ...base, auxiliary: { ...base.auxiliary, postCount: 800 } }).regions[0];
    const poor = runStudy({ ...base, auxiliary: { ...base.auxiliary, postCount: 20 } }).regions[0];
    expect(poor.auxRunFraction).toBeGreaterThan(good.auxRunFraction);
  });

  it('halves the run resistance when the tie is a loop rather than a single path', () => {
    const base = defaultStudy();
    const single = runStudy({ ...base, regions: [makeRegion('r', { auxRunPaths: 1 })] }).regions[0];
    const loop = runStudy({ ...base, regions: [makeRegion('r', { auxRunPaths: 2 })] }).regions[0];
    expect(loop.auxDropResistance).toBeCloseTo(single.auxDropResistance / 2, 9);
    expect(loop.auxDrop).toBeLessThan(single.auxDrop);
  });

  it('adds no drop at all when the analysis point sits at the grid tie', () => {
    const base = defaultStudy();
    const at = runStudy({ ...base, regions: [makeRegion('r', { auxRunLength: 0 })] }).regions[0];
    expect(at.auxDrop).toBeCloseTo(0, 9);
    expect(at.touchWithDrop).toBeCloseTo(at.meshVoltage, 9);
  });
});

describe('Full study', () => {
  it('produces finite, ordered results for the default SPP', () => {
    const result = runStudy(defaultStudy());
    expect(result.regions).toHaveLength(3);
    for (const r of result.regions) {
      expect(Number.isFinite(r.gpr)).toBe(true);
      expect(Number.isFinite(r.meshVoltage)).toBe(true);
      expect(Number.isFinite(r.stepVoltage)).toBe(true);
      expect(r.groundResistance).toBeGreaterThan(0);
      expect(r.touchWithDrop).toBeGreaterThanOrEqual(r.meshVoltage);
    }
    expect(['pass', 'marginal', 'fail']).toContain(result.overall);
    expect(result.governingRegionId).not.toBeNull();
  });

  it('identifies the region with the smallest margin as governing', () => {
    const study = defaultStudy();
    const result = runStudy(study);
    const margins = result.regions.map((r) =>
      Math.min(r.touchCheck.margin, r.stepCheck.margin, r.touchWithDropCheck.margin),
    );
    const worstIndex = margins.indexOf(Math.min(...margins));
    expect(result.governingRegionId).toBe(result.regions[worstIndex].regionId);
  });

  it('raises higher voltages when the fault current is raised', () => {
    const low = runStudy({ ...defaultStudy(), regions: [makeRegion('r', { faultCurrent: 5000 })] });
    const high = runStudy({ ...defaultStudy(), regions: [makeRegion('r', { faultCurrent: 15_000 })] });
    expect(high.regions[0].meshVoltage).toBeGreaterThan(low.regions[0].meshVoltage);
    expect(high.regions[0].gpr).toBeGreaterThan(low.regions[0].gpr);
  });

  it('lowers the ground resistance when auxiliary array grounding is credited', () => {
    const base = defaultStudy();
    const without = runStudy({ ...base, auxiliary: { ...base.auxiliary, enabled: false } });
    const with_ = runStudy(base);
    expect(with_.regions[0].groundResistance).toBeLessThan(without.regions[0].groundResistance);
    expect(with_.regions[0].gridOnlyResistance).toBeCloseTo(without.regions[0].groundResistance, 6);
  });

  it('warns when the grid conductor is thermally undersized', () => {
    const study = defaultStudy();
    study.grid.conductorAreaMm2 = 8.37; // 8 AWG
    study.regions = [makeRegion('r', { faultCurrent: 20_000 })];
    const result = runStudy(study);
    expect(result.warnings.some((w) => w.includes('below the'))).toBe(true);
  });

  it('warns that closed-form equations are out of range at SPP grid spacing', () => {
    const result = runStudy(defaultStudy());
    expect(result.regions[0].warnings.some((w) => w.includes('5.4.1'))).toBe(true);
  });

  it('applies the 50 kg no-footwear criterion at the fence', () => {
    const study = defaultStudy();
    study.footwearResistance = 2000;
    const result = runStudy(study);
    expect(result.fence).not.toBeNull();
    expect(result.fence!.tolerance.touchLimit).toBeCloseTo(result.fence!.tolerance.touchLimitBare, 6);
  });

  it('transfers more voltage onto a bonded fence than an isolated one', () => {
    const base = defaultStudy();
    const bonded = runStudy({ ...base, fence: { ...base.fence, bonded: true } });
    const isolated = runStudy({ ...base, fence: { ...base.fence, bonded: false } });
    expect(bonded.fence!.touchVoltage).toBeGreaterThan(isolated.fence!.touchVoltage);
  });
});
