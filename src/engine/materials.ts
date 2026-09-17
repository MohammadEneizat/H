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
  mat('zn-steel-rod', 'Galvanised (zinc-coated) steel', 8.6, 0.0032, 293, 419, 20.1, 3.93),
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

/**
 * Equivalent diameter of a rectangular (flat strip / tape) conductor, mm.
 *
 * The IEEE Std 80 mesh and step equations take `d`, the diameter of a round conductor. A flat strip
 * is handled by substituting the diameter of the round conductor that presents the same external
 * field. For a strip of width w and thickness t that equivalent radius is (w + t)/4, so
 *
 *   d_eq = (w + t)/2
 *
 * In the thin-strip limit this reduces to d_eq = w/2, the exact classical result (the logarithmic
 * capacity of a zero-thickness strip of width w is w/4). The consequence is worth noting: a 40 × 4 mm
 * strip behaves like a 22 mm round conductor, more than twice the diameter of 2/0 copper, which
 * lowers Km and therefore the mesh voltage.
 */
export function flatStripEquivalentDiameter(widthMm: number, thicknessMm: number): number {
  return (Math.max(widthMm, 0) + Math.max(thicknessMm, 0)) / 2;
}

export type ConductorShape = 'round' | 'flat';

/** A catalogue entry for a grounding conductor. */
export interface ConductorSize {
  id: string;
  /** Display designation, e.g. "2/0 AWG" or "40 x 4 mm". */
  label: string;
  shape: ConductorShape;
  areaMm2: number;
  /**
   * Diameter used by the IEEE Std 80 equations, m. For a round conductor this is the physical
   * overall diameter; for a flat strip it is the equivalent diameter above.
   */
  diameterM: number;
  /** Strip width, mm. Flat sections only. */
  widthMm?: number;
  /** Strip thickness, mm. Flat sections only. */
  thicknessMm?: number;
  /** Material this section is normally supplied in, preselected when the size is chosen. */
  materialId: string;
  /** Short note on where the section is customary. */
  note?: string;
}

function flat(
  id: string,
  widthMm: number,
  thicknessMm: number,
  materialId: string,
  note?: string,
): ConductorSize {
  return {
    id,
    label: `${widthMm} x ${thicknessMm} mm`,
    shape: 'flat',
    areaMm2: widthMm * thicknessMm,
    diameterM: flatStripEquivalentDiameter(widthMm, thicknessMm) / 1000,
    widthMm,
    thicknessMm,
    materialId,
    note,
  };
}

function round(id: string, label: string, areaMm2: number, diameterM: number): ConductorSize {
  return { id, label, shape: 'round', areaMm2, diameterM, materialId: 'cu-annealed' };
}

/** Bare stranded copper conductor sizes, the customary choice in IEEE/NEC practice. */
export const COPPER_SIZES: ConductorSize[] = [
  round('8', '8 AWG', 8.37, 0.00329),
  round('6', '6 AWG', 13.3, 0.00417),
  round('4', '4 AWG', 21.2, 0.00589),
  round('2', '2 AWG', 33.6, 0.00742),
  round('1/0', '1/0 AWG', 53.5, 0.00935),
  round('2/0', '2/0 AWG', 67.4, 0.0105),
  round('4/0', '4/0 AWG', 107.2, 0.0132),
  round('250', '250 kcmil', 126.7, 0.0144),
  round('350', '350 kcmil', 177.3, 0.017),
  round('500', '500 kcmil', 253.4, 0.0203),
];

/**
 * Flat strip (tape) sections. Galvanised steel strip is the customary earthing conductor in IEC
 * practice and is widely used on solar plants, where it also avoids the copper-to-galvanised-steel
 * junction that IEEE Std 2778-2020, 4.3 flags as a galvanic corrosion concern where grounding
 * conductor meets equipment frames.
 */
export const FLAT_SIZES: ConductorSize[] = [
  flat('gs-25x3', 25, 3, 'zn-steel-rod', 'Light duty'),
  flat('gs-30x3', 30, 3, 'zn-steel-rod'),
  flat('gs-25x6', 25, 6, 'zn-steel-rod'),
  flat('gs-40x4', 40, 4, 'zn-steel-rod', 'Common main earthing strip'),
  flat('gs-40x6', 40, 6, 'zn-steel-rod'),
  flat('gs-50x6', 50, 6, 'zn-steel-rod'),
  flat('gs-50x8', 50, 8, 'zn-steel-rod'),
  flat('gs-65x8', 65, 8, 'zn-steel-rod'),
  flat('gs-75x8', 75, 8, 'zn-steel-rod', 'Heavy duty / high fault duty'),
  flat('cu-25x3', 25, 3, 'cu-annealed', 'Copper tape'),
  flat('cu-40x4', 40, 4, 'cu-annealed', 'Copper tape'),
];

/** Every catalogue section, round and flat. */
export const CONDUCTOR_SIZES: ConductorSize[] = [...COPPER_SIZES, ...FLAT_SIZES];
