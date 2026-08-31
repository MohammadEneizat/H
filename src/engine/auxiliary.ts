/**
 * Auxiliary grounding contributed by PV array steel — IEEE Std 2778-2020, 4.3 and 5.4.2.
 *
 * The guide's central economic point is here. Sensitivity studies cited in 5.4.2 found that
 * "not modeling any auxiliary grounding would have resulted in grid spacing about three times as
 * dense on several large-scale projects, using nine times the grounding material for a compliant
 * design." Driven array posts in solid electrical contact with native soil behave as short ground
 * rods; the module below values that contribution and reduces it to the "equivalent ground rod" the
 * guide describes for the hybrid modelling method.
 */

/**
 * Self-resistance of a single vertical rod of length L and diameter d in uniform soil:
 *
 *   R = ρ/(2πL) · [ ln(8L/d) − 1 ]
 */
export function rodResistance(rho: number, length: number, diameter: number): number {
  if (length <= 0 || diameter <= 0) return Number.POSITIVE_INFINITY;
  return (rho / (2 * Math.PI * length)) * (Math.log((8 * length) / diameter) - 1);
}

/**
 * Mutual resistance between two parallel vertical rods of length L separated by s:
 *
 *   Rm = ρ/(2πL) · [ ln((L + √(L² + s²))/s) + s/L − √(1 + s²/L²) ]
 *
 * This is the term IEEE Std 2778-2020, 5.4.2 warns must not be omitted: "This value needs to include
 * the mutual resistance between ground conductors which can be a significant contributor to the
 * overall resistance of an equivalent."
 */
export function rodMutualResistance(rho: number, length: number, separation: number): number {
  if (length <= 0 || separation <= 0) return 0;
  const L = length;
  const s = separation;
  return (
    (rho / (2 * Math.PI * L)) *
    (Math.log((L + Math.sqrt(L * L + s * s)) / s) + s / L - Math.sqrt(1 + (s * s) / (L * L)))
  );
}

export interface RodBedResult {
  /** Number of electrodes actually credited (after the soil-contact derating). */
  effectiveCount: number;
  /** Resistance of one isolated electrode, Ω. */
  singleRodResistance: number;
  /** Resistance of the whole assembly including mutual coupling, Ω. */
  assemblyResistance: number;
  /** Ratio of assembly resistance to the ideal 1/n value — the coupling penalty. */
  couplingFactor: number;
  /** Length of the single rod that would present the same resistance, m. */
  equivalentRodLength: number;
  /** Diameter assumed for the equivalent rod, m. */
  equivalentRodDiameter: number;
}

/**
 * Resistance of a square-ish array of n equally loaded parallel rods on a uniform pitch.
 *
 * With the equal-current assumption, R_assembly = (1/n²)·ΣΣ R_ij, where the diagonal terms are the
 * self-resistances and the off-diagonal terms the mutual resistances. Distances are taken from an
 * idealised square lattice at the given pitch, which is how PV posts are actually laid out.
 */
export function rodBedResistance(
  rho: number,
  count: number,
  length: number,
  diameter: number,
  spacing: number,
): number {
  const n = Math.max(Math.floor(count), 0);
  if (n === 0) return Number.POSITIVE_INFINITY;
  const self = rodResistance(rho, length, diameter);
  if (n === 1) return self;

  const side = Math.max(Math.round(Math.sqrt(n)), 1);
  const positions: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    positions.push({ x: (i % side) * spacing, y: Math.floor(i / side) * spacing });
  }

  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        sum += self;
      } else {
        const s = Math.hypot(positions[i].x - positions[j].x, positions[i].y - positions[j].y);
        sum += rodMutualResistance(rho, length, s);
      }
    }
  }
  return sum / (n * n);
}

/**
 * Reduce a block of PV array posts to a single equivalent ground rod — the hybrid method of
 * IEEE Std 2778-2020, 5.4.2: "A ground rod length can be determined to match this resistance and
 * installed in the model in place of the detailed array."
 *
 * `contactFraction` derates the post count for posts that are coated, set in gravel backfill, or
 * otherwise not in solid contact with native soil (4.3).
 */
export function blockEquivalentRod(
  rho: number,
  postCount: number,
  postLength: number,
  postDiameter: number,
  postSpacing: number,
  contactFraction = 1,
): RodBedResult {
  const effectiveCount = Math.max(Math.round(postCount * clamp(contactFraction, 0, 1)), 0);
  const single = rodResistance(rho, postLength, postDiameter);

  if (effectiveCount === 0) {
    return {
      effectiveCount: 0,
      singleRodResistance: single,
      assemblyResistance: Number.POSITIVE_INFINITY,
      couplingFactor: Number.NaN,
      equivalentRodLength: 0,
      equivalentRodDiameter: postDiameter,
    };
  }

  const assembly = rodBedResistance(rho, effectiveCount, postLength, postDiameter, postSpacing);
  const ideal = single / effectiveCount;

  return {
    effectiveCount,
    singleRodResistance: single,
    assemblyResistance: assembly,
    couplingFactor: ideal > 0 ? assembly / ideal : Number.NaN,
    equivalentRodLength: solveRodLengthForResistance(rho, assembly, postDiameter),
    equivalentRodDiameter: postDiameter,
  };
}

/**
 * Invert R = ρ/(2πL)·[ln(8L/d) − 1] for L by bisection. The function is monotonically decreasing in
 * L over the range of interest, so bisection is both safe and sufficient.
 */
export function solveRodLengthForResistance(rho: number, target: number, diameter: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  let lo = Math.max(diameter * 2, 0.01);
  let hi = 10;
  // Expand the upper bound until the resistance drops below the target.
  for (let i = 0; i < 60 && rodResistance(rho, hi, diameter) > target; i++) hi *= 2;
  if (rodResistance(rho, hi, diameter) > target) return hi;

  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (rodResistance(rho, mid, diameter) > target) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Parallel combination of the main grid resistance with the auxiliary post network.
 *
 * A first-order coupling allowance is applied: the two systems occupy the same soil volume, so their
 * parallel combination is optimistic. IEEE Std 2778-2020, 5.4.2 notes that modelling auxiliary
 * grounding local to the fault while neglecting the rest gives results that are "slightly
 * conservative, but reasonably accurate"; the factor below keeps this calculation on that side.
 */
export function combineWithAuxiliary(gridResistance: number, auxResistance: number, couplingAllowance = 1.15): number {
  if (!Number.isFinite(auxResistance) || auxResistance <= 0) return gridResistance;
  const parallel = (gridResistance * auxResistance) / (gridResistance + auxResistance);
  return Math.min(parallel * couplingAllowance, gridResistance);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
