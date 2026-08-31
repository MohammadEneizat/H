import type { Region, StudyInput } from './types';
import { equivalentUniformResistivity, topLayerResistivity } from './soil';
import { tolerableVoltages, type ToleranceResult } from './safety';
import { gridCurrent, type GridCurrentResult } from './fault';
import {
  geometricFactors,
  gridGeometry,
  meshVoltage,
  schwarzResistance,
  stepVoltage,
  sverakResistance,
  type GeometricFactors,
  type GridGeometry,
} from './grid';
import { blockEquivalentRod, combineWithAuxiliary, type RodBedResult } from './auxiliary';
import { conductorVoltageDrop, sizeConductor, type SizingResult } from './conductor';

export type Verdict = 'pass' | 'marginal' | 'fail';

export interface Check {
  label: string;
  /** Computed value, V. */
  value: number;
  /** Tolerable limit, V. */
  limit: number;
  /** limit / value. Above 1 is compliant. */
  margin: number;
  verdict: Verdict;
  reference: string;
}

function verdictFor(value: number, limit: number): Verdict {
  if (!Number.isFinite(value) || !Number.isFinite(limit) || limit <= 0) return 'fail';
  const margin = limit / value;
  if (margin >= 1.1) return 'pass';
  if (margin >= 1.0) return 'marginal';
  return 'fail';
}

function makeCheck(label: string, value: number, limit: number, reference: string): Check {
  return { label, value, limit, margin: limit > 0 ? limit / value : 0, verdict: verdictFor(value, limit), reference };
}

export interface RegionResult {
  regionId: string;
  regionName: string;
  /** Equivalent uniform resistivity used in the closed-form equations, Ω·m. */
  rhoEquivalent: number;
  /** Top-layer resistivity — the soil in contact with a person's feet, Ω·m. */
  rhoSurfaceSoil: number;
  tolerance: ToleranceResult;
  current: GridCurrentResult;
  /** Ground resistance used, Ω. */
  groundResistance: number;
  /** Ground resistance of the main grid alone, before any auxiliary credit, Ω. */
  gridOnlyResistance: number;
  /** Ground potential rise, V. */
  gpr: number;
  meshVoltage: number;
  stepVoltage: number;
  touchCheck: Check;
  stepCheck: Check;
  /** Longitudinal I·R drop along the auxiliary run back to the main grid, V. */
  auxDrop: number;
  auxDropResistance: number;
  /** Portion of the grid current that actually takes that run, A. */
  auxRunCurrent: number;
  /** That portion as a fraction of IG. */
  auxRunFraction: number;
  /** Resistance to remote earth of the local electrode at the point of fault, Ω. */
  localElectrodeResistance: number;
  /** Touch voltage including the auxiliary run drop, V. */
  touchWithDrop: number;
  touchWithDropCheck: Check;
  warnings: string[];
}

export interface FenceResult {
  /** Touch voltage assumed at the fence, V. */
  touchVoltage: number;
  limit: number;
  margin: number;
  verdict: Verdict;
  tolerance: ToleranceResult;
  note: string;
}

export interface StudyResult {
  geometry: GridGeometry;
  factors: GeometricFactors;
  /** Auxiliary post network reduced to an equivalent rod, using the worst region's soil. */
  auxiliary: RodBedResult | null;
  sizing: SizingResult;
  /** Minimum conductor area across all regions' fault duties, mm². */
  sizingGoverningCurrent: number;
  regions: RegionResult[];
  fence: FenceResult | null;
  /** Worst verdict across every check. */
  overall: Verdict;
  /** Region that governs the design. */
  governingRegionId: string | null;
  warnings: string[];
}

function worstVerdict(list: Verdict[]): Verdict {
  if (list.includes('fail')) return 'fail';
  if (list.includes('marginal')) return 'marginal';
  return 'pass';
}

/**
 * Evaluate one region of the plant — IEEE Std 2778-2020, 5.4.2 regional analysis.
 */
