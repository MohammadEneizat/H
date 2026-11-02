// Thermal resistances — IEC 60287-2-1 clause 2 (4 in the 2015 edition).
import type { Formation } from './types';

const TWO_PI = 2 * Math.PI;

/** T1 for a single-core cable: ρT/2π · ln(1 + 2t1/dc) */
export function thermalT1(rhoT: number, t1: number, dc: number): number {
  return (rhoT / TWO_PI) * Math.log(1 + (2 * t1) / dc);
}

/**
 * T1 of a three-core cable without metallic screen, between one conductor and the
 * oversheath (IEC 60287-2-1 4.1.2.2). Sector-shaped conductors (4.1.2.2.6):
 * G = 3·F2·ln(da/2r1), F2 = 1 + 3t/[2π(dx + t) − t], T1 = ρi/2π·G.
 * Round conductors (4.1.2.2.4, Equation 1): T1 = ρi/2π·G + 0.031(ρf − ρi)·e^(0.67·t1/dc), where
 * G of Figure 3 is approximated by the sector formula with dx = dc.
 */
export function thermalT1ThreeCore(p: {
  shape: 'round' | 'sector';
  rhoI: number;
  rhoF: number;
  da: number;
  r1: number;
  dc: number;
  t: number;
  /** Insulation between conductor and oversheath (round conductors) */
  t1: number;
}): { T1: number; G: number; F2: number; filler: number } {
  const F2 = 1 + (3 * p.t) / (2 * Math.PI * (p.dc + p.t) - p.t);
  const G = 3 * F2 * Math.log(p.da / (2 * p.r1));
  const filler = p.shape === 'round' ? 0.031 * (p.rhoF - p.rhoI) * Math.exp((0.67 * p.t1) / p.dc) : 0;
  return { T1: (p.rhoI / TWO_PI) * G + filler, G, F2, filler };
}

/**
 * Equivalent diameter of a group of cables lying in one duct, for T4' (IEC 60287-2-1 4.2.7.1):
 * two cables 1.65·De, three 2.15·De, four 2.5·De. Beyond four the group is scaled by its area.
 */
export function groupEquivalentDiameter(count: number, De: number): { Deq: number; factor: number; extrapolated: boolean } {
  const table: Record<number, number> = { 1: 1, 2: 1.65, 3: 2.15, 4: 2.5 };
  const factor = table[count] ?? 2.5 * Math.sqrt(count / 4);
  return { Deq: factor * De, factor, extrapolated: count > 4 };
}

/** T3 for an oversheath over a smooth sheath or wire screen: ρT/2π · ln(1 + 2t3/Da) */
export function thermalT3(rhoT: number, t3: number, Da: number): number {
  return (rhoT / TWO_PI) * Math.log(1 + (2 * t3) / Da);
}

/** T3 over a corrugated sheath: ρT/2π · ln[(Doc + 2t3) / ((Doc + Dit)/2 + t3)] */
export function thermalT3Corrugated(rhoT: number, t3: number, Doc: number, Dit: number): number {
  return (rhoT / TWO_PI) * Math.log((Doc + 2 * t3) / ((Doc + Dit) / 2 + t3));
}

/** ln(u + √(u² − 1)) */
export function acoshTerm(u: number): number {
  return Math.log(u + Math.sqrt(u * u - 1));
}

/** Isolated buried cable or duct: T4 = ρ/2π · ln(u + √(u² − 1)), u = 2L/De */
export function buriedIsolatedT4(rho: number, L_mm: number, D_mm: number): number {
  return (rho / TWO_PI) * acoshTerm((2 * L_mm) / D_mm);
}

export interface Point {
  x: number;
  /** Depth below ground surface (positive downwards) */
  y: number;
}

/**
 * Positions of the three cables (mm). Trefoil has its apex at the top and flat formation is
 * horizontal; rotated gives a trefoil with the apex at the bottom, or a vertical flat formation.
 */
export function circuitPositions(formation: Formation, s: number, depth: number, rotated = false): Point[] {
  if (formation === 'flat') {
    return rotated
      ? [
          { x: 0, y: depth - s },
          { x: 0, y: depth },
          { x: 0, y: depth + s },
        ]
      : [
          { x: -s, y: depth },
          { x: 0, y: depth },
          { x: s, y: depth },
        ];
  }
  const h = s / Math.sqrt(3);
  const k = rotated ? -1 : 1;
  return [
    { x: -s / 2, y: depth + (k * h) / 2 },
    { x: 0, y: depth - k * h },
    { x: s / 2, y: depth + (k * h) / 2 },
  ];
}

