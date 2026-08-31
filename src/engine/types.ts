/** Shared domain types for the SPP grounding study. All quantities are SI unless noted. */

export type UnitSystem = 'SI' | 'US';

export type BodyWeight = 50 | 70;

/** A single horizontal layer in a soil model (IEEE Std 2778-2020, 5.1.2). */
export interface SoilLayer {
  /** Resistivity, Ω·m. */
  rho: number;
  /**
   * Layer thickness, m. The bottom layer is semi-infinite; its thickness is ignored.
   */
  thickness: number;
}

/** One point of a Wenner four-pin traverse (IEEE Std 81). */
export interface TraversePoint {
  /** Electrode spacing a, m. */
  spacing: number;
  /** Measured resistance R, Ω. Apparent resistivity is derived as 2·π·a·R. */
  resistance: number;
}

export type TraverseKind = 'short' | 'long';

export interface Traverse {
  id: string;
  name: string;
  kind: TraverseKind;
  points: TraversePoint[];
}

/**
 * A region of the plant analysed as a unit — IEEE Std 2778-2020, 5.4.2 "regional analysis".
 * Each region carries its own soil model and its own fault duty, because both vary materially
 * across a utility-scale site.
 */
export interface Region {
  id: string;
  name: string;
  /** Combined local soil model, top layer first. */
  soil: SoilLayer[];
  /** Symmetrical rms line-to-ground fault current at this location, 3·I0, A. */
  faultCurrent: number;
  /** System X/R ratio at the fault location. */
  xOverR: number;
  /** Fault duration used for the decrement factor, s. */
  faultDuration: number;
  /** Shock duration used for the tolerable-voltage limits, s. */
  shockDuration: number;
  /**
   * Split factor Sf — the fraction of 3·I0 that returns through the grounding system and earth.
   * IEEE Std 2778-2020, 5.2.2 warns that the IEEE Std 80 Annex C curves are not valid inside an
   * SPP; a value of 1.0 (no split credit) is the safe default.
   */
  splitFactor: number;
  /** Surfacing present in this region. */
  surface: SurfaceSpec;
  /** Whether footwear resistance may be credited here (inside the fence, qualified personnel only). */
  insidePlant: boolean;
  /**
   * Length of the electrically continuous run from the point of analysis back to the main grid tie,
   * m. Used for the conductor I·R drop check of IEEE Std 2778-2020, 4.3 and 5.4.1.
   */
  auxRunLength: number;
  /**
   * Number of electrically parallel conductive paths from the point of analysis back to the main
   * grid. A single row bonded at one end is 1; equipment tied into a closed loop is 2.
   */
  auxRunPaths: number;
}

export interface SurfaceSpec {
  /** Surfacing material id, or 'native' for none. */
  materialId: string;
  /** Surface layer resistivity ρs, Ω·m. Ignored when materialId is 'native'. */
  rhoS: number;
  /** Surface layer thickness hs, m. */
  thickness: number;
}

/** The main below-grade grounding grid (IEEE Std 2778-2020, 5.3.1). */
export interface GridSpec {
  /** Grid extent in x, m. */
  lengthX: number;
  /** Grid extent in y, m. */
  lengthY: number;
  /** Conductor spacing D, m. SPP grids commonly exceed 100 m. */
  spacing: number;
  /** Burial depth h, m. */
  depth: number;
  /** Grid conductor material id. */
  materialId: string;
  /** Grid conductor cross-section, mm². */
  conductorAreaMm2: number;
  /** Grid conductor overall diameter d, m. */
  conductorDiameterM: number;
  /** Number of driven ground rods. */
  rodCount: number;
  /** Length of each rod, m. */
  rodLength: number;
  /** Rod diameter, m. */
  rodDiameterM: number;
  /** True when rods are placed in the corners and along the perimeter (affects Kii and LM). */
  rodsOnPerimeter: boolean;
}

/**
 * Auxiliary grounding contributed by PV array steel — IEEE Std 2778-2020, 4.3 and 5.4.2.
 * Driven posts in solid contact with native soil behave as short ground rods.
 */
export interface AuxiliarySpec {
  enabled: boolean;
  /** Number of posts modelled in the region of analysis. */
  postCount: number;
  /** Embedded length of each post, m. */
  postLength: number;
  /** Equivalent diameter of the post, m. */
  postDiameterM: number;
  /** Representative centre-to-centre spacing between posts, m. */
  postSpacing: number;
  /**
   * Fraction of posts in solid electrical contact with native soil. Coated posts or posts set in
   * high-resistivity backfill contribute little or nothing (IEEE Std 2778-2020, 4.3).
   */
  contactFraction: number;
}

export interface ConductorSizingSpec {
  materialId: string;
  /** Ambient temperature Ta, °C. */
  ambientTemp: number;
  /**
   * Maximum allowable temperature Tm, °C. Defaults to the material fusing temperature but is
   * commonly limited by the joint type (e.g. 250 °C for brazed, 450 °C for bolted joints).
   */
  maxTemp: number;
  /** Current-carrying duration tc, s. */
  duration: number;
}

export interface ProjectMeta {
  name: string;
  client: string;
  location: string;
  engineer: string;
  date: string;
  plantCapacityMW: number;
  notes: string;
}

export interface StudyInput {
  meta: ProjectMeta;
  units: UnitSystem;
  bodyWeight: BodyWeight;
  /** Footwear resistance credited inside the plant, Ω (IEEE Std 2778-2020, 5.4.4). */
  footwearResistance: number;
  /** Glove resistance credited for touch contact inside the plant, Ω. */
  gloveResistance: number;
  grid: GridSpec;
  auxiliary: AuxiliarySpec;
  sizing: ConductorSizingSpec;
  regions: Region[];
  traverses: Traverse[];
  /**
   * Depth of investigation used to reduce a layered soil model to the single equivalent resistivity
   * required by the IEEE Std 80 closed-form equations, m. Defaults to √A when zero.
   */
  influenceDepth: number;
  equivalentSoilMethod: 'apparent' | 'arithmetic' | 'harmonic';
  /** Fence analysis inputs. */
  fence: FenceSpec;
}

export interface FenceSpec {
  enabled: boolean;
  /** Fence-to-grid separation, m (IEEE Std 2778-2020, 4.4 — 6 m or more is common). */
  separation: number;
  /** Whether the fence is bonded to the SPP grounding system. */
  bonded: boolean;
  /**
   * Surface potential at the fence as a fraction of GPR. For a bonded fence the touch voltage is
   * driven by the difference between GPR and the local earth potential; supply the value from the
   * detailed model where one exists.
   */
  potentialFraction: number;
  surface: SurfaceSpec;
}
