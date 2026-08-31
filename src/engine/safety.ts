import type { BodyWeight } from './types';
import { surfaceDeratingFactor } from './soil';

/** Human body resistance assumed by IEEE Std 80-2013, 7.2. */
export const BODY_RESISTANCE = 1000;

/**
 * Fibrillation-current constant k = SB^0.5 from IEEE Std 80-2013, Equations (11) and (12).
 * k = 0.116 for a 50 kg body, 0.157 for a 70 kg body.
 */
export function fibrillationConstant(weight: BodyWeight): number {
  return weight === 70 ? 0.157 : 0.116;
}

/**
 * Tolerable body current IB — IEEE Std 80-2013, Equation (10): IB = k / √ts.
 * Valid for shock durations from 0.03 s to 3.0 s.
 */
export function tolerableBodyCurrent(weight: BodyWeight, shockDuration: number): number {
  return fibrillationConstant(weight) / Math.sqrt(Math.max(shockDuration, 1e-6));
}

/**
 * Resistance of one foot on the earth's surface — IEEE Std 80-2013, Equations (24)/(25),
 * simplified to Rf = 3·Cs·ρs.
 */
export function footResistance(cs: number, rhoSurface: number): number {
  return 3 * cs * rhoSurface;
}

export interface ToleranceInput {
  weight: BodyWeight;
  /** Shock duration ts, s. */
  shockDuration: number;
  /** Resistivity of the soil beneath the surface layer, Ω·m. */
  rhoSoil: number;
  /** Surface layer resistivity ρs, Ω·m. Pass 0 for native soil. */
  rhoSurface: number;
  /** Surface layer thickness hs, m. */
  surfaceThickness: number;
  /**
   * Additional resistance of each foot from footwear, Ω. IEEE Std 2778-2020, 5.4.4 permits this
   * credit only inside the plant, where access is limited to qualified personnel.
   */
  footwearResistance?: number;
  /** Additional series resistance from rated gloves for hand contact, Ω. Touch limit only. */
  gloveResistance?: number;
}

export interface ToleranceResult {
  /** Surface derating factor Cs. */
  cs: number;
  /** Effective surface resistivity used, Ω·m (equals rhoSoil for native surfacing). */
  rhoSurfaceEffective: number;
  /** Resistance of one foot including any footwear credit, Ω. */
  footResistance: number;
  /** Tolerable body current, A. */
  bodyCurrent: number;
  /** Tolerable step voltage, V. */
  stepLimit: number;
  /** Tolerable touch voltage, V. */
  touchLimit: number;
  /** Step limit with no footwear credit, V — always reported for comparison. */
  stepLimitBare: number;
  /** Touch limit with no footwear or glove credit, V. */
  touchLimitBare: number;
}

/**
 * Tolerable step and touch voltages.
 *
 * IEEE Std 80-2013 Equations (29)–(33) give, for the bare-foot case:
 *   Estep = (RB + 2·Rf)·IB = (1000 + 6·Cs·ρs)·k/√ts
 *   Etouch = (RB + Rf/2)·IB = (1000 + 1.5·Cs·ρs)·k/√ts
 *
 * Footwear resistance is applied per IEEE Std 2778-2020, 5.4.4 "by increasing the foot impedance in
 * the IEEE Std 80 compliance limit determination", i.e. Rf → Rf + Rshoe before the series (step) or
 * parallel (touch) combination. Glove resistance appears in series with the body for touch only.
 */
export function tolerableVoltages(input: ToleranceInput): ToleranceResult {
  const {
    weight,
    shockDuration,
    rhoSoil,
    rhoSurface,
    surfaceThickness,
    footwearResistance = 0,
    gloveResistance = 0,
  } = input;

  const hasSurfacing = rhoSurface > 0 && surfaceThickness > 0;
  const rhoS = hasSurfacing ? rhoSurface : rhoSoil;
  const cs = hasSurfacing ? surfaceDeratingFactor(rhoSoil, rhoSurface, surfaceThickness) : 1;

  const rfBare = footResistance(cs, rhoS);
  const rf = rfBare + footwearResistance;
  const ib = tolerableBodyCurrent(weight, shockDuration);

  return {
    cs,
    rhoSurfaceEffective: rhoS,
    footResistance: rf,
    bodyCurrent: ib,
    stepLimit: (BODY_RESISTANCE + 2 * rf) * ib,
    touchLimit: (BODY_RESISTANCE + gloveResistance + rf / 2) * ib,
    stepLimitBare: (BODY_RESISTANCE + 2 * rfBare) * ib,
    touchLimitBare: (BODY_RESISTANCE + rfBare / 2) * ib,
  };
}