export function evaluateRegion(input: StudyInput, region: Region, geom: GridGeometry, factors: GeometricFactors): RegionResult {
  const warnings: string[] = [];

  const influenceDepth = input.influenceDepth > 0 ? input.influenceDepth : Math.sqrt(geom.area);
  const rhoEq = equivalentUniformResistivity(region.soil, influenceDepth, input.equivalentSoilMethod);
  const rhoTop = topLayerResistivity(region.soil);

  // IEEE Std 2778-2020, 5.4.4: footwear credit only applies inside the plant.
  const footwear = region.insidePlant ? input.footwearResistance : 0;
  const gloves = region.insidePlant ? input.gloveResistance : 0;
  if (!region.insidePlant && input.footwearResistance > 0) {
    warnings.push(
      'Footwear credit is withheld here: IEEE Std 2778-2020, 5.4.4 limits it to areas accessible only to qualified personnel.',
    );
  }

  const surfaceRho = region.surface.materialId === 'native' ? 0 : region.surface.rhoS;
  const tolerance = tolerableVoltages({
    weight: input.bodyWeight,
    shockDuration: region.shockDuration,
    rhoSoil: rhoTop,
    rhoSurface: surfaceRho,
    surfaceThickness: region.surface.thickness,
    footwearResistance: footwear,
    gloveResistance: gloves,
  });

  const current = gridCurrent(region.faultCurrent, region.splitFactor, region.faultDuration, region.xOverR);

  // Ground resistance: Schwarz where rods exist, Sverak otherwise; the higher of the two is used so
  // the result never depends on which formulation happens to be optimistic.
  const sverak = sverakResistance(rhoEq, geom.totalLength, geom.area, input.grid.depth);
  const schwarz = schwarzResistance(
    rhoEq,
    geom,
    input.grid,
    input.grid.rodCount,
    input.grid.rodLength,
    input.grid.rodDiameterM,
  );
  const gridOnly = input.grid.rodCount > 0 ? Math.max(sverak, schwarz.rg) : sverak;

  let resistance = gridOnly;
  if (input.auxiliary.enabled && input.auxiliary.postCount > 0) {
    const aux = blockEquivalentRod(
      rhoEq,
      input.auxiliary.postCount,
      input.auxiliary.postLength,
      input.auxiliary.postDiameterM,
      input.auxiliary.postSpacing,
      input.auxiliary.contactFraction,
    );
    resistance = combineWithAuxiliary(gridOnly, aux.assemblyResistance);
  }

  const gpr = resistance * current.maxGridCurrent;
  const em = meshVoltage(rhoEq, factors, current.maxGridCurrent);
  const es = stepVoltage(rhoEq, factors, current.maxGridCurrent);

  // IEEE Std 2778-2020, 4.3 and 5.4.1: the I·R drop along the auxiliary run adds directly to the
  // touch voltage seen at equipment remote from the main grid tie.
  //
  // Only part of the fault current takes that run. From the point of fault there are two paths to
  // remote earth in parallel: the local electrode (the block's own posts), and the run back to the
  // rest of the grounding system. Current divides between them as
  //
  //   Irun = IG · Rlocal / (Rlocal + Rrun + Rrest)
  //
  // Pushing all of IG down the run would overstate the drop severely, and IEEE Std 2778-2020, 4.2
  // is explicit that on a plant this size "even a small percentage of overdesign … can introduce
  // significant cost", so the division is worth modelling rather than assuming away.
  const paths = Math.max(region.auxRunPaths, 1);
  const runConductor = conductorVoltageDrop(
    1,
    region.auxRunLength,
    input.grid.conductorAreaMm2 * paths,
    input.grid.materialId,
  );
  const rRun = runConductor.resistance;
  const rLocal = localElectrodeResistance(input, rhoEq, gridOnly);
  const runFraction = rLocal / (rLocal + rRun + resistance);
  const runCurrent = current.maxGridCurrent * runFraction;
  const drop = { resistance: rRun, drop: runCurrent * rRun };
  const touchWithDrop = em + drop.drop;

  if (drop.drop > 0.1 * em && em > 0) {
    warnings.push(
      `Longitudinal I·R drop along the ${region.auxRunLength.toFixed(0)} m run adds ${drop.drop.toFixed(0)} V — over 10% of the mesh voltage. ${(runFraction * 100).toFixed(0)}% of the grid current takes this path. IEEE Std 2778-2020, 5.4.1 identifies this as the effect that invalidates solid-disk hand calculations.`,
    );
  }
  if (input.grid.spacing > 100) {
    warnings.push(
      `Grid spacing of ${input.grid.spacing.toFixed(0)} m is beyond the range the IEEE Std 80 closed-form equations were derived for. Per IEEE Std 2778-2020, 5.4.1 these results are a screening estimate; a finite-element model is required for the final design.`,
    );
  }
  if (region.splitFactor < 1) {
    warnings.push(
      `A split factor of ${region.splitFactor.toFixed(2)} is credited. IEEE Std 2778-2020, 5.2.2 requires this to come from a detailed model, not the IEEE Std 80 Annex C curves, which neglect the several ohms of grounding-conductor impedance between the fault and the line terminations.`,
    );
  }
  if (region.shockDuration < 0.03 || region.shockDuration > 3) {
    warnings.push('Shock duration is outside the 0.03 s to 3.0 s range over which IEEE Std 80 Equation (10) is valid.');
  }

  return {
    regionId: region.id,
    regionName: region.name,
    rhoEquivalent: rhoEq,
    rhoSurfaceSoil: rhoTop,
    tolerance,
    current,
    groundResistance: resistance,
    gridOnlyResistance: gridOnly,
    gpr,
    meshVoltage: em,
    stepVoltage: es,
    touchCheck: makeCheck('Mesh (touch) voltage', em, tolerance.touchLimit, 'IEEE Std 80-2013 Eq (80), (32)'),
    stepCheck: makeCheck('Step voltage', es, tolerance.stepLimit, 'IEEE Std 80-2013 Eq (92), (29)'),
    auxDrop: drop.drop,
    auxDropResistance: drop.resistance,
    auxRunCurrent: runCurrent,
    auxRunFraction: runFraction,
    localElectrodeResistance: rLocal,
    touchWithDrop,
    touchWithDropCheck: makeCheck(
      'Touch voltage incl. conductor drop',
      touchWithDrop,
      tolerance.touchLimit,
      'IEEE Std 2778-2020, 4.3 / 5.4.1',
    ),
    warnings,
  };
}

