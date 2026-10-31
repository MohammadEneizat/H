// Material data used by the IEC 60287 calculations.
//
// Sources (clause numbers refer to IEC 60287-1-1:2006+A1:2014 and
// IEC 60287-2-1:2015 unless stated otherwise). Every value can be overridden
// from the cable / installation inputs, so datasheet values always win.

export type MetalKey = 'Cu' | 'Al' | 'Pb' | 'steel' | 'bronze' | 'stainless';

export interface MetalData {
  label: string;
  /** Electrical resistivity at 20 °C (Ω·m) — IEC 60287-1-1 Table 1 */
  rho20: number;
  /** Temperature coefficient of resistance at 20 °C (1/K) — IEC 60287-1-1 Table 1 */
  alpha20: number;
}

export const METALS: Record<MetalKey, MetalData> = {
  Cu: { label: 'Copper', rho20: 1.7241e-8, alpha20: 3.93e-3 },
  Al: { label: 'Aluminium', rho20: 2.8264e-8, alpha20: 4.03e-3 },
  Pb: { label: 'Lead / lead alloy', rho20: 21.4e-8, alpha20: 4.0e-3 },
  steel: { label: 'Steel', rho20: 13.8e-8, alpha20: 4.5e-3 },
  bronze: { label: 'Bronze', rho20: 3.5e-8, alpha20: 3.0e-3 },
  stainless: { label: 'Stainless steel', rho20: 70e-8, alpha20: 0 },
};

export type InsulationKey =
  | 'XLPE-MV'
  | 'XLPE-HV'
  | 'XLPE-filled-HV'
  | 'EPR-MV'
  | 'EPR-HV'
  | 'PE'
  | 'PVC-LV'
  | 'PVC-MV'
  | 'paper';

export interface InsulationData {
  label: string;
  /** Thermal resistivity (K·m/W) — IEC 60287-2-1 Table 1 */
  rhoT: number;
  /** Relative permittivity — IEC 60287-1-1 Table 3 */
  epsR: number;
  /** Loss factor tan δ — IEC 60287-1-1 Table 3 */
  tanDelta: number;
  /** U0 (kV) at and above which dielectric losses must be included — IEC 60287-1-1 Table 3 */
  wdThreshold_kV: number;
  /** Typical maximum continuous conductor temperature (°C) */
  maxTemp_C: number;
  /** Conductor insulation system, used to pick ks / kp in Table 2 */
  system: 'extruded' | 'paper';
}

export const INSULATIONS: Record<InsulationKey, InsulationData> = {
  'XLPE-MV': {
    label: 'XLPE (unfilled), up to 18/30 kV',
    rhoT: 3.5,
    epsR: 2.5,
    tanDelta: 0.004,
    wdThreshold_kV: 127,
    maxTemp_C: 90,
    system: 'extruded',
  },
  'XLPE-HV': {
    label: 'XLPE (unfilled), above 18/30 kV',
    rhoT: 3.5,
    epsR: 2.5,
    tanDelta: 0.001,
    wdThreshold_kV: 127,
    maxTemp_C: 90,
    system: 'extruded',
  },
  'XLPE-filled-HV': {
    label: 'XLPE (filled), above 18/30 kV',
    rhoT: 3.5,
    epsR: 3.0,
    tanDelta: 0.005,
    wdThreshold_kV: 63.5,
    maxTemp_C: 90,
    system: 'extruded',
  },
  'EPR-MV': {
    label: 'EPR, up to 18/30 kV',
    rhoT: 5.0,
    epsR: 3.0,
    tanDelta: 0.02,
    wdThreshold_kV: 63.5,
    maxTemp_C: 90,
    system: 'extruded',
  },
  'EPR-HV': {
    label: 'EPR, above 18/30 kV',
    rhoT: 5.0,
    epsR: 3.0,
    tanDelta: 0.005,
    wdThreshold_kV: 63.5,
    maxTemp_C: 90,
    system: 'extruded',
  },
  PE: {
    label: 'PE (HD / LD)',
    rhoT: 3.5,
    epsR: 2.3,
    tanDelta: 0.001,
    wdThreshold_kV: 127,
    maxTemp_C: 70,
    system: 'extruded',
  },
  'PVC-LV': {
    label: 'PVC, cables up to 3 kV',
    rhoT: 5.0,
    epsR: 8.0,
    tanDelta: 0.1,
    wdThreshold_kV: 6,
    maxTemp_C: 70,
    system: 'extruded',
  },
  'PVC-MV': {
    label: 'PVC, cables above 3 kV',
    rhoT: 6.0,
    epsR: 8.0,
    tanDelta: 0.1,
    wdThreshold_kV: 6,
    maxTemp_C: 70,
    system: 'extruded',
  },
  paper: {
    label: 'Impregnated paper (solid type)',
    rhoT: 6.0,
    epsR: 4.0,
    tanDelta: 0.01,
    wdThreshold_kV: 38,
    maxTemp_C: 65,
    system: 'paper',
  },
};

export type JacketKey = 'PE' | 'PVC-35' | 'PVC-HV' | 'PCP' | 'custom';

