import type { SoilLayer, TraversePoint } from './types';

/**
 * Apparent resistivity from a Wenner four-pin traverse, IEEE Std 81.
 * For electrode depth b small relative to spacing a, ρa = 2·π·a·R.
 */
export function wennerApparentResistivity(spacing: number, resistance: number): number {
  return 2 * Math.PI * spacing * resistance;
}

/**
 * Apparent resistivity of a two-layer earth over a Wenner array (Sunde / Tagg series).
 *
 * ρa(a) = ρ1 · { 1 + 4·Σ_{n=1..∞} K^n · [ 1/√(1+(2nh/a)²) − 1/√(4+(2nh/a)²) ] }
 * with the reflection coefficient K = (ρ2 − ρ1)/(ρ2 + ρ1).
 */
export function twoLayerApparentResistivity(
  spacing: number,
  rho1: number,
  rho2: number,
  h: number,
  terms = 200,
): number {
  if (spacing <= 0) return rho1;
  const K = (rho2 - rho1) / (rho2 + rho1);
  let sum = 0;
  let Kn = 1;
  for (let n = 1; n <= terms; n++) {
    Kn *= K;
    if (Math.abs(Kn) < 1e-14) break;
    const r = (2 * n * h) / spacing;
    const t = 1 / Math.sqrt(1 + r * r) - 1 / Math.sqrt(4 + r * r);
    sum += Kn * t;
  }
  return rho1 * (1 + 4 * sum);
}

export interface TwoLayerFit {
  rho1: number;
  rho2: number;
  h: number;
  /** Root-mean-square relative error of the fit, as a fraction. */
  rmsError: number;
  pointCount: number;
}

/**
 * Least-squares fit of a two-layer earth model to a set of Wenner measurements.
 *
 * Uses a coarse logarithmic sweep over (ρ1, ρ2, h) followed by a Nelder–Mead refinement in log
 * space, which keeps every parameter positive and handles the several-decade range that soil
 * resistivity spans on a real site.
 */
export function fitTwoLayer(points: TraversePoint[]): TwoLayerFit | null {
  const data = points
    .filter((p) => p.spacing > 0 && Number.isFinite(p.resistance))
    .map((p) => ({ a: p.spacing, rhoA: wennerApparentResistivity(p.spacing, p.resistance) }))
    .filter((p) => p.rhoA > 0)
    .sort((x, y) => x.a - y.a);

  if (data.length < 3) return null;

  const objective = (logParams: number[]): number => {
    const [l1, l2, lh] = logParams;
    const rho1 = Math.exp(l1);
    const rho2 = Math.exp(l2);
    const h = Math.exp(lh);
    if (!Number.isFinite(rho1) || !Number.isFinite(rho2) || !Number.isFinite(h)) return 1e12;
    let acc = 0;
    for (const d of data) {
      const model = twoLayerApparentResistivity(d.a, rho1, rho2, h);
      if (!Number.isFinite(model) || model <= 0) return 1e12;
      const rel = (model - d.rhoA) / d.rhoA;
      acc += rel * rel;
    }
    return acc / data.length;
  };

  const rhoValues = data.map((d) => d.rhoA);
  const rhoMin = Math.min(...rhoValues);
  const rhoMax = Math.max(...rhoValues);
  const aMin = data[0].a;
  const aMax = data[data.length - 1].a;

  // Coarse sweep to find a good starting simplex.
  let best: number[] = [Math.log(rhoValues[0]), Math.log(rhoValues[rhoValues.length - 1]), Math.log(aMin)];
  let bestVal = objective(best);
  const lo = Math.log(Math.max(rhoMin * 0.3, 0.1));
  const hi = Math.log(rhoMax * 3);
  const hLo = Math.log(Math.max(aMin * 0.2, 0.05));
  const hHi = Math.log(aMax * 1.5);
  const N = 12;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      for (let k = 0; k <= N; k++) {
        const cand = [
          lo + ((hi - lo) * i) / N,
          lo + ((hi - lo) * j) / N,
          hLo + ((hHi - hLo) * k) / N,
        ];
        const v = objective(cand);
        if (v < bestVal) {
          bestVal = v;
          best = cand;
        }
      }
    }
  }

  const refined = nelderMead(objective, best, 0.25, 4000);
  const [rho1, rho2, h] = refined.x.map(Math.exp);

  return {
    rho1,
    rho2,
    h,
    rmsError: Math.sqrt(refined.fx),
    pointCount: data.length,
  };
}

