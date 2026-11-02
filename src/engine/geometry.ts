import { METALS } from './materials';
import type { CableGeometry, CableSpec } from './types';

const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const given = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Builds the cable cross-section from datasheet layer thicknesses (all mm). */
export function deriveGeometry(c: CableSpec): {
  geometry: CableGeometry;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  const dc = c.conductor.diameter_mm;
  if (!pos(dc)) errors.push('Enter the conductor diameter.');
  if (!pos(c.insulation.thickness_mm)) errors.push('Enter the insulation thickness.');
  if (c.cores === 3) return threeCoreGeometry(c, errors, warnings);
  if (c.screen.form !== 'none' && !pos(c.screen.thickness_mm))
    errors.push(
      c.screen.form === 'wires' ? 'Enter the screen wire diameter.' : 'Enter the sheath thickness.',
    );
  if (!pos(c.jacket.thickness_mm)) errors.push('Enter the oversheath thickness.');
  for (const [v, name] of [
    [c.conductorScreen_mm, 'conductor screen'],
    [c.insulationScreen_mm, 'insulation screen'],
    [c.bedding_mm, 'bedding / tapes'],
  ] as const) {
    if (!given(v) || v < 0) errors.push(`The ${name} thickness must be zero or more.`);
  }

  const dcScreen = dc + 2 * c.conductorScreen_mm;
  const Di = dcScreen + 2 * c.insulation.thickness_mm;
  const Dis = Di + 2 * c.insulationScreen_mm;
  const Dunder = Dis + 2 * c.bedding_mm;
  const t = c.screen.thickness_mm;
  const metal = METALS[c.screen.material];
  const R20 = c.screen.R20_ohm_km;
  const areaFromR = pos(R20) ? (metal.rho20 / (R20 / 1000)) * 1e6 : undefined;

  let dMean: number;
  let Ds: number;
  let As: number;
  let ts: number;
  let Da: number;
  let t1: number;
  let Dit: number | undefined;
  let Doc: number | undefined;

  if (c.screen.form === 'none') {
    dMean = Dunder;
    Ds = Dunder;
    As = 0;
    ts = 0;
    Da = Dunder;
    t1 = (Dunder - dc) / 2;
  } else if (c.screen.form === 'wires') {
    dMean = Dunder + t;
    Ds = Dunder + 2 * t;
    const fromCount = pos(c.screen.wireCount) ? (c.screen.wireCount * Math.PI * t * t) / 4 : undefined;
    As = pos(c.screen.area_mm2) ? c.screen.area_mm2 : (fromCount ?? areaFromR ?? NaN);
    if (!pos(As)) errors.push('Enter the screen cross-section, the number of wires, or the screen resistance.');
    ts = As / (Math.PI * dMean);
    Da = Ds;
    t1 = (Dunder - dc) / 2;
  } else if (c.screen.form === 'smooth') {
    dMean = Dunder + t;
    Ds = Dunder + 2 * t;
    As = pos(c.screen.area_mm2) ? c.screen.area_mm2 : (areaFromR ?? Math.PI * dMean * t);
    ts = t;
    Da = Ds;
    t1 = (Dunder - dc) / 2;
  } else {
    Dit = Dunder;
    Doc = c.screen.corrugationOD_mm ?? NaN;
    if (!pos(Doc)) errors.push('Enter the outer diameter over the corrugation crests (Doc).');
    else if (Doc <= Dit + 2 * t)
      errors.push('Doc must be larger than the diameter under the sheath plus twice the sheath thickness.');
    dMean = (Dit + Doc) / 2;
    Ds = Doc;
    if (pos(c.screen.area_mm2)) As = c.screen.area_mm2;
    else if (areaFromR) As = areaFromR;
    else {
      As = Math.PI * dMean * t;
      warnings.push(
        'Corrugated sheath area estimated as π·d·ts, which ignores the corrugation. Enter the area or resistance from the datasheet.',
      );
    }
    ts = t;
    Da = Doc;
    t1 = ((Dit + Doc) / 2 - t - dc) / 2;
  }

  const t3 = c.jacket.thickness_mm;
  const DeBuilt = Da + 2 * t3;
  let De = DeBuilt;
  if (pos(c.overallDiameter_mm)) {
    De = c.overallDiameter_mm;
    const diff = Math.abs(De - DeBuilt) / DeBuilt;
    if (diff > 0.03)
      warnings.push(
        `Datasheet overall diameter (${De.toFixed(1)} mm) differs from the layer build-up (${DeBuilt.toFixed(1)} mm) by ${(diff * 100).toFixed(1)} %. Check the layer thicknesses.`,
      );
  }

  return {
    geometry: { dc, dcScreen, Di, Dis, Dunder, dMean, Ds, ts, As, Dit, Doc, t1, Da, t3, DeBuilt, De, cores: 1 },
    errors,
    warnings,
  };
}

