// Rating with the numerical ground model, alongside the IEC 60287 result.
import { solveNumeric, numericField, type NumericResult, type NumObject } from './numeric';
import { calculateRating } from './solver';
import { trenchNumericInput } from './trench';
import type { CableSpec, InstallationSpec, RatingResult } from './types';

export interface NumericRating {
  result: RatingResult;
  numeric: NumericResult;
  /** Ground temperature (°C) at a point (mm), NaN inside cables, ducts or above ground */
  field: (x: number, y: number) => number;
}

/** Cables (or ducts) of all circuits, in the engine's order, from an IEC result. */
export function bodiesOf(inst: InstallationSpec, iec: RatingResult): NumObject[] {
  const ducted = inst.type === 'trench' ? !!inst.trench?.ducted : inst.type === 'ducts' || inst.type === 'ductbank';
  if (iec.system)
    return iec.system.circuits.flatMap((c) => c.positions.map((p) => ({ x: p.x, y: p.y, r: (c.ductD ?? c.De) / 2 })));
  const r = (ducted ? inst.duct.outerD_mm : iec.geometry.De) / 2;
  return iec.positions.map((p) => ({ x: p.x, y: p.y, r }));
}

/** Heat sources as numerical bodies (mm). */
export function sourceBodies(inst: InstallationSpec): NumObject[] {
  return (inst.heatSources ?? []).map((h) => ({ x: h.x_m * 1000, y: h.depth_m * 1000, r: h.diameter_mm / 2 }));
}

/** Losses per body, cables first then heat sources, for drawing the numerical field. */
export function bodyLosses(inst: InstallationSpec, result: RatingResult): number[] {
  const cables = result.system
    ? result.system.circuits.flatMap((c) => [c.W, c.W, c.W])
    : [result.losses.W, result.losses.W, result.losses.W];
  return [...cables, ...(inst.heatSources ?? []).map((h) => h.W)];
}

/** Runs the numerical model for a cross-section layout. Returns null when the IEC result is not usable. */
export function numericRating(cable: CableSpec, inst: InstallationSpec, iec: RatingResult): NumericRating | null {
  if (inst.type !== 'trench' || !inst.trench || !iec.ok) return null;
  const cables = bodiesOf(inst, iec);
  const objects = [...cables, ...sourceBodies(inst)];
  const numeric = solveNumeric(trenchNumericInput(inst.trench, objects));
  const nc = cables.length;
  const F = numeric.F.slice(0, nc).map((row) => row.slice(0, nc));
  const SF = numeric.F.slice(0, nc).map((row) => row.slice(nc));
  const result = calculateRating(cable, inst, { numericF: F, numericSourceF: SF.length && SF[0].length ? SF : undefined });
  if (!result.ok) return { result, numeric, field: () => NaN };
  return { result, numeric, field: numericField(numeric, bodyLosses(inst, result), inst.ambient_C) };
}

/** The rating options that reproduce a numerical result (influence matrices split into cables and sources). */
export function numericOptions(inst: InstallationSpec, numeric: NumericResult) {
  const nc = numeric.objects.length - (inst.heatSources?.length ?? 0);
  const F = numeric.F.slice(0, nc).map((row) => row.slice(0, nc));
  const SF = numeric.F.slice(0, nc).map((row) => row.slice(nc));
  return { numericF: F, numericSourceF: SF.length && SF[0].length ? SF : undefined };
}
