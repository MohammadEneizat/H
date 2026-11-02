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

/**
 * Cables, ducts and conduits as numerical bodies (mm), and for each cable position of the
 * engine (three per circuit) the body it belongs to. Positions that coincide (the cores of a
 * three-core cable, or the circuits in one conduit) share a body.
 */
export function bodiesOf(inst: InstallationSpec, iec: RatingResult): { bodies: NumObject[]; map: number[] } {
  const ducted = inst.type === 'trench' ? !!inst.trench?.ducted : inst.type === 'ducts' || inst.type === 'ductbank';
  const raw: NumObject[] = iec.system
    ? iec.system.circuits.flatMap((c) => c.positions.map((p) => ({ x: p.x, y: p.y, r: (c.conduit?.Do ?? c.ductD ?? c.De) / 2 })))
    : iec.positions.map((p) => ({ x: p.x, y: p.y, r: (ducted ? inst.duct.outerD_mm : iec.geometry.De) / 2 }));
  const bodies: NumObject[] = [];
  const map = raw.map((o) => {
    const k = bodies.findIndex((b) => Math.hypot(b.x - o.x, b.y - o.y) < 1e-6 && Math.abs(b.r - o.r) < 1e-6);
    if (k >= 0) return k;
    bodies.push(o);
    return bodies.length - 1;
  });
  return { bodies, map };
}

/** Heat sources as numerical bodies (mm). */
export function sourceBodies(inst: InstallationSpec): NumObject[] {
  return (inst.heatSources ?? []).map((h) => ({ x: h.x_m * 1000, y: h.depth_m * 1000, r: h.diameter_mm / 2 }));
}

/** Losses per body, cable bodies first then heat sources, for drawing the numerical field. */
export function bodyLosses(inst: InstallationSpec, result: RatingResult): number[] {
  const { bodies, map } = bodiesOf(inst, result);
  const perPosition = result.system
    ? result.system.circuits.flatMap((c) => [c.W, c.W, c.W])
    : [result.losses.W, result.losses.W, result.losses.W];
  const cables = bodies.map(() => 0);
  map.forEach((b, p) => (cables[b] += perPosition[p] ?? 0));
  return [...cables, ...(inst.heatSources ?? []).map((h) => h.W)];
}

/** Influence matrices per cable position from those per body. */
function expand(numeric: NumericResult, map: number[], nb: number) {
  const F = map.map((bp) => map.map((bk) => numeric.F[bp][bk]));
  const SF = map.map((bp) => numeric.F[bp].slice(nb));
  return { numericF: F, numericSourceF: SF.length && SF[0].length ? SF : undefined };
}

/** Runs the numerical model for a cross-section layout. Returns null when the IEC result is not usable. */
export function numericRating(cable: CableSpec, inst: InstallationSpec, iec: RatingResult): NumericRating | null {
  if (inst.type !== 'trench' || !inst.trench || !iec.ok) return null;
  const { bodies, map } = bodiesOf(inst, iec);
  const objects = [...bodies, ...sourceBodies(inst)];
  const numeric: NumericResult & { posMap?: number[] } = solveNumeric(trenchNumericInput(inst.trench, objects));
  numeric.posMap = map;
  const result = calculateRating(cable, inst, expand(numeric, map, bodies.length));
  if (!result.ok) return { result, numeric, field: () => NaN };
  return { result, numeric, field: numericField(numeric, bodyLosses(inst, result), inst.ambient_C) };
}

/** The rating options that reproduce a numerical result (influence matrices per cable position and per source). */
export function numericOptions(inst: InstallationSpec, numeric: NumericResult & { posMap?: number[] }) {
  const nb = numeric.objects.length - (inst.heatSources?.length ?? 0);
  const map = numeric.posMap ?? Array.from({ length: nb }, (_, i) => i);
  return expand(numeric, map, nb);
}