/**
 * Resistance to remote earth of the grounding local to the point of fault.
 *
 * Where auxiliary array grounding is credited, this is the block's own post network — the electrode
 * IEEE Std 2778-2020, 5.4.2 reduces to an equivalent rod. Where it is not, the local grounding is
 * just the inverter/GSU loop, which is a small fraction of the plant; the whole-grid resistance is
 * scaled up by the ratio of total area to one mesh as a first-order stand-in, so that a design
 * claiming no auxiliary grounding is not silently credited with the whole plant's electrode.
 */
function localElectrodeResistance(input: StudyInput, rhoEq: number, gridResistance: number): number {
  if (input.auxiliary.enabled && input.auxiliary.postCount > 0) {
    const aux = blockEquivalentRod(
      rhoEq,
      input.auxiliary.postCount,
      input.auxiliary.postLength,
      input.auxiliary.postDiameterM,
      input.auxiliary.postSpacing,
      input.auxiliary.contactFraction,
    );
    if (Number.isFinite(aux.assemblyResistance)) return aux.assemblyResistance;
  }
  const meshCount = Math.max((input.grid.lengthX * input.grid.lengthY) / (input.grid.spacing * input.grid.spacing), 1);
  return gridResistance * Math.sqrt(meshCount);
}

/** Run the full study across every region. */
export function runStudy(input: StudyInput): StudyResult {
  const geom = gridGeometry(input.grid);
  const factors = geometricFactors(input.grid, geom);
  const warnings: string[] = [];

  const regions = input.regions.map((r) => evaluateRegion(input, r, geom, factors));

  // Governing region = smallest margin on any check.
  let governing: RegionResult | null = null;
  let worstMargin = Number.POSITIVE_INFINITY;
  for (const r of regions) {
    const m = Math.min(r.touchCheck.margin, r.stepCheck.margin, r.touchWithDropCheck.margin);
    if (m < worstMargin) {
      worstMargin = m;
      governing = r;
    }
  }

  const auxiliary =
    input.auxiliary.enabled && input.auxiliary.postCount > 0 && governing
      ? blockEquivalentRod(
          governing.rhoEquivalent,
          input.auxiliary.postCount,
          input.auxiliary.postLength,
          input.auxiliary.postDiameterM,
          input.auxiliary.postSpacing,
          input.auxiliary.contactFraction,
        )
      : null;

  // Conductor sizing is driven by the highest asymmetrical current any region imposes.
  const sizingCurrent = regions.reduce((max, r) => Math.max(max, r.current.maxGridCurrent), 0);
  const sizing = sizeConductor(
    sizingCurrent,
    input.sizing.duration,
    input.sizing.materialId,
    input.sizing.ambientTemp,
    input.sizing.maxTemp,
  );

  if (sizing.areaMm2 > input.grid.conductorAreaMm2) {
    warnings.push(
      `The selected grid conductor (${input.grid.conductorAreaMm2.toFixed(1)} mm²) is below the ${sizing.areaMm2.toFixed(1)} mm² required thermally by IEEE Std 80-2013 Eq (37) for ${sizingCurrent.toFixed(0)} A over ${input.sizing.duration} s.`,
    );
  }

  const fence = input.fence.enabled ? evaluateFence(input, governing) : null;

  const verdicts: Verdict[] = regions.flatMap((r) => [
    r.touchCheck.verdict,
    r.stepCheck.verdict,
    r.touchWithDropCheck.verdict,
  ]);
  if (fence) verdicts.push(fence.verdict);

  return {
    geometry: geom,
    factors,
    auxiliary,
    sizing,
    sizingGoverningCurrent: sizingCurrent,
    regions,
    fence,
    overall: worstVerdict(verdicts),
    governingRegionId: governing?.regionId ?? null,
    warnings,
  };
}

