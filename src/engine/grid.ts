import type { GridSpec } from './types';

/**
 * Grid geometry derived from the plan dimensions.
 */
export interface GridGeometry {
  /** Enclosed area A, m². */
  area: number;
  /** Perimeter Lp, m. */
  perimeter: number;
  /** Total length of buried horizontal conductor Lc, m. */
  conductorLength: number;
  /** Total length of ground rods LR, m. */
  rodLength: number;
  /** Total buried conductor length LT = Lc + LR, m. */
  totalLength: number;
  /** Maximum distance between any two points on the grid Dm, m. */
  maxDistance: number;
  /** Number of parallel conductors in the x direction. */
  linesX: number;
  /** Number of parallel conductors in the y direction. */
  linesY: number;
}

/**
 * Conductor length of a rectangular grid with uniform spacing D in both directions.
 * Rounds up so the grid is always closed on all four sides.
 */
export function gridGeometry(grid: GridSpec): GridGeometry {
  const { lengthX, lengthY, spacing, rodCount, rodLength } = grid;
  const D = Math.max(spacing, 0.1);

  // Number of conductor runs parallel to each axis (a run spans the opposite dimension).
  const linesY = Math.max(Math.round(lengthX / D) + 1, 2); // runs parallel to y, spaced along x
  const linesX = Math.max(Math.round(lengthY / D) + 1, 2); // runs parallel to x, spaced along y

  const conductorLength = linesY * lengthY + linesX * lengthX;
  const rods = Math.max(rodCount, 0) * Math.max(rodLength, 0);

  return {
    area: lengthX * lengthY,
    perimeter: 2 * (lengthX + lengthY),
    conductorLength,
    rodLength: rods,
    totalLength: conductorLength + rods,
    maxDistance: Math.hypot(lengthX, lengthY),
    linesX,
    linesY,
  };
}

/**
 * Ground resistance to remote earth — Sverak's equation, IEEE Std 80-2013 Equation (52):
 *
 *   Rg = ρ · [ 1/LT + 1/√(20A) · ( 1 + 1/(1 + h·√(20/A)) ) ]
 */
export function sverakResistance(rho: number, totalLength: number, area: number, depth: number): number {
  if (totalLength <= 0 || area <= 0) return Number.POSITIVE_INFINITY;
  const term = 1 / Math.sqrt(20 * area);
  const bracket = 1 + 1 / (1 + depth * Math.sqrt(20 / area));
  return rho * (1 / totalLength + term * bracket);
}

export interface SchwarzResult {
  /** Resistance of the horizontal grid alone, Ω. */
  r1: number;
  /** Resistance of the rod bed alone, Ω. */
  r2: number;
  /** Mutual resistance between grid and rods, Ω. */
  rm: number;
  /** Combined resistance, Ω. */
  rg: number;
}

/**
 * Schwarz coefficients k1 and k2 — IEEE Std 80-2013 Figure 25, expressed as the linear fits the
 * standard gives for three burial depths and interpolated on h/√A.
 *
 * x is the grid length-to-width ratio (≥ 1).
 */
export function schwarzCoefficients(lengthRatio: number, depth: number, area: number): { k1: number; k2: number } {
  const x = Math.max(lengthRatio, 1);
  const sqrtA = Math.sqrt(Math.max(area, 1e-9));
  const rel = depth / sqrtA;

  // Anchor curves from IEEE Std 80-2013 Figure 25.
  const at0 = { k1: -0.04 * x + 1.41, k2: 0.15 * x + 5.5 };
  const at10 = { k1: -0.05 * x + 1.2, k2: 0.1 * x + 4.68 }; // h = √A / 10
  const at6 = { k1: -0.05 * x + 1.13, k2: -0.05 * x + 4.4 }; // h = √A / 6

  if (rel <= 0) return at0;
  if (rel <= 0.1) {
    const t = rel / 0.1;
    return { k1: at0.k1 + t * (at10.k1 - at0.k1), k2: at0.k2 + t * (at10.k2 - at0.k2) };
  }
  if (rel <= 1 / 6) {
    const t = (rel - 0.1) / (1 / 6 - 0.1);
    return { k1: at10.k1 + t * (at6.k1 - at10.k1), k2: at10.k2 + t * (at6.k2 - at10.k2) };
  }
  return at6;
}

/**
 * Combined grid-and-rod resistance — Schwarz's equations, IEEE Std 80-2013 Equations (53)–(57).
 *
 * More representative than Sverak's single expression when a meaningful rod bed (or, in an SPP, a
 * population of driven array posts acting as rods per IEEE Std 2778-2020 4.3) is present, because it
 * accounts for the mutual resistance between the horizontal grid and the vertical electrodes.
 */
