import type { FieldModel } from './field';
import type {
  AirArrangement,
  GroundMaterial,
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

export type ScreenForm = 'wires' | 'smooth' | 'corrugated' | 'none';
/** Conductor shape of three-core cables */
export type ConductorShape = 'round' | 'sector';

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
  /**
   * 1: single-core cable (default). 3: three-core cable carrying all three phases, without a
   * metallic screen or armour (for example NYY, NAYY, N2XY, NA2XY).
   */
  cores?: 1 | 3;
  /**
   * 'ac' (default): three-phase, a circuit is three single-core cables or one three-core cable.
   * 'dc': a circuit is two single-core cables, + and − (IEC 60287-1-1 1.4.1.2, up to 5 kV).
   */
  system?: 'ac' | 'dc';
  /** Three-core cables */
  threeCore?: {
    /** Shape of the conductors; for sector-shaped ones the conductor diameter is the equivalent round diameter dx */
    shape: ConductorShape;
    /** Inner covering (extruded filler) over the laid-up cores (mm); empty: worked out from the overall diameter */
    innerCovering_mm?: Override;
    /** Radius of the circle circumscribing the conductors r1 (mm); empty: worked out from the area */
    r1_mm?: Override;
    /** Thermal resistivity of the filler, round conductors only (K·m/W); default 10 */
    fillerRho?: Override;
  };
}

export type InstallationType = 'direct' | 'ducts' | 'ductbank' | 'air' | 'trench';
export type LoadMode = 'rated' | 'fixed';
/** How the rated circuits share the thermal limit when there is more than one circuit. */
export type RatingMode = 'own-limit' | 'equal-current';
export type Formation = 'trefoil' | 'flat';
export type Bonding = 'both' | 'single' | 'cross';
export type SoilModel = 'moist' | 'two-zone' | 'avoid-drying';

/**
 * A further three-phase circuit in the same installation (buried installations only).
 * It shares the soil, ambient temperature, ducts and duct bank of the main circuit.
 */
export interface CircuitSpec {
  id: string;
  name: string;
  /** Cable of this circuit; null means the same cable as the main circuit */
  cable: CableSpec | null;
  /** Horizontal position of the circuit centre, relative to the main circuit (m) */
  x_m: number;
  /** Depth of the circuit centre (m) */
  depth_m: number;
  formation: Formation;
  touching: boolean;
  spacing_mm: number;
  transposed: boolean;
  bonding: Bonding;
  crossBondLambda1?: Override;
  /** 'rated': the circuit is rated together with the main circuit; 'fixed': it carries current_A */
  load: LoadMode;
  current_A: number;
  /** In ducts (buried installations); undefined follows the main circuit */
  ducted?: boolean;
  /** Duct size for this circuit; undefined uses the installation's duct settings */
  duct?: DuctSize;
  /** Rotated formation: flat vertical, or trefoil with the point down */
  rotated?: boolean;
  /** Id of a shared conduit holding this circuit (cross-section layouts); its position replaces x and depth */
  conduit?: string;
}

/** A conduit (duct) that can hold several circuits, for example two three-core cables in one pipe. */
export interface ConduitSpec {
  id: string;
  name: string;
  /** Centre, horizontal (m) */
  x_m: number;
  /** Centre depth (m) */
  depth_m: number;
  material: DuctKey;
  innerD_mm: number;
  outerD_mm: number;
}

/** A layer of native ground, stacked from the surface down; the last layer continues downwards. */
export interface SoilLayer {
  id: string;
  name: string;
  material: GroundMaterial;
  thickness_m: number;
  rho: number;
}

/** Fill band of a trench between two depths (m below the surface), wall to wall. */
export interface TrenchBand {
  id: string;
  name: string;
  material: GroundMaterial;
  rho: number;
  top_m: number;
  bottom_m: number;
}
/** Older name of a trench fill band. */
export type TrenchZone = TrenchBand;

export type ShapeKind = 'trench' | 'rect' | 'circle' | 'polygon';

/**
 * A region of the cross-section with its own material. Later shapes lie on top of
 * earlier ones. Lengths in m; y is depth below the surface (positive down).
 */
export interface GroundShape {
  id: string;
  name: string;
  kind: ShapeKind;
  material: GroundMaterial;
  rho: number;
  /** Centre x (trench, rectangle, circle) */
  x_m: number;
  /** Depth of the top (trench, rectangle) or of the centre (circle) */
  y_m: number;
  /** Rectangle width, trench width at the bottom, circle diameter */
  width_m: number;
  /** Rectangle height, trench depth */
  height_m: number;
  /** Trench: width at its top */
  topWidth_m?: number;
  /** Trench: fill bands; the rest of the trench is `material` */
  bands?: TrenchBand[];
  /** Polygon: corner points [x, y] */
  points?: [number, number][];
}

/** Cover tile row or warning tape (tape is drawn but has no thermal effect). */
export interface TrenchSlab {
  id: string;
  kind: 'tile' | 'tape';
  x_m: number;
  /** Depth of the top of the slab (m) */
  depth_m: number;
  width_m: number;
  thickness_m: number;
  rho: number;
}

/** A buried heat source other than the cables, such as a district heating pipe. */
export interface HeatSource {
  id: string;
  name: string;
  x_m: number;
  depth_m: number;
  diameter_mm: number;
  /** Heat given off (W/m) */
  W: number;
}

