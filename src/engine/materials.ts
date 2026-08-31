/**
 * Conductor material constants — IEEE Std 80-2013, Table 1.
 *
 * alphaR  thermal coefficient of resistivity at 20 °C           [1/°C]
 * K0      1/alpha0 - 20                                          [°C]
 * Tm      fusing / maximum allowable temperature                 [°C]
 * rhoR    resistivity of the conductor at 20 °C                  [µΩ·cm]
 * TCAP    thermal capacity per unit volume                       [J/(cm³·°C)]
 */
export interface ConductorMaterial {
  id: string;
  name: string;
  /** Conductivity as a percentage of IACS copper. */
  conductivityPct: number;
  alphaR: number;
  K0: number;
  Tm: number;
  rhoR: number;
  TCAP: number;
  /** Bulk resistivity at 20 °C in Ω·m, derived from rhoR. Used for I·R drop along runs. */
  resistivityOhmM: number;
}

function mat(
  id: string,
  name: string,
  conductivityPct: number,
  alphaR: number,
  K0: number,
  Tm: number,
  rhoR: number,
  TCAP: number,
): ConductorMaterial {
  // 1 µΩ·cm = 1e-8 Ω·m
  return { id, name, conductivityPct, alphaR, K0, Tm, rhoR, TCAP, resistivityOhmM: rhoR * 1e-8 };
}

export const CONDUCTOR_MATERIALS: ConductorMaterial[] = [
  mat('cu-annealed', 'Copper, annealed soft-drawn', 100, 0.00393, 234, 1083, 1.72, 3.42),
  mat('cu-hard', 'Copper, commercial hard-drawn', 97, 0.00381, 242, 1084, 1.78, 3.42),
  mat('cu-hard-brazed', 'Copper, hard-drawn (brazed joints, 250 °C)', 97, 0.00381, 242, 250, 1.78, 3.42),
  mat('ccs-40', 'Copper-clad steel wire, 40%', 40, 0.00378, 245, 1084, 4.4, 3.85),
  mat('ccs-30', 'Copper-clad steel wire, 30%', 30, 0.00378, 245, 1084, 5.86, 3.85),
  mat('ccs-rod-20', 'Copper-clad steel rod, 20%', 20, 0.00378, 245, 1084, 8.62, 3.85),
  mat('al-ec', 'Aluminum, EC grade', 61, 0.00403, 228, 657, 2.86, 2.56),
  mat('al-5005', 'Aluminum, 5005 alloy', 53.5, 0.00353, 263, 652, 3.22, 2.6),
  mat('al-6201', 'Aluminum, 6201 alloy', 52.5, 0.00347, 268, 654, 3.28, 2.6),
  mat('acs', 'Aluminum-clad steel wire', 20.3, 0.0036, 258, 657, 8.48, 3.58),
  mat('steel-1020', 'Steel, 1020', 10.8, 0.0016, 605, 1510, 15.9, 3.28),
  mat('ss-clad-rod', 'Stainless-clad steel rod', 9.8, 0.0016, 605, 1400, 17.5, 4.44),
  mat('zn-steel-rod', 'Zinc-coated steel rod', 8.6, 0.0032, 293, 419, 20.1, 3.93),
  mat('ss-304', 'Stainless steel 304', 2.4, 0.0013, 749, 1400, 72.0, 4.03),
];

export function getMaterial(id: string): ConductorMaterial {
  const m = CONDUCTOR_MATERIALS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown conductor material: ${id}`);
  return m;
}

/**
 * Typical resistivities of surfacing materials, IEEE Std 80-2013 Table 7 (dry / wet ranges).
 * IEEE Std 2778-2020, 5.3.4 notes surfacing is usually applied only in localized areas of an SPP,
 * so "native soil" is offered as the default case.
 */
export interface SurfaceMaterial {
  id: string;
  name: string;
  /** Representative wet resistivity, Ω·m. Wet values are the conservative design basis. */
  wet: number;
  dry: number;
}

export const SURFACE_MATERIALS: SurfaceMaterial[] = [
  { id: 'native', name: 'Native soil (no surfacing)', wet: 0, dry: 0 },
  { id: 'crusher-run', name: 'Crusher run granite w/ fines', wet: 1000, dry: 140_000_000 },
  { id: 'granite-15', name: 'Granite chips, 1.5 in (washed)', wet: 5000, dry: 40_000_000 },
  { id: 'granite-075', name: 'Granite chips, 0.75 in (washed)', wet: 3000, dry: 4_000_000 },
  { id: 'limestone-075', name: 'Limestone, 0.75 in (washed)', wet: 2000, dry: 7_000_000 },
  { id: 'gravel-washed', name: 'Washed gravel, 0.75–1 in', wet: 5000, dry: 2_000_000 },
  { id: 'asphalt', name: 'Asphalt', wet: 10_000, dry: 2_000_000 },
  { id: 'concrete', name: 'Concrete', wet: 100, dry: 1_000_000 },
];

/**
 * IEEE Std 2778-2020, 5.4.4: footwear resistance may be credited inside the plant, where access is
 * limited to qualified personnel. "Common values used are in the range of 1000 Ω to 2000 Ω."
 */
export const FOOTWEAR_PRESETS = [
  { id: 'none', name: 'No footwear credit (IEEE Std 80 default)', ohms: 0 },
  { id: 'work-1000', name: 'Work boots — conservative (1000 Ω)', ohms: 1000 },
  { id: 'work-2000', name: 'Work boots — typical (2000 Ω)', ohms: 2000 },
  { id: 'ehv-rated', name: 'Electrical-hazard rated footwear (custom)', ohms: 0 },
];

/** Bare stranded copper conductor sizes commonly used for grounding grids. */
export interface ConductorSize {
  id: string;
  awg: string;
  areaMm2: number;
  /** Overall diameter of the stranded conductor, m. */
  diameterM: number;
}

export const COPPER_SIZES: ConductorSize[] = [
  { id: '8', awg: '8 AWG', areaMm2: 8.37, diameterM: 0.00329 },
  { id: '6', awg: '6 AWG', areaMm2: 13.3, diameterM: 0.00417 },
  { id: '4', awg: '4 AWG', areaMm2: 21.2, diameterM: 0.00589 },
  { id: '2', awg: '2 AWG', areaMm2: 33.6, diameterM: 0.00742 },
  { id: '1/0', awg: '1/0 AWG', areaMm2: 53.5, diameterM: 0.00935 },
  { id: '2/0', awg: '2/0 AWG', areaMm2: 67.4, diameterM: 0.0105 },
  { id: '4/0', awg: '4/0 AWG', areaMm2: 107.2, diameterM: 0.0132 },
  { id: '250', awg: '250 kcmil', areaMm2: 126.7, diameterM: 0.0144 },
  { id: '350', awg: '350 kcmil', areaMm2: 177.3, diameterM: 0.017 },
  { id: '500', awg: '500 kcmil', areaMm2: 253.4, diameterM: 0.0203 },
];