export function schwarzResistance(
  rho: number,
  geom: GridGeometry,
  grid: GridSpec,
  rodCount: number,
  rodLength: number,
  rodDiameter: number,
): SchwarzResult {
  const { area, conductorLength } = geom;
  const h = Math.max(grid.depth, 0.05);
  const a = Math.max(grid.conductorDiameterM, 1e-4) / 2;
  const sqrtA = Math.sqrt(area);
  const ratio = Math.max(grid.lengthX, grid.lengthY) / Math.max(Math.min(grid.lengthX, grid.lengthY), 1e-9);
  const { k1, k2 } = schwarzCoefficients(ratio, h, area);

  // Equivalent radius of a conductor buried at depth h.
  const aPrime = Math.sqrt(a * 2 * h);

  const r1 =
    (rho / (Math.PI * conductorLength)) *
    (Math.log((2 * conductorLength) / aPrime) + (k1 * conductorLength) / sqrtA - k2);

  if (rodCount <= 0 || rodLength <= 0) {
    return { r1, r2: Number.POSITIVE_INFINITY, rm: 0, rg: r1 };
  }

  const b = Math.max(rodDiameter, 1e-4) / 2;
  const r2 =
    (rho / (2 * Math.PI * rodCount * rodLength)) *
    (Math.log((8 * rodLength) / (2 * b)) - 1 + ((2 * k1 * rodLength) / sqrtA) * (Math.sqrt(rodCount) - 1) ** 2);

  const rm =
    (rho / (Math.PI * conductorLength)) *
    (Math.log((2 * conductorLength) / rodLength) + (k1 * conductorLength) / sqrtA - k2 + 1);

  const denom = r1 + r2 - 2 * rm;
  const rg = denom > 0 ? (r1 * r2 - rm * rm) / denom : Math.min(r1, r2);
  return { r1, r2, rm, rg: Math.max(rg, 0) };
}

export interface GeometricFactors {
  /** Effective number of parallel conductors n = na·nb·nc·nd. */
  n: number;
  na: number;
  nb: number;
  nc: number;
  nd: number;
  /** Spacing factor for mesh voltage Km. */
  km: number;
  /** Corrective weighting factor Kii. */
  kii: number;
  /** Corrective depth factor Kh. */
  kh: number;
  /** Irregularity factor Ki. */
  ki: number;
  /** Spacing factor for step voltage Ks. */
  ks: number;
  /** Effective buried length for mesh voltage LM, m. */
  lm: number;
  /** Effective buried length for step voltage LS, m. */
  ls: number;
}

/**
 * Geometric factors for the mesh and step voltage equations — IEEE Std 80-2013 Equations (81)–(94).
 */
export function geometricFactors(grid: GridSpec, geom: GridGeometry): GeometricFactors {
  const { area, perimeter, conductorLength, rodLength: LR, maxDistance } = geom;
  const D = Math.max(grid.spacing, 0.1);
  const h = Math.max(grid.depth, 0.05);
  const d = Math.max(grid.conductorDiameterM, 1e-4);
  const Lx = grid.lengthX;
  const Ly = grid.lengthY;

  // Equation (85): n = na·nb·nc·nd
  const na = (2 * conductorLength) / perimeter;
  const nb = Math.sqrt(perimeter / (4 * Math.sqrt(area)));
  const nc = Math.pow((Lx * Ly) / area, (0.7 * area) / (Lx * Ly));
  const nd = maxDistance > 0 ? maxDistance / Math.hypot(Lx, Ly) : 1;
  const n = na * nb * nc * nd;

  // Equation (89)/(90): Kii — unity when rods are in the corners and along the perimeter.
  const kii = grid.rodsOnPerimeter && grid.rodCount > 0 ? 1 : 1 / Math.pow(2 * n, 2 / n);

  // Equation (91): Kh with reference depth h0 = 1 m.
  const kh = Math.sqrt(1 + h / 1);

  // Equation (81): Km
  const bracket = (D * D) / (16 * h * d) + (D + 2 * h) ** 2 / (8 * D * d) - h / (4 * d);
  const km =
    (1 / (2 * Math.PI)) *
    (Math.log(bracket) + (kii / kh) * Math.log(8 / (Math.PI * (2 * n - 1))));

  // Equation (88): Ki
  const ki = 0.644 + 0.148 * n;

  // Equation (94): Ks
  const ks = (1 / Math.PI) * (1 / (2 * h) + 1 / (D + h) + (1 / D) * (1 - Math.pow(0.5, n - 2)));

  // Equations (86)/(87): LM
  const lm =
    grid.rodsOnPerimeter && LR > 0
      ? conductorLength + (1.55 + 1.22 * (grid.rodLength / Math.hypot(Lx, Ly))) * LR
      : conductorLength + LR;

  // Equation (93): LS
  const ls = 0.75 * conductorLength + 0.85 * LR;

  return { n, na, nb, nc, nd, km, kii, kh, ki, ks, lm, ls };
}

/**
 * Mesh voltage Em — IEEE Std 80-2013, Equation (80): Em = ρ·Km·Ki·IG / LM.
 * Em is the worst-case touch voltage within the grid, at the centre of a corner mesh.
 */
export function meshVoltage(rho: number, factors: GeometricFactors, gridCurrentA: number): number {
  return factors.lm > 0 ? (rho * factors.km * factors.ki * gridCurrentA) / factors.lm : Number.POSITIVE_INFINITY;
}

/**
 * Step voltage Es — IEEE Std 80-2013, Equation (92): Es = ρ·Ks·Ki·IG / LS.
 */
export function stepVoltage(rho: number, factors: GeometricFactors, gridCurrentA: number): number {
  return factors.ls > 0 ? (rho * factors.ks * factors.ki * gridCurrentA) / factors.ls : Number.POSITIVE_INFINITY;
}