/** Minimal Nelder–Mead simplex minimiser for small unconstrained problems. */
function nelderMead(
  f: (x: number[]) => number,
  start: number[],
  step: number,
  maxIter: number,
): { x: number[]; fx: number } {
  const n = start.length;
  const simplex: { x: number[]; fx: number }[] = [{ x: [...start], fx: f(start) }];
  for (let i = 0; i < n; i++) {
    const x = [...start];
    x[i] += step;
    simplex.push({ x, fx: f(x) });
  }

  const alpha = 1;
  const gamma = 2;
  const rho = 0.5;
  const sigma = 0.5;

  for (let iter = 0; iter < maxIter; iter++) {
    simplex.sort((a, b) => a.fx - b.fx);
    const bestPt = simplex[0];
    const worst = simplex[n];
    if (Math.abs(worst.fx - bestPt.fx) < 1e-12) break;

    const centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) centroid[j] += simplex[i].x[j] / n;
    }

    const reflect = centroid.map((c, j) => c + alpha * (c - worst.x[j]));
    const fr = f(reflect);

    if (fr < simplex[0].fx) {
      const expand = centroid.map((c, j) => c + gamma * (reflect[j] - c));
      const fe = f(expand);
      simplex[n] = fe < fr ? { x: expand, fx: fe } : { x: reflect, fx: fr };
    } else if (fr < simplex[n - 1].fx) {
      simplex[n] = { x: reflect, fx: fr };
    } else {
      const contract = centroid.map((c, j) => c + rho * (worst.x[j] - c));
      const fc = f(contract);
      if (fc < worst.fx) {
        simplex[n] = { x: contract, fx: fc };
      } else {
        for (let i = 1; i <= n; i++) {
          const x = simplex[i].x.map((v, j) => simplex[0].x[j] + sigma * (v - simplex[0].x[j]));
          simplex[i] = { x, fx: f(x) };
        }
      }
    }
  }

  simplex.sort((a, b) => a.fx - b.fx);
  return simplex[0];
}

/**
 * Combine a local short traverse with a nearby long traverse into a single model, following the
 * methodology of IEEE Std 2778-2020, 5.1.2 and its Table 1: upper layers come from the short
 * traverse (which resolves them), the bottom layer comes from the long traverse (which is the only
 * one that reaches it), and the bottom layer is placed at the total depth seen by the long traverse.
 */
export function combineTraverseModels(
  short: { rho1: number; rho2: number; h: number },
  long: { rho1: number; rho2: number; h: number },
): SoilLayer[] {
  const topThickness = short.h;
  // Total depth to the bottom layer as characterised by the long traverse.
  const bottomDepth = Math.max(long.h, topThickness + 0.1);
  return [
    { rho: short.rho1, thickness: topThickness },
    { rho: short.rho2, thickness: Math.max(bottomDepth - topThickness, 0.1) },
    { rho: long.rho2, thickness: 0 },
  ];
}

/** Resistivity of the top layer — the soil in contact with a person's feet. */
export function topLayerResistivity(soil: SoilLayer[]): number {
  return soil.length > 0 ? soil[0].rho : 100;
}

/**
 * Reduce a layered model to the single uniform resistivity that the IEEE Std 80 closed-form
 * equations require.
 *
 * IEEE Std 2778-2020, 5.4.1 is explicit that these closed forms are an approximation for a plant of
 * this size and that finite-element software is needed for the final design; this function exists to
 * make the approximation explicit and auditable rather than hidden.
 *
 * - `apparent`   evaluates the two-layer apparent-resistivity curve at a probe spacing equal to the
 *                depth of investigation. This tracks how current actually spreads and is the default.
 * - `arithmetic` thickness-weighted mean — appropriate for predominantly vertical current flow.
 * - `harmonic`   thickness-weighted conductance mean — appropriate for predominantly lateral flow.
 */
export function equivalentUniformResistivity(
  soil: SoilLayer[],
  depthOfInvestigation: number,
  method: 'apparent' | 'arithmetic' | 'harmonic' = 'apparent',
): number {
  if (soil.length === 0) return 100;
  if (soil.length === 1) return soil[0].rho;

  const depth = Math.max(depthOfInvestigation, 0.5);

  if (method === 'apparent') {
    // Collapse everything below the top layer into an equivalent lower half-space, then read the
    // two-layer curve at a = depth of investigation.
    const lower = collapseLower(soil, depth);
    return twoLayerApparentResistivity(depth, soil[0].rho, lower, soil[0].thickness);
  }

  let covered = 0;
  let arithmetic = 0;
  let conductance = 0;
  for (let i = 0; i < soil.length; i++) {
    const remaining = depth - covered;
    if (remaining <= 0) break;
    const isBottom = i === soil.length - 1;
    const t = isBottom ? remaining : Math.min(soil[i].thickness, remaining);
    arithmetic += soil[i].rho * t;
    conductance += t / soil[i].rho;
    covered += t;
  }
  if (covered <= 0) return soil[0].rho;
  return method === 'arithmetic' ? arithmetic / covered : covered / conductance;
}

/** Thickness-weighted harmonic mean of every layer below the top one, down to `depth`. */
function collapseLower(soil: SoilLayer[], depth: number): number {
  let covered = soil[0].thickness;
  let conductance = 0;
  let total = 0;
  for (let i = 1; i < soil.length; i++) {
    const remaining = depth - covered;
    if (remaining <= 0) break;
    const isBottom = i === soil.length - 1;
    const t = isBottom ? remaining : Math.min(soil[i].thickness, remaining);
    conductance += t / soil[i].rho;
    total += t;
    covered += t;
  }
  if (total <= 0) return soil[soil.length - 1].rho;
  return total / conductance;
}

/**
 * Surface layer derating factor Cs — IEEE Std 80-2013, Equation (27).
 *
 * Cs = 1 − 0.09·(1 − ρ/ρs) / (2·hs + 0.09)
 *
 * Returns 1.0 when there is no surfacing, which is the usual case across an SPP
 * (IEEE Std 2778-2020, 5.3.4).
 */
export function surfaceDeratingFactor(rhoSoil: number, rhoSurface: number, thickness: number): number {
  if (!rhoSurface || rhoSurface <= 0 || thickness <= 0) return 1;
  const cs = 1 - (0.09 * (1 - rhoSoil / rhoSurface)) / (2 * thickness + 0.09);
  return Math.min(Math.max(cs, 0), 1);
}
