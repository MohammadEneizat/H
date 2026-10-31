// Loss calculations — IEC 60287-1-1 clause 2 (5 in the 2023 edition).
import type { Bonding, Formation, SheathCable } from './types';

/** Skin effect factor ys from xs — IEC 60287-1-1 2.1.2 */
export function skinEffectFactor(xs: number): number {
  if (xs <= 2.8) {
    const x4 = xs ** 4;
    return x4 / (192 + 0.8 * x4);
  }
  if (xs <= 3.8) return -0.136 - 0.0177 * xs + 0.0563 * xs * xs;
  return 0.354 * xs - 0.733;
}

/** x² = 8πf/R' · 10⁻⁷ · k  (R' in Ω/m) */
export function xSquared(f: number, Rdc: number, k: number): number {
  return ((8 * Math.PI * f) / Rdc) * 1e-7 * k;
}

/**
 * Proximity effect factor yp for three single-core cables (or round conductors
 * of a three-core cable) — IEC 60287-1-1 2.1.4.1.
 * @param dc conductor diameter (mm)
 * @param s distance between conductor axes (mm)
 */
export function proximityEffectFactor(xp: number, dc: number, s: number): number {
  const x4 = xp ** 4;
  const F = x4 / (192 + 0.8 * x4);
  const r = dc / s;
  return F * r * r * (0.312 * r * r + 1.18 / (F + 0.27));
}

export interface ConductorAC {
  Rdc: number;
  xs: number;
  ys: number;
  xp: number;
  yp: number;
  R: number;
}

/** AC resistance of the conductor at temperature θ (Ω/m) — IEC 60287-1-1 2.1 */
export function conductorAC(p: {
  R0: number;
  alpha20: number;
  theta: number;
  f: number;
  ks: number;
  kp: number;
  dc: number;
  s: number;
}): ConductorAC {
  const Rdc = p.R0 * (1 + p.alpha20 * (p.theta - 20));
  const xs = Math.sqrt(xSquared(p.f, Rdc, p.ks));
  const ys = skinEffectFactor(xs);
  const xp = Math.sqrt(xSquared(p.f, Rdc, p.kp));
  const yp = proximityEffectFactor(xp, p.dc, p.s);
  return { Rdc, xs, ys, xp, yp, R: Rdc * (1 + ys + yp) };
}

/** Capacitance per unit length (F/m) — IEC 60287-1-1 2.2. Di over insulation, dc over conductor screen. */
export function capacitance(epsR: number, Di: number, dc: number): number {
  return (epsR / (18 * Math.log(Di / dc))) * 1e-9;
}

/** Dielectric loss per phase (W/m): Wd = ω C U0² tan δ */
export function dielectricLoss(omega: number, C: number, U0_V: number, tanDelta: number): number {
  return omega * C * U0_V * U0_V * tanDelta;
}

type EddyPosition = 'trefoil' | 'centre' | 'leading' | 'lagging';

/** λ0, Δ1, Δ2 for the eddy-current loss factor — IEC 60287-1-1 2.3.6.1 */
export function eddyCoefficients(m: number, dOver2s: number, pos: EddyPosition) {
  const r = dOver2s;
  const base = ((m * m) / (1 + m * m)) * r * r;
  let l0: number;
  let d1: number;
  let d2: number;
  switch (pos) {
    case 'trefoil':
      l0 = 3 * base;
      d1 = (1.14 * m ** 2.45 + 0.33) * r ** (0.92 * m + 1.66);
      d2 = 0;
      break;
    case 'centre':
      l0 = 6 * base;
      d1 = 0.86 * m ** 3.08 * r ** (1.4 * m + 0.7);
      d2 = 0;
      break;
    case 'leading':
      l0 = 1.5 * base;
      d1 = 4.7 * m ** 0.7 * r ** (0.16 * m + 2);
      d2 = 21 * m ** 3.3 * r ** (1.47 * m + 5.06);
      break;
    case 'lagging':
      l0 = 1.5 * base;
      d1 = -((0.74 * (m + 2) * m ** 0.5) / (2 + (m - 0.3) ** 2)) * r ** (m + 1);
      d2 = 0.92 * m ** 3.7 * r ** (m + 2);
      break;
  }
  if (m <= 0.1) {
    d1 = 0;
    d2 = 0;
  }
  return { l0, d1, d2 };
}