/** The cross-section: ground layers, shapes, tiles and tape. */
export interface TrenchSpec {
  surface: 'grass' | 'asphalt' | 'paving';
  layers: SoilLayer[];
  shapes: GroundShape[];
  slabs: TrenchSlab[];
  /** Main circuit in ducts (one per cable, using the duct settings) */
  ducted: boolean;
  /** A DXF drawing shown under the shapes (mm, y = depth down) */
  underlay?: {
    name: string;
    lines: number[];
    circles: number[];
    texts: { x: number; y: number; h: number; t: string }[];
  };
}

/** Duct size for one circuit. */
export interface DuctSize {
  material: DuctKey;
  innerD_mm: number;
  outerD_mm: number;
}

/** Rectangular zone of different thermal resistivity around the cables (IEC 60287-2-1 backfill / duct bank method). */
export interface BackfillSpec {
  name: string;
  centreX_m: number;
  centreDepth_m: number;
  width_m: number;
  height_m: number;
  rho: number;
}

/** The installation and the main three-phase circuit of single-core cables. Depths in m, spacings in mm. */
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
    /** Horizontal position of the bank centre relative to the main circuit (m); default 0 */
    centreX_m?: Override;
    /** Depth of the bank centre (m); default: depth of the main circuit */
    centreDepth_m?: Override;
  };
  /** Other circuits in the same installation (not used in free air) */
  circuits: CircuitSpec[];
  /** Shared conduits (cross-section layouts) */
  conduits?: ConduitSpec[];
  /** Id of the shared conduit holding the main circuit */
  mainConduit?: string;
  /** Internal, set by the solver: the shared conduit the circuit being modelled lies in */
  conduitRef?: {
    id: string;
    name: string;
    x_m: number;
    depth_m: number;
    material: DuctKey;
    innerD_mm: number;
    outerD_mm: number;
    /** Number of cables in the conduit (a three-core cable counts once, a single-core circuit three times) */
    groupCables: number;
    /** Mean cable diameter in the conduit (mm) */
    groupDe: number;
  };
  ratingMode: RatingMode;
  /** Horizontal position of this circuit's centre (m); 0 for the main circuit */
  circuitX_m?: number;
  /** Horizontal position of the main circuit (m), used by the trench editor; default 0 */
  mainX_m?: number;
  /** Trench layout (installation type 'trench') */
  trench?: TrenchSpec;
  /** Backfill rectangle for direct burial or ducts (set from a trench for the IEC method) */
  backfill?: BackfillSpec | null;
  /** Main circuit rotated: flat vertical, or trefoil with the point down */
  rotated?: boolean;
  /** Other buried heat sources; used with the cross-section layout (installation type 'trench') */
  heatSources?: HeatSource[];
  /** Set by the cross-section conversion so that heat sources are kept; not set by users */
  fromLayout?: boolean;
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
  /** 1 or 3 cores */
  cores: 1 | 3;
  /** Three-core cables: shape, r1, insulation between conductors t, laid-up and belt diameters, G */
  threeCore?: {
    shape: ConductorShape;
    r1: number;
    t: number;
    coreD: number;
    layD: number;
    da: number;
    innerCovering: number;
  };
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
  /** Temperature rise from other circuits at the governing cable (K) */
  mutual?: number;
  /** Mean temperature of the medium inside the duct (°C) */
  thetaM?: number;
  /** Air: heat dissipation coefficient and surface temperature rise */
  h?: number;
  dThetaS?: number;
  method: string;
  hottest: number;
}

export interface CircuitResult {
  name: string;
  cableName: string;
  load: LoadMode;
  /** Current carried (A): the rating for rated circuits, the entered load for fixed ones */
  I: number;
  maxTemp: number;
  /** Conductor temperature of the hottest cable of the circuit (°C) */
  hottestTemp: number;
  /** Heat per cable (W/m) */
  W: number;
  /** Temperature rise at the hottest cable caused by the other circuits (K) */
  mutualRise: number;
  positions: { x: number; y: number }[];
  /** Cable and duct outer diameters (mm) */
  De: number;
  ductD?: number;
  ductInnerD?: number;
  dc: number;
  hottest: number;
  /** 1 or 3 cores per cable */
  cores: 1 | 3;
  /** DC circuit (two cables, + and −) */
  isDC?: boolean;
  /** Where the cables are drawn (mm): one per cable, so one point for a three-core cable */
  cablePositions: { x: number; y: number }[];
  /** The shared conduit holding this circuit */
  conduit?: { id: string; name: string; x: number; y: number; Do: number; Di: number };
}

export interface SystemResult {
  mode: RatingMode;
  circuits: CircuitResult[];
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
  thermal: {
    T1: number;
    T2: number;
    T3: number;
    t4: T4Breakdown;
    /** Three-core cables: geometric factor of T1 */
    threeCore?: { G: number; F2: number; filler: number; r1: number; da: number; t: number; shape: ConductorShape };
  };
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
  /** Present when the installation has more than one circuit; circuits[0] is the main circuit */
  system?: SystemResult;
  /** Temperature field in the ground at the rated current (buried installations) */
  field?: FieldModel;
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
