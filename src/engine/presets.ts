import type { CableSpec, InstallationSpec } from './types';

/**
 * Example cables with typical dimensions. They are not a specific manufacturer's
 * datasheet: replace every value with the datasheet of the cable you are checking.
 */
export const EXAMPLE_CABLES: CableSpec[] = [
  {
    name: 'Example: 12/20 kV 1×240 mm² Al XLPE, Cu wire screen 25 mm²',
    U0_kV: 12,
    maxTemp_C: 90,
    conductor: {
      material: 'Al',
      construction: 'stranded',
      millikenWires: 'insulated',
      area_mm2: 240,
      diameter_mm: 18.4,
      R20_ohm_km: 0.125,
      Rac_ohm_km: null,
      ks: null,
      kp: null,
    },
    conductorScreen_mm: 0.7,
    insulation: { material: 'XLPE-MV', thickness_mm: 5.5, rhoT: null, epsR: null, tanDelta: null },
    insulationScreen_mm: 0.8,
    bedding_mm: 0.6,
    screen: {
      form: 'wires',
      material: 'Cu',
      thickness_mm: 0.8,
      wireCount: null,
      area_mm2: 25,
      R20_ohm_km: null,
      corrugationOD_mm: null,
    },
    jacket: { material: 'PE', thickness_mm: 2.5, rhoT: null },
    overallDiameter_mm: null,
  },
  {
    name: 'Example: 76/132 kV 1×1000 mm² Cu Milliken XLPE, lead sheath',
    U0_kV: 76,
    maxTemp_C: 90,
    conductor: {
      material: 'Cu',
      construction: 'milliken',
      millikenWires: 'bare-uni',
      area_mm2: 1000,
      diameter_mm: 38.0,
      R20_ohm_km: 0.0176,
      Rac_ohm_km: null,
      ks: null,
      kp: null,
    },
    conductorScreen_mm: 1.5,
    insulation: { material: 'XLPE-HV', thickness_mm: 17.0, rhoT: null, epsR: null, tanDelta: null },
    insulationScreen_mm: 1.3,
    bedding_mm: 1.6,
    screen: {
      form: 'smooth',
      material: 'Pb',
      thickness_mm: 2.7,
      wireCount: null,
      area_mm2: null,
      R20_ohm_km: null,
      corrugationOD_mm: null,
    },
    jacket: { material: 'PE', thickness_mm: 4.5, rhoT: null },
    overallDiameter_mm: null,
  },
  {
    name: 'Example: 64/110 kV 1×800 mm² Al XLPE, corrugated Al sheath',
    U0_kV: 64,
    maxTemp_C: 90,
    conductor: {
      material: 'Al',
      construction: 'stranded',
      millikenWires: 'insulated',
      area_mm2: 800,
      diameter_mm: 34.0,
      R20_ohm_km: 0.0367,
      Rac_ohm_km: null,
      ks: null,
      kp: null,
    },
    conductorScreen_mm: 1.2,
    insulation: { material: 'XLPE-HV', thickness_mm: 15.0, rhoT: null, epsR: null, tanDelta: null },
    insulationScreen_mm: 1.2,
    bedding_mm: 2.0,
    screen: {
      form: 'corrugated',
      material: 'Al',
      thickness_mm: 1.6,
      wireCount: null,
      area_mm2: 420,
      R20_ohm_km: null,
      corrugationOD_mm: 88.0,
    },
    jacket: { material: 'PE', thickness_mm: 4.0, rhoT: null },
    overallDiameter_mm: null,
  },
  {
    name: 'Example: NA2XY 0.6/1 kV 3×240 mm² SM, Al XLPE PVC (three-core)',
    U0_kV: 0.6,
    maxTemp_C: 90,
    cores: 3,
    threeCore: { shape: 'sector', innerCovering_mm: 1.2, r1_mm: null, fillerRho: null },
    conductor: {
      material: 'Al',
      construction: 'stranded',
      millikenWires: 'insulated',
      area_mm2: 240,
      diameter_mm: 18.2,
      R20_ohm_km: 0.125,
      Rac_ohm_km: null,
      ks: null,
      kp: null,
    },
    conductorScreen_mm: 0,
    insulation: { material: 'XLPE-MV', thickness_mm: 1.7, rhoT: null, epsR: null, tanDelta: null },
    insulationScreen_mm: 0,
    bedding_mm: 0,
    screen: {
      form: 'none',
      material: 'Cu',
      thickness_mm: 0,
      wireCount: null,
      area_mm2: null,
      R20_ohm_km: null,
      corrugationOD_mm: null,
    },
    jacket: { material: 'PVC-35', thickness_mm: 2.5, rhoT: null },
    overallDiameter_mm: null,
  },
  {
    name: 'Example: NA2XY 0.6/1 kV 1×240 mm² RM, Al XLPE PVC (single-core)',
    U0_kV: 0.6,
    maxTemp_C: 90,
    conductor: {
      material: 'Al',
      construction: 'stranded',
      millikenWires: 'insulated',
      area_mm2: 240,
      diameter_mm: 18.4,
      R20_ohm_km: 0.125,
      Rac_ohm_km: null,
      ks: null,
      kp: null,
    },
    conductorScreen_mm: 0,
    insulation: { material: 'XLPE-MV', thickness_mm: 1.7, rhoT: null, epsR: null, tanDelta: null },
    insulationScreen_mm: 0,
    bedding_mm: 0,
    screen: {
      form: 'none',
      material: 'Cu',
      thickness_mm: 0,
      wireCount: null,
      area_mm2: null,
      R20_ohm_km: null,
      corrugationOD_mm: null,
    },
    jacket: { material: 'PVC-35', thickness_mm: 1.8, rhoT: null },
    overallDiameter_mm: 25.8,
  },
];