export interface SheathLossInput {
  /** Conductor AC resistance (Ω/m) */
  R: number;
  /** Sheath resistance at operating temperature (Ω/m) */
  Rs: number;
  /** Sheath material resistivity at operating temperature (Ω·m) */
  rhoS: number;
  /** Mean sheath diameter d (mm) */
  d: number;
  /** External sheath diameter Ds (mm) */
  Ds: number;
  /** Sheath thickness ts (mm) */
  ts: number;
  /** Axial spacing between adjacent cables (mm) */
  s: number;
  omega: number;
  formation: Formation;
  transposed: boolean;
  bonding: Bonding;
  milliken: boolean;
  /** λ1' to use for cross-bonded systems */
  crossBondLambda1: number;
}

export interface SheathLossOutput {
  X: number;
  m: number;
  Ft: number | null;
  cables: SheathCable[];
}

/**
 * Sheath / screen loss factors λ1 = λ1' + λ1'' for the three cables of a circuit
 * — IEC 60287-1-1 2.3.1 to 2.3.6.
 */
export function sheathLossFactors(p: SheathLossInput): SheathLossOutput {
  const { R, Rs, d, s, omega } = p;
  const X = 2 * omega * 1e-7 * Math.log((2 * s) / d);
  const Xm = 2 * omega * 1e-7 * Math.log(2);
  const X1 = 2 * omega * 1e-7 * Math.log((2 * Math.cbrt(2) * s) / d);

  const labels =
    p.formation === 'trefoil'
      ? ['Cable L1', 'Cable L2', 'Cable L3']
      : ['Outer cable, leading phase', 'Centre cable', 'Outer cable, lagging phase'];

  // Circulating-current losses λ1'
  let lp = [0, 0, 0];
  if (p.bonding === 'both') {
    if (p.formation === 'trefoil') {
      const v = (Rs / R) / (1 + (Rs / X) ** 2);
      lp = [v, v, v];
    } else if (p.transposed) {
      const v = (Rs / R) / (1 + (Rs / X1) ** 2);
      lp = [v, v, v];
    } else {
      const P = X + Xm;
      const Q = X - Xm / 3;
      const Rs2 = Rs * Rs;
      const a = (0.25 * Q * Q) / (Rs2 + Q * Q) + (0.75 * P * P) / (Rs2 + P * P);
      const b = (2 * Rs * P * Q * Xm) / (Math.sqrt(3) * (Rs2 + P * P) * (Rs2 + Q * Q));
      lp = [(Rs / R) * (a - b), (Rs / R) * ((Q * Q) / (Rs2 + Q * Q)), (Rs / R) * (a + b)];
    }
  } else if (p.bonding === 'cross') {
    lp = [p.crossBondLambda1, p.crossBondLambda1, p.crossBondLambda1];
  }

  // Eddy-current losses λ1''
  const m = (omega / Rs) * 1e-7;
  const beta1 = Math.sqrt((4 * Math.PI * omega) / (1e7 * p.rhoS));
  const gs = 1 + (p.ts / p.Ds) ** 1.74 * (beta1 * p.Ds * 1e-3 - 1.6);
  const thick = (beta1 * p.ts) ** 4 / 12e12;
  const positions: EddyPosition[] =
    p.formation === 'trefoil' ? ['trefoil', 'trefoil', 'trefoil'] : ['leading', 'centre', 'lagging'];
  let lpp = positions.map((pos) => {
    const { l0, d1, d2 } = eddyCoefficients(m, d / (2 * s), pos);
    return (Rs / R) * (gs * l0 * (1 + d1 + d2) + thick);
  });

  // Sheaths bonded at both ends: eddy losses are ignored, except for Milliken
  // conductors where they are reduced by the factor Ft (IEC 60287-1-1 2.3.1).
  let Ft: number | null = null;
  if (p.bonding === 'both') {
    if (p.milliken) {
      let M: number;
      let N: number;
      if (p.formation === 'trefoil') {
        M = N = Rs / X;
      } else if (p.transposed) {
        M = N = Rs / X1;
      } else {
        M = Rs / (X + Xm);
        N = Rs / (X - Xm / 3);
      }
      Ft = (4 * M * M * N * N + (M + N) ** 2) / (4 * (M * M + 1) * (N * N + 1));
      lpp = lpp.map((v) => v * (Ft as number));
    } else {
      lpp = [0, 0, 0];
    }
  }

  const cables = labels.map((label, i) => ({
    label,
    lambda1p: lp[i],
    lambda1pp: lpp[i],
    lambda1: lp[i] + lpp[i],
  }));
  const reportX = p.formation === 'flat' && p.transposed ? X1 : X;
  return { X: reportX, m, Ft, cables };
}
