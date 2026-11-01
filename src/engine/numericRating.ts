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

/** Runs the numerical model for a trench layout. Returns null when the IEC result is not usable. */
export function numericRating(cable: CableSpec, inst: InstallationSpec, iec: RatingResult): NumericRating | null {
  if (inst.type !== 'trench' || !inst.trench || !iec.ok) return null;
  const objects = bodiesOf(inst, iec);
  const numeric = solveNumeric(trenchNumericInput(inst.trench, objects));
  const result = calculateRating(cable, inst, { numericF: numeric.F });
  if (!result.ok) return { result, numeric, field: () => NaN };
  const W = result.system
    ? result.system.circuits.flatMap((c) => [c.W, c.W, c.W])
    : [result.losses.W, result.losses.W, result.losses.W];
  return { result, numeric, field: numericField(numeric, W, inst.ambient_C) };
}
