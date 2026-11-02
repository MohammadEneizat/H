// Cross-section of the ground: layers, shapes (trenches, rectangles, circles, polygons),
// tiles and tape. Ground lookup, conversion to the IEC 60287 backfill method, templates.
import { GROUND, type GroundMaterial } from './materials';
import type { NumInput, NumObject } from './numeric';
import { circuitPositions } from './thermal';
import type {
  BackfillSpec,
  CircuitSpec,
  GroundShape,
  InstallationSpec,
  SoilLayer,
  TrenchBand,
  TrenchSlab,
  TrenchSpec,
} from './types';

export const uid = () => Math.random().toString(36).slice(2, 10);

/** Native ground layer at depth y (m). */
export function layerAt(t: TrenchSpec, y: number): SoilLayer {
  let top = 0;
  for (let i = 0; i < t.layers.length; i++) {
    const l = t.layers[i];
    if (i === t.layers.length - 1 || y < top + l.thickness_m) return l;
    top += l.thickness_m;
  }
  return t.layers[t.layers.length - 1];
}

/** Depths of the layer boundaries (m). */
export function layerBoundaries(t: TrenchSpec): number[] {
  const out: number[] = [];
  let top = 0;
  t.layers.slice(0, -1).forEach((l) => {
    top += l.thickness_m;
    out.push(top);
  });
  return out;
}

/** Half the width of a trench shape at depth y (m), with straight walls. */
export function trenchHalfWidth(s: GroundShape, y: number): number {
  const f = Math.min(1, Math.max(0, (y - s.y_m) / s.height_m));
  const top = s.topWidth_m ?? s.width_m;
  return (top + (s.width_m - top) * f) / 2;
}

