/**
 * Fault-current processing — IEEE Std 80-2013 Clause 15, with the SPP qualifications of
 * IEEE Std 2778-2020, 5.2.
 */

/**
 * DC offset time constant Ta = (X/R) / (2·π·f), s — IEEE Std 80-2013, Equation (78).
 */
export function dcTimeConstant(xOverR: number, frequency = 60): number {
  return xOverR / (2 * Math.PI * frequency);
}

/**
 * Decrement factor Df — IEEE Std 80-2013, Equation (79):
 *
 *   Df = √( 1 + (Ta/tf)·(1 − e^(−2·tf/Ta)) )
 *
 * Accounts for the dc offset of the asymmetrical fault current over the fault duration tf.
 */
export function decrementFactor(faultDuration: number, xOverR: number, frequency = 60): number {
  if (faultDuration <= 0) return 1;
  const ta = dcTimeConstant(xOverR, frequency);
  if (ta <= 0) return 1;
  const ratio = ta / faultDuration;
  return Math.sqrt(1 + ratio * (1 - Math.exp((-2 * faultDuration) / ta)));
}

export interface GridCurrentResult {
  /** Symmetrical grid current Ig = Sf · 3I0, A. */
  symmetricalGridCurrent: number;
  /** Decrement factor Df. */
  decrementFactor: number;
  /** Maximum grid current IG = Df · Sf · 3I0, A. */
  maxGridCurrent: number;
  /** DC time constant Ta, s. */
  dcTimeConstant: number;
}

/**
 * Maximum grid current IG — IEEE Std 80-2013, Equation (77): IG = Df · Ig, with Ig = Sf · 3I0.
 *
 * IEEE Std 2778-2020, 5.2.2: split factors inside an SPP are typically high (around 90%) and the
 * pre-computed Annex C curves of IEEE Std 80 are not applicable, because they neglect the impedance
 * of the grounding conductors between the fault and the transmission line terminations — a value
 * that "can reach several ohms" in parts of a plant far from the substation. Sf = 1.0 is the
 * conservative default; anything less should come from a detailed model.
 */
export function gridCurrent(
  faultCurrent: number,
  splitFactor: number,
  faultDuration: number,
  xOverR: number,
  frequency = 60,
): GridCurrentResult {
  const df = decrementFactor(faultDuration, xOverR, frequency);
  const ig = faultCurrent * splitFactor;
  return {
    symmetricalGridCurrent: ig,
    decrementFactor: df,
    maxGridCurrent: ig * df,
    dcTimeConstant: dcTimeConstant(xOverR, frequency),
  };
}
