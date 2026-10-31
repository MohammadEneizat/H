// Thermal resistances — IEC 60287-2-1 clause 2 (4 in the 2015 edition).
import type { Formation } from './types';

const TWO_PI = 2 * Math.PI;

/** T1 for a single-core cable: ρT/2π · ln(1 + 2t1/dc) */
export function thermalT1(rhoT: number, t1: number, dc: number): number {
  return (rhoT / TWO_PI) * Math.log(1 + (2 * t1) / dc);
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

/** Positions of the three cables (mm). Trefoil has its apex at the top. */
export function circuitPositions(formation: Formation, s: number, depth: number): Point[] {
  if (formation === 'flat') {
    return [
      { x: -s, y: depth },
      { x: 0, y: depth },
      { x: s, y: depth },
    ];
  }
  const h = s / Math.sqrt(3);
  return [
    { x: -s / 2, y: depth + h / 2 },
    { x: 0, y: depth - h },
    { x: s / 2, y: depth + h / 2 },
  ];
}

/**
 * External thermal resistance of the hottest of three equally loaded cables or ducts
 * — IEC 60287-2-1 2.2.3.
 *
 * Touching trefoil and touching flat groups use the closed formulas of 2.2.3.2.
 * Spaced groups use superposition with image sources (Kennelly), which for flat
 * formation reduces to ρ/2π · ln{(u + √(u² − 1))·[1 + (2L/s1)²]}.
 */
export function groupT4(
  rho: number,
  D: number,
  positions: Point[],
  formation: Formation,
  touching: boolean,
  centreDepth: number,
): { T4: number; hottest: number; method: string } {
  if (touching) {
    const u = (2 * centreDepth) / D;
    if (formation === 'trefoil') {
      return {
        T4: (1.5 / Math.PI) * rho * (Math.log(2 * u) - 0.63),
        hottest: 1,
        method: 'Trefoil, touching: T4 = 1.5/π·ρ·[ln(2u) − 0.630]',
      };
    }
    return {
      T4: rho * (0.475 * Math.log(2 * u) - 0.346),
      hottest: 1,
      method: 'Flat, touching (centre cable): T4 = ρ·[0.475·ln(2u) − 0.346]',
    };
  }
  let best = -Infinity;
  let hottest = 0;
  positions.forEach((p, i) => {
    let sum = acoshTerm((2 * p.y) / D);
    positions.forEach((q, k) => {
      if (k === i) return;
      const dpk = Math.hypot(p.x - q.x, p.y - q.y);
      const dpkImage = Math.hypot(p.x - q.x, p.y + q.y);
      sum += Math.log(dpkImage / dpk);
    });
    const T4 = (rho / TWO_PI) * sum;
    if (T4 > best) {
      best = T4;
      hottest = i;
    }
  });
  return {
    T4: best,
    hottest,
    method: 'Spaced group, superposition: T4 = ρ/2π·ln{(u + √(u² − 1))·Π(d′pk/dpk)}',
  };
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