/**
 * Fence touch-voltage check — IEEE Std 2778-2020, 4.4.
 *
 * A bonded fence has the fault voltage transferred onto it, so the touch voltage approaches the GPR
 * reduced only by the local earth potential; an unbonded fence set back behind a perimeter road
 * couples far less. Either way the person standing at the fence is outside the controlled area, so
 * no footwear credit is taken and the 50 kg body criterion applies.
 */
export function evaluateFence(input: StudyInput, governing: RegionResult | null): FenceResult {
  const rhoSoil = governing?.rhoSurfaceSoil ?? 100;
  const gpr = governing?.gpr ?? 0;
  const shockDuration = input.regions[0]?.shockDuration ?? 0.5;

  const surfaceRho = input.fence.surface.materialId === 'native' ? 0 : input.fence.surface.rhoS;
  const tolerance = tolerableVoltages({
    weight: 50, // A member of the public may be at the fence line.
    shockDuration,
    rhoSoil,
    rhoSurface: surfaceRho,
    surfaceThickness: input.fence.surface.thickness,
    footwearResistance: 0,
    gloveResistance: 0,
  });

  const fraction = input.fence.bonded
    ? Math.max(input.fence.potentialFraction, 0)
    : Math.max(input.fence.potentialFraction, 0) * 0.5;
  const touchVoltage = gpr * fraction;

  const note = input.fence.bonded
    ? 'Fence is bonded to the SPP grounding system, so fault voltage is transferred onto it (IEEE Std 2778-2020, 4.4). Localised fence grounding or surfacing may be needed where limits are exceeded.'
    : `Fence is not bonded and is set back ${input.fence.separation.toFixed(0)} m, which significantly decreases conductive coupling to faulted equipment (IEEE Std 2778-2020, 4.4).`;

  return {
    touchVoltage,
    limit: tolerance.touchLimit,
    margin: tolerance.touchLimit > 0 ? tolerance.touchLimit / touchVoltage : 0,
    verdict: verdictFor(touchVoltage, tolerance.touchLimit),
    tolerance,
    note,
  };
}
