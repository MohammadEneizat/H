import { getMaterial } from './materials';

export interface SizingResult {
  /** Required cross-section, mm². */
  areaMm2: number;
  /** Required cross-section, kcmil. */
  areaKcmil: number;
  /** Equivalent solid-conductor diameter, mm. */
  diameterMm: number;
  materialName: string;
  /** Maximum temperature actually used, °C. */
  maxTemp: number;
}

/**
 * Ground conductor sizing — IEEE Std 80-2013, Equation (37):
 *
 *   Amm² = I / √( (TCAP·10⁻⁴ / (tc·αr·ρr)) · ln((K0 + Tm)/(K0 + Ta)) )
 *
 * with I in kA. This is the thermal (fusing) requirement; the mechanical minimum for a buried
 * grid — commonly 2/0 AWG copper — governs in most SPP designs and is reported alongside.
 */
export function sizeConductor(
  currentAmps: number,
  durationSec: number,
  materialId: string,
  ambientTemp: number,
  maxTemp?: number,
): SizingResult {
  const m = getMaterial(materialId);
  const tm = maxTemp && maxTemp > 0 ? Math.min(maxTemp, m.Tm) : m.Tm;
  const iKa = currentAmps / 1000;

  const denom = Math.sqrt(
    ((m.TCAP * 1e-4) / (durationSec * m.alphaR * m.rhoR)) * Math.log((m.K0 + tm) / (m.K0 + ambientTemp)),
  );
  const areaMm2 = iKa / denom;

  return {
    areaMm2,
    areaKcmil: areaMm2 * 1.97352524,
    diameterMm: 2 * Math.sqrt(areaMm2 / Math.PI),
    materialName: m.name,
    maxTemp: tm,
  };
}

/**
 * Longitudinal I·R drop along a grounding run.
 *
 * IEEE Std 2778-2020, 5.4.1 identifies this as the reason hand calculations and simple solid-disk
 * models fail on a solar plant: with grid spacing above 100 m "the resistance of the conductor from
 * one portion of the plant to another can greatly exceed the resistance to remote earth, which often
 * is in the tenths of an ohm or less." Clause 4.3 makes the same point for steel array frames, whose
 * resistivity is far higher than copper.
 *
 * The dc resistance is used deliberately: at 50/60 Hz the skin effect on a 2/0–4/0 conductor is
 * under a few percent, and the result is a lower bound on the true drop.
 */
export function conductorVoltageDrop(
  currentAmps: number,
  lengthM: number,
  areaMm2: number,
  materialId: string,
  conductorTemp = 20,
): { resistance: number; drop: number; resistancePerKm: number } {
  const m = getMaterial(materialId);
  const rho20 = m.resistivityOhmM;
  // Temperature correction: ρ(T) = ρ20 · (1 + αr·(T − 20))
  const rho = rho20 * (1 + m.alphaR * (conductorTemp - 20));
  const areaM2 = areaMm2 * 1e-6;
  const resistance = areaM2 > 0 ? (rho * lengthM) / areaM2 : 0;
  return {
    resistance,
    drop: resistance * currentAmps,
    resistancePerKm: areaM2 > 0 ? (rho * 1000) / areaM2 : 0,
  };
}