function inPolygon(pts: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a point (m) lies in a shape. */
export function shapeContains(s: GroundShape, x: number, y: number): boolean {
  switch (s.kind) {
    case 'trench':
      return y >= s.y_m && y <= s.y_m + s.height_m && Math.abs(x - s.x_m) <= trenchHalfWidth(s, y);
    case 'rect':
      return Math.abs(x - s.x_m) <= s.width_m / 2 && y >= s.y_m && y <= s.y_m + s.height_m;
    case 'circle':
      return (x - s.x_m) ** 2 + (y - s.y_m) ** 2 <= (s.width_m / 2) ** 2;
    case 'polygon':
      return !!s.points && s.points.length >= 3 && inPolygon(s.points, x, y);
  }
}

/** Fill band of a trench at depth y, if any. */
export function bandAt(s: GroundShape, y: number): TrenchBand | undefined {
  return s.bands?.find((b) => y >= b.top_m && y <= b.bottom_m);
}

/** Topmost shape containing a point. */
export function topShapeAt(t: TrenchSpec, x: number, y: number): GroundShape | undefined {
  for (let i = t.shapes.length - 1; i >= 0; i--) if (shapeContains(t.shapes[i], x, y)) return t.shapes[i];
  return undefined;
}

/** Thermal resistivity (K·m/W) at a point (m). Cables, ducts and heat sources are not included. */
export function groundRho(t: TrenchSpec, x: number, y: number): number {
  for (const s of t.slabs) {
    if (s.kind !== 'tile') continue;
    if (Math.abs(x - s.x_m) <= s.width_m / 2 && y >= s.depth_m && y <= s.depth_m + s.thickness_m) return s.rho;
  }
  const sh = topShapeAt(t, x, y);
  if (sh) return (sh.kind === 'trench' ? bandAt(sh, y)?.rho : undefined) ?? sh.rho;
  return layerAt(t, y).rho;
}

/** Bounding box of a shape (m). */
export function shapeBounds(s: GroundShape): { x0: number; x1: number; y0: number; y1: number } {
  switch (s.kind) {
    case 'trench': {
      const w = Math.max(s.width_m, s.topWidth_m ?? s.width_m) / 2;
      return { x0: s.x_m - w, x1: s.x_m + w, y0: s.y_m, y1: s.y_m + s.height_m };
    }
    case 'rect':
      return { x0: s.x_m - s.width_m / 2, x1: s.x_m + s.width_m / 2, y0: s.y_m, y1: s.y_m + s.height_m };
    case 'circle':
      return { x0: s.x_m - s.width_m / 2, x1: s.x_m + s.width_m / 2, y0: s.y_m - s.width_m / 2, y1: s.y_m + s.width_m / 2 };
    case 'polygon': {
      const p = s.points ?? [[0, 0]];
      return {
        x0: Math.min(...p.map((q) => q[0])),
        x1: Math.max(...p.map((q) => q[0])),
        y0: Math.min(...p.map((q) => q[1])),
        y1: Math.max(...p.map((q) => q[1])),
      };
    }
  }
}

/** Input for the numerical model: ground resistivity from the cross-section (mm coordinates). */
export function trenchNumericInput(t: TrenchSpec, objects: NumObject[]): NumInput {
  const xs: number[] = [];
  const ys: number[] = layerBoundaries(t).map((y) => y * 1000);
  for (const s of t.shapes) {
    const b = shapeBounds(s);
    ys.push(b.y0 * 1000, b.y1 * 1000);
    if (s.kind === 'rect' || (s.kind === 'trench' && (s.topWidth_m ?? s.width_m) === s.width_m)) xs.push(b.x0 * 1000, b.x1 * 1000);
    s.bands?.forEach((band) => ys.push(band.top_m * 1000, band.bottom_m * 1000));
  }
  t.slabs
    .filter((s) => s.kind === 'tile')
    .forEach((s) => {
      xs.push((s.x_m - s.width_m / 2) * 1000, (s.x_m + s.width_m / 2) * 1000);
      ys.push(s.depth_m * 1000, (s.depth_m + s.thickness_m) * 1000);
    });
  return { objects, rhoAt: (x, y) => groundRho(t, x / 1000, y / 1000), features: { xs, ys } };
}

/**
 * The cross-section as the IEC 60287 method sees it. The shape (or trench fill band) around
 * the main circuit becomes a backfill rectangle (IEC 60287-2-1 2.2.7.3) in the native layer at
 * cable depth. Circles and polygons are replaced by an equivalent rectangle. Other layers,
 * shapes and tiles are only taken into account by the numerical model.
 */
export function trenchToIec(inst: InstallationSpec): { iec: InstallationSpec; notes: string[]; warnings: string[] } {
  const t = inst.trench;
  const notes: string[] = [];
  const warnings: string[] = [];
  if (!t || !t.layers.length) {
    return {
      iec: { ...inst, type: 'direct', backfill: null, fromLayout: true },
      notes,
      warnings: ['The cross-section has no ground layers; uniform soil is assumed.'],
    };
  }
  const x = inst.mainX_m ?? 0;
  const y = inst.depth_m;
  const native = layerAt(t, y);
  let backfill: BackfillSpec | null = null;
  let sh = topShapeAt(t, x, y);
  if (sh) {
    // The IEC backfill method needs the whole circuit inside the zone
    const D = inst.touching ? (t.ducted ? inst.duct.outerD_mm : 45) : inst.spacing_mm;
    const centres = circuitPositions(inst.formation, D, y * 1000, !!inst.rotated).map((p) => ({ x: x + p.x / 1000, y: p.y / 1000 }));
    const band0 = sh.kind === 'trench' ? bandAt(sh, y) : undefined;
    const holds = centres.every(
      (c) => topShapeAt(t, c.x, c.y) === sh && (sh!.kind !== 'trench' || bandAt(sh!, c.y) === band0),
    );
    if (!holds) {
      notes.push(
        `IEC method: “${band0?.name || sh.name}” does not hold the whole circuit, so it is left out of the IEC result; the numerical result includes it.`,
      );
      sh = undefined;
    }
  }
  if (sh) {
    const band = sh.kind === 'trench' ? bandAt(sh, y) : undefined;
    const name = band?.name || sh.name || GROUND[band?.material ?? sh.material].label;
    const rho = band?.rho ?? sh.rho;
    let approx = '';
    if (sh.kind === 'trench') {
      const top = band ? band.top_m : sh.y_m;
      const bottom = band ? band.bottom_m : sh.y_m + sh.height_m;
      const yc = (top + bottom) / 2;
      backfill = { name, centreX_m: sh.x_m, centreDepth_m: yc, width_m: 2 * trenchHalfWidth(sh, yc), height_m: bottom - top, rho };
      if ((sh.topWidth_m ?? sh.width_m) !== sh.width_m) approx = ' (sloped walls taken at mid-height)';
    } else if (sh.kind === 'rect') {
      backfill = { name, centreX_m: sh.x_m, centreDepth_m: sh.y_m + sh.height_m / 2, width_m: sh.width_m, height_m: sh.height_m, rho };
    } else if (sh.kind === 'circle') {
      // square with the same equivalent radius as the circle (rb = 0.5498·side)
      const side = sh.width_m / 2 / 0.5498;
      backfill = { name, centreX_m: sh.x_m, centreDepth_m: sh.y_m, width_m: side, height_m: side, rho };
      approx = ' (circle replaced by a square of the same equivalent radius)';
    } else {
      const b = shapeBounds(sh);
      backfill = { name, centreX_m: (b.x0 + b.x1) / 2, centreDepth_m: (b.y0 + b.y1) / 2, width_m: b.x1 - b.x0, height_m: b.y1 - b.y0, rho };
      approx = ' (polygon replaced by its bounding rectangle)';
    }
    notes.push(
      `IEC method: “${name}” (ρ ${rho} K·m/W, ${backfill.width_m.toFixed(2)} × ${backfill.height_m.toFixed(2)} m${approx}) is treated as a backfill rectangle in the layer “${native.name}” (ρ ${native.rho} K·m/W), IEC 60287-2-1 2.2.7.3.`,
    );
  }
  if (!backfill)
    notes.push(`IEC method: uniform ground with the resistivity of the layer “${native.name}” at cable depth (ρ ${native.rho} K·m/W).`);
  const extra =
    new Set(t.layers.map((l) => l.rho)).size > 1 ||
    t.slabs.some((s) => s.kind === 'tile') ||
    t.shapes.length > 1 ||
    t.shapes.some((s) => (s.bands?.length ?? 0) > 1);
  if (extra) notes.push('Other soil layers, shapes, fill bands and cover tiles are only included in the numerical result.');
  if (inst.soilModel !== 'moist') warnings.push('Soil drying models are not used with a cross-section layout; moist ground is assumed.');
  return {
    iec: {
      ...inst,
      type: t.ducted ? 'ducts' : 'direct',
      soilRho: native.rho,
      soilModel: 'moist',
      backfill,
      fromLayout: true,
    },
    notes,
    warnings,
  };
}

// ---------------------------------------------------------------------------------------
// Building blocks and migration
// ---------------------------------------------------------------------------------------

export const layer = (name: string, material: GroundMaterial, thickness_m: number, rho?: number): SoilLayer => ({
  id: uid(),
  name,
  material,
  thickness_m,
  rho: rho ?? GROUND[material].rho,
});

export const band = (name: string, material: GroundMaterial, top_m: number, bottom_m: number, rho?: number): TrenchBand => ({
  id: uid(),
  name,
  material,
  top_m,
  bottom_m,
  rho: rho ?? GROUND[material].rho,
});

export function trenchShape(p: {
  name?: string;
  x: number;
  depth: number;
  width: number;
  topWidth?: number;
  fill?: GroundMaterial;
  fillRho?: number;
  bands?: TrenchBand[];
}): GroundShape {
  const fill = p.fill ?? 'clay';
  return {
    id: uid(),
    name: p.name ?? 'Trench',
    kind: 'trench',
    material: fill,
    rho: p.fillRho ?? GROUND[fill].rho,
    x_m: p.x,
    y_m: 0,
    width_m: p.width,
    height_m: p.depth,
    topWidth_m: p.topWidth ?? p.width,
    bands: p.bands ?? [],
  };
}

export function rectShape(name: string, material: GroundMaterial, x: number, top: number, width: number, height: number, rho?: number): GroundShape {
  return { id: uid(), name, kind: 'rect', material, rho: rho ?? GROUND[material].rho, x_m: x, y_m: top, width_m: width, height_m: height };
}

export function circleShape(name: string, material: GroundMaterial, x: number, y: number, diameter: number, rho?: number): GroundShape {
  return { id: uid(), name, kind: 'circle', material, rho: rho ?? GROUND[material].rho, x_m: x, y_m: y, width_m: diameter, height_m: diameter };
}

export function polygonShape(name: string, material: GroundMaterial, points: [number, number][], rho?: number): GroundShape {
  return { id: uid(), name, kind: 'polygon', material, rho: rho ?? GROUND[material].rho, x_m: 0, y_m: 0, width_m: 0, height_m: 0, points };
}

/**
 * Brings a stored cross-section up to date. Older projects had one trench with fill zones;
 * it becomes a trench shape with fill bands.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrateTrench(raw: any, fallbackRho = 1): TrenchSpec {
  const layers: SoilLayer[] =
    Array.isArray(raw?.layers) && raw.layers.length ? raw.layers : [layer('Native soil', 'clay', 5, fallbackRho)];
  const slabs: TrenchSlab[] = Array.isArray(raw?.slabs) ? raw.slabs : [];
  let shapes: GroundShape[] = Array.isArray(raw?.shapes) ? raw.shapes : [];
  if (!Array.isArray(raw?.shapes) && raw && typeof raw === 'object') {
    shapes = [];
    if (raw.present !== false && typeof raw.depth_m === 'number') {
      const fillRho = layerAt({ layers, shapes: [], slabs: [], surface: 'grass', ducted: false }, raw.depth_m / 2).rho;
      shapes.push(
        trenchShape({
          x: raw.centreX_m ?? 0,
          depth: raw.depth_m,
          width: raw.bottomWidth_m ?? 0.8,
          topWidth: raw.topWidth_m ?? raw.bottomWidth_m ?? 0.8,
          fill: 'clay',
          fillRho,
          bands: Array.isArray(raw.zones) ? raw.zones : [],
        }),
      );
    }
  }
  return {
    surface: raw?.surface === 'asphalt' || raw?.surface === 'paving' ? raw.surface : 'grass',
    layers,
    shapes,
    slabs,
    ducted: !!raw?.ducted,
  };
}

// ---------------------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------------------

export interface TrenchTemplate {
  id: string;
  label: string;
  description: string;
  apply: (inst: InstallationSpec) => InstallationSpec;
}

const circuit = (patch: Partial<CircuitSpec>): CircuitSpec => ({
  id: uid(),
  name: 'C2',
  cable: null,
  x_m: 0.4,
  depth_m: 0.9,
  formation: 'trefoil',
  touching: true,
  spacing_mm: 100,
  transposed: false,
  bonding: 'both',
  crossBondLambda1: null,
  load: 'rated',
  current_A: 300,
  ...patch,
});

const tile = (x: number, depth: number, width: number, thickness: number, material: GroundMaterial): TrenchSlab => ({
  id: uid(),
  kind: 'tile',
  x_m: x,
  depth_m: depth,
  width_m: width,
  thickness_m: thickness,
  rho: GROUND[material].rho,
});
const tape = (x: number, depth: number, width: number): TrenchSlab => ({
  id: uid(),
  kind: 'tape',
  x_m: x,
  depth_m: depth,
  width_m: width,
  thickness_m: 0.005,
  rho: 1,
});

export const TRENCH_TEMPLATES: TrenchTemplate[] = [
  {
    id: 'mv-two',
    label: 'MV trench, two circuits in sand',
    description: '0.8 m wide, 1.0 m deep. Two trefoil circuits bedded in sand under polymer cover tiles.',
    apply: (inst) => ({
      ...inst,
      type: 'trench',
      formation: 'trefoil',
      touching: true,
      rotated: false,
      depth_m: 0.85,
      mainX_m: -0.2,
      bonding: 'both',
      ratingMode: 'own-limit',
      heatSources: [],
      trench: {
        surface: 'grass',
        ducted: false,
        layers: [layer('Topsoil', 'topsoil', 0.3), layer('Clay', 'clay', 1.5), layer('Sand subsoil', 'sand', 5)],
        shapes: [
          trenchShape({ x: 0, depth: 1.0, width: 0.8, fill: 'clay', fillRho: 1.2, bands: [band('Sand bedding', 'sand', 0.6, 1.0)] }),
        ],
        slabs: [tile(0, 0.6, 0.7, 0.02, 'polymer'), tape(0, 0.3, 0.5)],
      },
      circuits: [circuit({ name: 'C2', x_m: 0.2, depth_m: 0.85 })],
    }),
  },
  {
    id: 'hv-cbs',
    label: 'HV trench with CBS backfill',
    description: '1.6 m wide at the top, 1.0 m at the bottom, 1.5 m deep. Flat formation in cement-bound sand under concrete tiles.',
    apply: (inst) => ({
      ...inst,
      type: 'trench',
      formation: 'flat',
      touching: false,
      rotated: false,
      spacing_mm: 250,
      transposed: false,
      depth_m: 1.25,
      mainX_m: 0,
      bonding: 'cross',
      heatSources: [],
      trench: {
        surface: 'grass',
        ducted: false,
        layers: [layer('Topsoil', 'topsoil', 0.3), layer('Clay', 'clay', 2.0), layer('Sand subsoil', 'sand', 5, 1.1)],
        shapes: [
          trenchShape({ x: 0, depth: 1.5, width: 1.0, topWidth: 1.6, fill: 'clay', fillRho: 1.2, bands: [band('CBS', 'cbs', 0.95, 1.5)] }),
        ],
        slabs: [tile(0, 0.95, 0.9, 0.05, 'concrete'), tape(0, 0.5, 0.6)],
      },
      circuits: [],
    }),
  },
  {
    id: 'road',
    label: 'Road crossing, ducts in concrete',
    description: 'Under asphalt and sub-base. Trefoil ducts in a concrete block in a 0.8 m wide, 1.4 m deep trench.',
    apply: (inst) => ({
      ...inst,
      type: 'trench',
      formation: 'trefoil',
      touching: true,
      rotated: false,
      depth_m: 1.15,
      mainX_m: 0,
      heatSources: [],
      duct: { ...inst.duct, material: 'PE', innerD_mm: Math.max(inst.duct.innerD_mm, 100), outerD_mm: Math.max(inst.duct.outerD_mm, 110) },
      trench: {
        surface: 'asphalt',
        ducted: true,
        layers: [layer('Asphalt', 'asphalt', 0.12), layer('Sub-base', 'subbase', 0.35), layer('Clay', 'clay', 2), layer('Sand subsoil', 'sand', 5)],
        shapes: [
          trenchShape({ x: 0, depth: 1.4, width: 0.8, fill: 'subbase' }),
          rectShape('Concrete', 'concrete', 0, 0.85, 0.8, 0.55),
        ],
        slabs: [tape(0, 0.6, 0.5)],
      },
      circuits: [],
    }),
  },
  {
    id: 'hdd',
    label: 'Drilled crossing (HDD), 6 m deep',
    description: 'No trench. One HDPE pipe per cable in a bentonite-filled bore, pipes 1.5 m apart, in layered ground.',
    apply: (inst) => ({
      ...inst,
      type: 'trench',
      formation: 'flat',
      touching: false,
      rotated: false,
      spacing_mm: 1500,
      transposed: false,
      depth_m: 6,
      mainX_m: 0,
      heatSources: [],
      duct: { ...inst.duct, material: 'PE', innerD_mm: Math.max(inst.duct.innerD_mm, 180), outerD_mm: Math.max(inst.duct.outerD_mm, 200) },
      trench: {
        surface: 'grass',
        ducted: true,
        layers: [layer('Topsoil', 'topsoil', 0.4), layer('Clay', 'clay', 3), layer('Wet sand', 'sand', 6, 0.8), layer('Gravel', 'gravel', 10)],
        shapes: [-1.5, 0, 1.5].map((x, i) => circleShape(`Bore ${i + 1}`, 'bentonite', x, 6, 0.3)),
        slabs: [],
      },
      circuits: [],
    }),
  },
  {
    id: 'district-heating',
    label: 'MV trench beside a district heating pipe',
    description: 'One trefoil circuit in sand, 0.6 m from a pair of district heating pipes giving off 30 W/m each.',
    apply: (inst) => ({
      ...inst,
      type: 'trench',
      formation: 'trefoil',
      touching: true,
      rotated: false,
      depth_m: 0.9,
      mainX_m: 0,
      circuits: [],
      heatSources: [
        { id: uid(), name: 'Supply pipe', x_m: 0.9, depth_m: 0.9, diameter_mm: 250, W: 30 },
        { id: uid(), name: 'Return pipe', x_m: 1.25, depth_m: 0.9, diameter_mm: 250, W: 30 },
      ],
      trench: {
        surface: 'paving',
        ducted: false,
        layers: [layer('Paving bed', 'sand', 0.25), layer('Clay', 'clay', 2), layer('Sand subsoil', 'sand', 5)],
        shapes: [
          trenchShape({ x: 0, depth: 1.1, width: 0.6, fill: 'sand', bands: [band('Sand bedding', 'sand', 0.7, 1.1)] }),
          rectShape('Pipe trench fill', 'sand', 1.075, 0, 0.95, 1.2),
        ],
        slabs: [tile(0, 0.68, 0.5, 0.02, 'polymer'), tape(0, 0.35, 0.4)],
      },
    }),
  },
  {
    id: 'lv-conduit',
    label: 'LV: two circuits in one DN160 conduit, 2 m deep',
    description:
      'Two three-core LV cables (load an NA2XY 3×240 cable from the Library) sharing a PE conduit 160/141 mm at 2 m in soil of 1 K·m/W. C2 carries 254 A; C1 is rated.',
    apply: (inst) => {
      const k = { id: uid(), name: 'DN160', x_m: 0, depth_m: 2, material: 'PE' as const, innerD_mm: 141, outerD_mm: 160 };
      return {
        ...inst,
        type: 'trench',
        formation: 'trefoil',
        touching: true,
        rotated: false,
        depth_m: 2,
        mainX_m: 0,
        soilRho: 1,
        conduits: [k],
        mainConduit: k.id,
        circuits: [circuit({ name: 'C2', x_m: 0, depth_m: 2, conduit: k.id, load: 'fixed', current_A: 254 })],
        heatSources: [],
        trench: {
          surface: 'grass',
          ducted: false,
          layers: [layer('Native soil', 'clay', 5, 1)],
          shapes: [],
          slabs: [],
        },
      };
    },
  },
];

/** A plain cross-section to start from: the current circuit in a sand-bedded trench. */
/**
 * An editable layout of the installation as it is now (direct buried, ducts or duct bank):
 * uniform ground with the entered soil resistivity, and the duct bank as a concrete
 * rectangle. Circuits, ducts and heat sources are kept, so the rating does not change.
 */
export function layoutFromInstallation(inst: InstallationSpec): TrenchSpec {
  const shapes: GroundShape[] = [];
  if (inst.type === 'ductbank') {
    const b = inst.bank;
    const cx = (inst.mainX_m ?? 0) + (b.centreX_m ?? 0);
    const cy = b.centreDepth_m ?? inst.depth_m;
    shapes.push(rectShape('Duct bank', 'concrete', cx, Math.max(0.01, cy - b.height_m / 2), b.width_m, b.height_m, b.concreteRho));
  }
  return {
    surface: 'grass',
    ducted: inst.type === 'ducts' || inst.type === 'ductbank',
    layers: [layer('Native soil', 'clay', 5, inst.soilRho)],
    shapes,
    slabs: [],
  };
}

export function defaultTrench(inst: InstallationSpec): TrenchSpec {
  const d = Math.max(inst.depth_m + 0.25, 0.9);
  return {
    surface: 'grass',
    ducted: inst.type === 'ducts' || inst.type === 'ductbank',
    layers: [layer('Topsoil', 'topsoil', 0.3), layer('Native soil', 'clay', 5, inst.soilRho)],
    shapes: [
      trenchShape({
        x: inst.mainX_m ?? 0,
        depth: d,
        width: 0.7,
        fill: 'clay',
        fillRho: inst.soilRho,
        bands: [band('Sand bedding', 'sand', Math.max(0.3, d - 0.45), d)],
      }),
    ],
    slabs: [],
  };
}