/**
 * Radius of the circle circumscribing the three conductors (mm).
 * Round: centres at s/√3 from the axis, s = dc + t. Sector-shaped: three 120° sectors with
 * half the insulation between conductors on each straight side, πr²/3 − t·r = area of the
 * equivalent round conductor (πdx²/4).
 */
export function threeCoreR1(shape: 'round' | 'sector', dc: number, t: number): number {
  if (shape === 'round') return (dc + t) / Math.sqrt(3) + dc / 2;
  const A = (Math.PI * dc * dc) / 4;
  const k = Math.PI / 3;
  return (t + Math.sqrt(t * t + 4 * k * A)) / (2 * k);
}

/** Three-core cable without metallic screen: cores laid up, inner covering, oversheath. */
function threeCoreGeometry(c: CableSpec, errors: string[], warnings: string[]) {
  const tc = c.threeCore ?? { shape: 'round' as const };
  const dc = c.conductor.diameter_mm;
  // Radial thickness of each core's insulation, screens counted as insulation
  const tIns = c.conductorScreen_mm + c.insulation.thickness_mm + c.insulationScreen_mm;
  const t = 2 * tIns;
  const r1 = pos(tc.r1_mm) ? tc.r1_mm : threeCoreR1(tc.shape, dc, t);
  const coreD = tc.shape === 'round' ? dc + t : NaN;
  const layD = 2 * (r1 + tIns);
  const t3 = c.jacket.thickness_mm;
  if (!pos(t3)) errors.push('Enter the oversheath thickness.');
  let cover: number;
  if (given(tc.innerCovering_mm) && tc.innerCovering_mm >= 0) cover = tc.innerCovering_mm;
  else if (pos(c.overallDiameter_mm)) {
    cover = Math.max(0, (c.overallDiameter_mm - 2 * t3 - layD) / 2);
    if (c.overallDiameter_mm - 2 * t3 < layD - 0.5)
      warnings.push(
        `The overall diameter leaves no room for the cores (laid-up diameter ${layD.toFixed(1)} mm). Check the insulation and sheath thicknesses, or enter r1.`,
      );
  } else cover = 0;
  const da = layD + 2 * cover;
  const DeBuilt = da + 2 * t3;
  let De = DeBuilt;
  if (pos(c.overallDiameter_mm)) {
    De = c.overallDiameter_mm;
    const diff = Math.abs(De - DeBuilt) / DeBuilt;
    if (diff > 0.03)
      warnings.push(
        `Datasheet overall diameter (${De.toFixed(1)} mm) differs from the layer build-up (${DeBuilt.toFixed(1)} mm) by ${(diff * 100).toFixed(1)} %. Check the layer thicknesses.`,
      );
  }
  const dcScreen = dc + 2 * c.conductorScreen_mm;
  const Di = dcScreen + 2 * c.insulation.thickness_mm;
  const Dis = Di + 2 * c.insulationScreen_mm;
  return {
    geometry: {
      dc,
      dcScreen,
      Di,
      Dis,
      Dunder: da,
      dMean: da,
      Ds: da,
      ts: 0,
      As: 0,
      t1: tIns,
      Da: da,
      t3,
      DeBuilt,
      De,
      cores: 3 as const,
      threeCore: { shape: tc.shape, r1, t, coreD, layD, da, innerCovering: cover },
    },
    errors,
    warnings,
  };
}