export interface JacketData {
  label: string;
  /** Thermal resistivity (K·m/W) — IEC 60287-2-1 Table 1 */
  rhoT: number;
  /** Absorption coefficient of solar radiation — IEC 60287-1-1 Table 4 */
  solarAbsorption: number;
}

export const JACKETS: Record<JacketKey, JacketData> = {
  PE: { label: 'Polyethylene (PE)', rhoT: 3.5, solarAbsorption: 0.4 },
  'PVC-35': { label: 'PVC, cables up to 35 kV', rhoT: 5.0, solarAbsorption: 0.6 },
  'PVC-HV': { label: 'PVC, cables above 35 kV', rhoT: 6.0, solarAbsorption: 0.6 },
  PCP: { label: 'Polychloroprene', rhoT: 5.5, solarAbsorption: 0.8 },
  custom: { label: 'Other (enter ρ)', rhoT: 3.5, solarAbsorption: 0.6 },
};

export type DuctKey = 'PVC' | 'PE' | 'earthenware' | 'fibre-concrete' | 'asbestos-concrete';

export interface DuctData {
  label: string;
  /** Thermal resistivity of duct wall (K·m/W) — IEC 60287-2-1 Table 1 */
  rho: number;
  /** Constants for T4' (air space between cable and duct) — IEC 60287-2-1 Table 4 */
  U: number;
  V: number;
  Y: number;
}

export const DUCTS: Record<DuctKey, DuctData> = {
  PVC: { label: 'PVC duct', rho: 6.0, U: 1.87, V: 0.312, Y: 0.0037 },
  PE: { label: 'PE / HDPE duct', rho: 3.5, U: 1.87, V: 0.312, Y: 0.0037 },
  earthenware: { label: 'Earthenware duct', rho: 1.2, U: 1.87, V: 0.28, Y: 0.0036 },
  'fibre-concrete': { label: 'Fibre duct in concrete', rho: 4.8, U: 5.2, V: 0.91, Y: 0.01 },
  'asbestos-concrete': {
    label: 'Asbestos-cement duct in concrete',
    rho: 2.0,
    U: 5.2,
    V: 1.1,
    Y: 0.011,
  },
};

export type AirArrangement =
  | 'trefoil'
  | 'flat-horizontal'
  | 'flat-vertical'
  | 'flat-vertical-spaced'
  | 'isolated';

export interface AirConstants {
  label: string;
  Z: number;
  E: number;
  g: number;
  formation: 'trefoil' | 'flat';
  /** Axial spacing between cables as a multiple of De, or null when entered by the user */
  spacingFactor: number | null;
}

/** Constants for the heat dissipation coefficient h — IEC 60287-2-1 Table 2 (black surfaces, free air). */
export const AIR_CONSTANTS: Record<AirArrangement, AirConstants> = {
  trefoil: {
    label: 'Three cables in trefoil, touching',
    Z: 0.96,
    E: 1.25,
    g: 0.2,
    formation: 'trefoil',
    spacingFactor: 1,
  },
  'flat-horizontal': {
    label: 'Three cables touching, horizontal',
    Z: 0.62,
    E: 1.95,
    g: 0.25,
    formation: 'flat',
    spacingFactor: 1,
  },
  'flat-vertical': {
    label: 'Three cables touching, vertical',
    Z: 1.61,
    E: 0.42,
    g: 0.2,
    formation: 'flat',
    spacingFactor: 1,
  },
  'flat-vertical-spaced': {
    label: 'Three cables vertical, clearance De',
    Z: 1.31,
    E: 2.0,
    g: 0.2,
    formation: 'flat',
    spacingFactor: 2,
  },
  isolated: {
    label: 'Spaced cables, treated as isolated',
    Z: 0.21,
    E: 3.94,
    g: 0.6,
    formation: 'flat',
    spacingFactor: null,
  },
};

export type ConductorMaterial = 'Cu' | 'Al';
export type ConductorConstruction = 'stranded' | 'solid' | 'milliken';
export type MillikenWires = 'insulated' | 'bare-uni' | 'bare-bi';

/**
 * Skin and proximity effect coefficients ks, kp — IEC 60287-1-1 Table 2
 * (as amended in 2014 for Milliken conductors with extruded insulation).
 * Aluminium kp: the standard recommends using the values for analogous copper conductors.
 */
export function defaultSkinProximity(
  material: ConductorMaterial,
  construction: ConductorConstruction,
  system: 'extruded' | 'paper',
  wires: MillikenWires,
): { ks: number; kp: number } {
  if (construction === 'milliken') {
    if (material === 'Cu') {
      if (system === 'paper') return { ks: 0.435, kp: 0.37 };
      const ks = wires === 'insulated' ? 0.35 : wires === 'bare-uni' ? 0.62 : 0.8;
      return { ks, kp: 0.37 };
    }
    return { ks: system === 'paper' ? 0.28 : 0.25, kp: 0.37 };
  }
  if (construction === 'solid') return { ks: 1, kp: 1 };
  return { ks: 1, kp: system === 'paper' ? 0.8 : 1 };
}
