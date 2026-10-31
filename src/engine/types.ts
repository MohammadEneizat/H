import type {
  AirArrangement,
  ConductorConstruction,
  ConductorMaterial,
  DuctKey,
  InsulationKey,
  JacketKey,
  MetalKey,
  MillikenWires,
} from './materials';

/** Optional numeric override: null / undefined means "use the standard value". */
export type Override = number | null | undefined;

export type ScreenForm = 'wires' | 'smooth' | 'corrugated';

/**
 * Single-core cable as described on a manufacturer datasheet.
 * Lengths in mm, areas in mm², resistances in Ω/km, voltage in kV.
 */
export interface CableSpec {
  name: string;
  /** Rated voltage between conductor and screen U0 (kV) */
  U0_kV: number;
  /** Maximum permissible conductor temperature (°C) */
  maxTemp_C: number;
  conductor: {
    material: ConductorMaterial;
    construction: ConductorConstruction;
    millikenWires: MillikenWires;
    area_mm2: number;
    diameter_mm: number;
    /** Maximum DC resistance at 20 °C (Ω/km) */
    R20_ohm_km: number;
    /** AC resistance at maximum temperature from the datasheet (Ω/km); replaces the calculated value */
    Rac_ohm_km?: Override;
    ks?: Override;
    kp?: Override;
  };
  conductorScreen_mm: number;
  insulation: {
    material: InsulationKey;
    thickness_mm: number;
    rhoT?: Override;
    epsR?: Override;
    tanDelta?: Override;
  };
  insulationScreen_mm: number;
  /** Tapes / bedding between insulation screen and metallic screen (mm) */
  bedding_mm: number;
  screen: {
    form: ScreenForm;
    material: MetalKey;
    /** Wire diameter (wires) or wall thickness (sheaths), mm */
    thickness_mm: number;
    /** Number of wires (wire screens only) */
    wireCount?: Override;
    /** Metallic cross-section (mm²) */
    area_mm2?: Override;
    /** DC resistance of the screen / sheath at 20 °C (Ω/km) */
    R20_ohm_km?: Override;
    /** Outer diameter over the corrugation crests, Doc (mm) — corrugated sheaths only */
    corrugationOD_mm?: Override;
  };
  jacket: {
    material: JacketKey;
    thickness_mm: number;
    rhoT?: Override;
  };
  /** Overall diameter from the datasheet (mm); replaces the built-up diameter for external thermal resistance */
  overallDiameter_mm?: Override;
}

export type InstallationType = 'direct' | 'ducts' | 'ductbank' | 'air';
export type Formation = 'trefoil' | 'flat';
export type Bonding = 'both' | 'single' | 'cross';
export type SoilModel = 'moist' | 'two-zone' | 'avoid-drying';

/** One three-phase circuit of single-core cables. Depths in m, spacings in mm. */
export interface InstallationSpec {
  type: InstallationType;
  frequency_Hz: number;
  /** Ambient temperature: undisturbed soil at cable depth, or air (°C) */
  ambient_C: number;
  formation: Formation;
  /** Cables (or ducts) touching each other */
  touching: boolean;
  /** Axial spacing between adjacent cables or ducts (mm), when not touching */
  spacing_mm: number;
  /** Flat formation: cables regularly transposed */
  transposed: boolean;
  bonding: Bonding;
  /** Circulating-current loss factor for cross-bonded systems; null = default for the installation */
  crossBondLambda1?: Override;
  /** Include dielectric losses even when U0 is below the IEC 60287-1-1 Table 3 threshold */
  forceDielectric: boolean;
  /** Depth of laying to the centre of the circuit (m); for duct banks, to the centre of the bank */
  depth_m: number;
  soilRho: number;
  soilModel: SoilModel;
  /** Critical temperature of the soil θx (°C) */
  criticalTemp_C: number;
  /** Thermal resistivity of dried-out soil (K·m/W) */
  dryRho: number;
  duct: {
    material: DuctKey;
    innerD_mm: number;
    outerD_mm: number;
    rho?: Override;
    U?: Override;
    V?: Override;
    Y?: Override;
  };
  bank: {
    width_m: number;
    height_m: number;
    concreteRho: number;
  };
  air: {
    arrangement: AirArrangement;
    solar: boolean;
    /** Solar radiation intensity (W/m²) */
    H: number;
    absorption?: Override;
  };
}

export interface CableGeometry {
  /** Conductor diameter */
  dc: number;
  /** Diameter over conductor screen */
  dcScreen: number;
  /** Diameter over insulation (excluding screen) */
  Di: number;
  /** Diameter over insulation screen */
  Dis: number;
  /** Diameter under the metallic screen / sheath */
  Dunder: number;
  /** Mean diameter of screen / sheath, d */
  dMean: number;
  /** External diameter of screen / sheath, Ds */
  Ds: number;
  /** Thickness of screen / sheath (equivalent tube thickness for wires), ts */
  ts: number;
  /** Metallic cross-section of screen / sheath (mm²) */
  As: number;
  /** Corrugated sheath: diameter touching inside of troughs / outside of crests */
  Dit?: number;
  Doc?: number;
  /** Thickness of insulation between conductor and sheath used for T1, t1 */
  t1: number;
  /** Diameter under the oversheath */
  Da: number;
  /** Oversheath thickness t3 */
  t3: number;
  /** Built-up overall diameter */
  DeBuilt: number;
  /** Overall diameter used for external thermal resistance */
  De: number;
}

export interface ConductorResult {
  R0: number;
  Rdc: number;
  ks: number;
  kp: number;
  xs: number;
  ys: number;
  xp: number;
  yp: number;
  R: number;
  fromDatasheet: boolean;
}

export interface SheathCable {
  label: string;
  lambda1p: number;
  lambda1pp: number;
  lambda1: number;
}

export interface SheathResult {
  Rs20: number;
  Rs: number;
  rhoS: number;
  X: number;
  m: number;
  Ft: number | null;
  cables: SheathCable[];
  /** Loss factor used in the rating (largest of the three cables) */
  lambda1: number;
  governing: number;
}

export interface T4Breakdown {
  /** Total external thermal resistance used in the rating */
  T4: number;
  /** Cable surface to duct inner surface (ducts) */
  T4p?: number;
  /** Duct wall */
  T4pp?: number;
  /** Duct (or cable) to ambient, including mutual heating */
  T4ppp?: number;
  /** Duct-bank correction for the soil / concrete difference */
  bankCorrection?: number;
  /** Mean temperature of the medium inside the duct (°C) */
  thetaM?: number;
  /** Air: heat dissipation coefficient and surface temperature rise */
  h?: number;
  dThetaS?: number;
  method: string;
  hottest: number;
}

export interface RatingResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  notes: string[];
  /** Permissible current (A) */
  I: number;
  governingCase: string;
  /** Ratings computed for each soil case when drying out is considered */
  cases: { label: string; I: number }[];
  geometry: CableGeometry;
  conductor: ConductorResult;
  dielectric: { C: number; Wd: number; included: boolean; threshold_kV: number };
  sheath: SheathResult;
  thermal: { T1: number; T2: number; T3: number; t4: T4Breakdown };
  losses: { Wc: number; Ws: number; Wd: number; W: number };
  temperatures: {
    conductor: number;
    sheath: number;
    surface: number;
    ductInner?: number;
  };
  spacing_mm: number;
  positions: { x: number; y: number }[];
  iterations: number;
}

export interface TemperatureResult {
  ok: boolean;
  errors: string[];
  I: number;
  conductor: number;
  sheath: number;
  surface: number;
  R: number;
  lambda1: number;
  W: number;
  iterations: number;
}