/**
 * External thermal resistance of each of three equally loaded cables or ducts of one
 * circuit, including the heating of the circuit's other two cables — IEC 60287-2-1 2.2.3.
 *
 * Touching trefoil and touching flat groups use the closed formulas of 2.2.3.2 (the same
 * value is applied to all three positions). Spaced groups use superposition with image
 * sources (Kennelly), which for flat formation reduces to
 * ρ/2π · ln{(u + √(u² − 1))·[1 + (2L/s1)²]} for the centre cable.
 */
export function groupT4PerCable(
  rho: number,
  D: number,
  positions: Point[],
  formation: Formation,
  touching: boolean,
  centreDepth: number,
): { T4: number[]; hottest: number; method: string } {
  if (touching) {
    const u = (2 * centreDepth) / D;
    const value =
      formation === 'trefoil'
        ? (1.5 / Math.PI) * rho * (Math.log(2 * u) - 0.63)
        : rho * (0.475 * Math.log(2 * u) - 0.346);
    return {
      T4: [value, value, value],
      hottest: 1,
      method:
        formation === 'trefoil'
          ? 'Trefoil, touching: T4 = 1.5/π·ρ·[ln(2u) − 0.630]'
          : 'Flat, touching (centre cable): T4 = ρ·[0.475·ln(2u) − 0.346]',
    };
  }
  const T4 = positions.map((p, i) => {
    let sum = acoshTerm((2 * p.y) / D);
    positions.forEach((q, k) => {
      if (k !== i) sum += Math.log(imageRatio(p, q));
    });
    return (rho / TWO_PI) * sum;
  });
  let hottest = 0;
  T4.forEach((v, i) => {
    if (v > T4[hottest]) hottest = i;
  });
  return {
    T4,
    hottest,
    method: 'Spaced group, superposition: T4 = ρ/2π·ln{(u + √(u² − 1))·Π(d′pk/dpk)}',
  };
}

/** External thermal resistance of the hottest of three equally loaded cables or ducts. */
export function groupT4(
  rho: number,
  D: number,
  positions: Point[],
  formation: Formation,
  touching: boolean,
  centreDepth: number,
): { T4: number; hottest: number; method: string } {
  const g = groupT4PerCable(rho, D, positions, formation, touching, centreDepth);
  return { T4: g.T4[g.hottest], hottest: g.hottest, method: g.method };
}

/** d′pk / dpk: distance from p to the image of k above the ground surface, over the distance p–k. */
export function imageRatio(p: Point, q: Point): number {
  return Math.hypot(p.x - q.x, p.y + q.y) / Math.hypot(p.x - q.x, p.y - q.y);
}

/**
 * Temperature rise at cable p per W/m dissipated in cable k of another circuit:
 * Δθkp / Wk = ρ/2π · ln(d′pk/dpk) — IEC 60287-2-1 2.2.3.1.
 */
export function mutualHeatingFactor(rho: number, p: Point, q: Point): number {
  return (rho / TWO_PI) * Math.log(imageRatio(p, q));
}

/** Air space between cable and duct: T4' = U / [1 + 0.1(V + Y·θm)·De], De in mm */
export function ductAirT4(U: number, V: number, Y: number, thetaM: number, De: number): number {
  return U / (1 + 0.1 * (V + Y * thetaM) * De);
}

/** Duct wall: T4'' = ρ/2π · ln(Do/Dd) */
export function ductWallT4(rho: number, Do: number, Dd: number): number {
  return (rho / TWO_PI) * Math.log(Do / Dd);
}

/**
 * Equivalent radius of a rectangular duct bank (same units as x, y) — IEC 60287-2-1 2.2.7.3:
 * ln rb = ½·(x/y)·(4/π − x/y)·ln(1 + y²/x²) + ln(x/2), x the shorter side.
 */
export function ductBankRadius(width: number, height: number): number {
  const x = Math.min(width, height);
  const y = Math.max(width, height);
  const lnrb = 0.5 * (x / y) * (4 / Math.PI - x / y) * Math.log(1 + (y * y) / (x * x)) + Math.log(x / 2);
  return Math.exp(lnrb);
}

/** Duct bank correction: N/2π · (ρe − ρc) · ln(u + √(u² − 1)), u = LG/rb */
export function ductBankCorrection(
  N: number,
  rhoSoil: number,
  rhoConcrete: number,
  LG: number,
  rb: number,
): number {
  return (N / TWO_PI) * (rhoSoil - rhoConcrete) * acoshTerm(LG / rb);
}

/** Heat dissipation coefficient for cables in free air: h = Z/(De*)^g + E, De* in m */
export function airH(Z: number, E: number, g: number, De_m: number): number {
  return Z / De_m ** g + E;
}