export const DEFAULT_INSTALLATION: InstallationSpec = {
  type: 'direct',
  frequency_Hz: 50,
  ambient_C: 20,
  formation: 'trefoil',
  touching: true,
  spacing_mm: 100,
  transposed: false,
  bonding: 'both',
  crossBondLambda1: null,
  forceDielectric: false,
  depth_m: 0.8,
  soilRho: 1.0,
  soilModel: 'moist',
  criticalTemp_C: 50,
  dryRho: 2.5,
  duct: { material: 'PE', innerD_mm: 100, outerD_mm: 110, rho: null, U: null, V: null, Y: null },
  bank: { width_m: 0.6, height_m: 0.5, concreteRho: 1.0, centreX_m: null, centreDepth_m: null },
  circuits: [],
  ratingMode: 'own-limit',
  air: { arrangement: 'trefoil', solar: false, H: 1000, absorption: null },
};

/**
 * Prysmian TECSUN (PV) H1Z2Z2-K 1/1 kV (DC 1.5 kV) single-core solar cable, from the
 * datasheet of 2024-11-19: tinned copper class 5, HEPR insulation, EVA sheath.
 * Conductor diameter, cable diameter (mean of min and max) and DC resistance are the
 * datasheet values; the insulation thickness is the usual 0.6/1 kV value for the size and
 * the sheath is the rest of the wall. iAir is the datasheet rating (EN 50618 Table A.3,
 * single cable in free air) for comparison only.
 */
export const TECSUN_SIZES: { area: number; dc: number; odMin: number; odMax: number; R20: number; iAir: number }[] = [
  { area: 4, dc: 2.4, odMin: 5.3, odMax: 5.9, R20: 5.065, iAir: 55 },
  { area: 6, dc: 2.9, odMin: 5.8, odMax: 6.5, R20: 3.373, iAir: 70 },
  { area: 10, dc: 3.9, odMin: 7.0, odMax: 7.6, R20: 1.921, iAir: 98 },
  { area: 16, dc: 5.0, odMin: 8.5, odMax: 9.3, R20: 1.24, iAir: 132 },
  { area: 25, dc: 6.4, odMin: 10.4, odMax: 11.2, R20: 0.795, iAir: 176 },
  { area: 35, dc: 7.6, odMin: 11.7, odMax: 12.5, R20: 0.565, iAir: 218 },
  { area: 50, dc: 9.1, odMin: 13.5, odMax: 14.5, R20: 0.393, iAir: 276 },
  { area: 70, dc: 10.8, odMin: 15.5, odMax: 16.5, R20: 0.277, iAir: 347 },
  { area: 95, dc: 12.6, odMin: 17.7, odMax: 18.7, R20: 0.21, iAir: 416 },
  { area: 120, dc: 14.2, odMin: 19.2, odMax: 20.4, R20: 0.164, iAir: 488 },
  { area: 150, dc: 15.8, odMin: 21.4, odMax: 22.6, R20: 0.132, iAir: 566 },
  { area: 185, dc: 17.4, odMin: 23.7, odMax: 25.1, R20: 0.108, iAir: 644 },
  { area: 240, dc: 20.4, odMin: 27.1, odMax: 28.5, R20: 0.082, iAir: 775 },
  { area: 300, dc: 22.8, odMin: 29, odMax: 32, R20: 0.065, iAir: 876 },
  { area: 400, dc: 26.5, odMin: 33, odMax: 35, R20: 0.049, iAir: 960 },
];

/** Usual 0.6/1 kV insulation thickness for a conductor size (mm). */
const lvInsulation = (a: number) =>
  a <= 16 ? 0.7 : a <= 35 ? 0.9 : a <= 50 ? 1.0 : a <= 95 ? 1.1 : a <= 120 ? 1.2 : a <= 150 ? 1.4 : a <= 185 ? 1.6 : a <= 240 ? 1.7 : a <= 300 ? 1.8 : 2.0;

/** A TECSUN (PV) H1Z2Z2-K cable of the given size, set up for DC circuits. */
export function tecsunCable(area: number): CableSpec {
  const d = TECSUN_SIZES.find((x) => x.area === area) ?? TECSUN_SIZES[1];
  const od = (d.odMin + d.odMax) / 2;
  const ins = lvInsulation(d.area);
  const sheath = Math.max(0.5, Math.round(((od - d.dc) / 2 - ins) * 100) / 100);
  return {
    name: `Prysmian TECSUN (PV) H1Z2Z2-K 1×${d.area} mm² Cu, DC 1.5 kV`,
    U0_kV: 1,
    maxTemp_C: 90,
    system: 'dc',
    conductor: {
      material: 'Cu',
      construction: 'stranded',
      millikenWires: 'insulated',
      area_mm2: d.area,
      diameter_mm: d.dc,
      R20_ohm_km: d.R20,
      Rac_ohm_km: null,
      ks: null,
      kp: null,
    },
    conductorScreen_mm: 0,
    insulation: { material: 'EPR-MV', thickness_mm: ins, rhoT: null, epsR: null, tanDelta: null },
    insulationScreen_mm: 0,
    bedding_mm: 0,
    screen: { form: 'none', material: 'Cu', thickness_mm: 0, wireCount: null, area_mm2: null, R20_ohm_km: null, corrugationOD_mm: null },
    jacket: { material: 'EVA', thickness_mm: sheath, rhoT: null },
    overallDiameter_mm: Math.round(od * 100) / 100,
  };
}
