// Trench cross-section: ground lookup, conversion to the IEC 60287 backfill method, templates.
import { GROUND } from './materials';
import type { NumInput, NumObject } from './numeric';
import type { BackfillSpec, CircuitSpec, InstallationSpec, SoilLayer, TrenchSpec, TrenchZone } from './types';

const uid = () => Math.random().toString(36).slice(2, 10);

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

/** Half the trench width at depth y (m), with straight sloped walls. */
export function trenchHalfWidth(t: TrenchSpec, y: number): number {
  const f = Math.min(1, Math.max(0, y / t.depth_m));
  return (t.topWidth_m + (t.bottomWidth_m - t.topWidth_m) * f) / 2;
}

export function insideTrench(t: TrenchSpec, x: number, y: number): boolean {
  return t.present && y >= 0 && y <= t.depth_m && Math.abs(x - t.centreX_m) <= trenchHalfWidth(t, y);
}

/** Fill zone of the trench at depth y, if any. */
export function zoneAt(t: TrenchSpec, y: number): TrenchZone | undefined {
  return t.zones.find((z) => y >= z.top_m && y <= z.bottom_m);
}

/** Thermal resistivity (K·m/W) at a point, x and y in m. Cables and ducts are not included. */
export function groundRho(t: TrenchSpec, x: number, y: number): number {
  for (const s of t.slabs) {
    if (s.kind !== 'tile') continue;
    if (Math.abs(x - s.x_m) <= s.width_m / 2 && y >= s.depth_m && y <= s.depth_m + s.thickness_m) return s.rho;
  }
  if (insideTrench(t, x, y)) {
    const z = zoneAt(t, y);
    if (z) return z.rho;
  }
  return layerAt(t, y).rho;
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

/** Input for the numerical model: ground resistivity from the trench layout (mm coordinates). */
export function trenchNumericInput(t: TrenchSpec, objects: NumObject[]): NumInput {
  const xs: number[] = [];
  const ys: number[] = layerBoundaries(t).map((y) => y * 1000);
  if (t.present) {
    ys.push(t.depth_m * 1000);
    t.zones.forEach((z) => ys.push(z.top_m * 1000, z.bottom_m * 1000));
    if (t.topWidth_m === t.bottomWidth_m) xs.push((t.centreX_m - t.bottomWidth_m / 2) * 1000, (t.centreX_m + t.bottomWidth_m / 2) * 1000);
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
 * The trench as the IEC 60287 method sees it: the fill zone around the main circuit becomes
 * a backfill rectangle (IEC 60287-2-1 2.2.7.3), the native layer at cable depth gives ρe.
 * Other layers, cover tiles and sloped walls are only taken into account by the numerical model.
 */
export function trenchToIec(inst: InstallationSpec): { iec: InstallationSpec; notes: string[]; warnings: string[] } {
  const t = inst.trench;
  const notes: string[] = [];
  const warnings: string[] = [];
  if (!t || !t.layers.length) {
    return {
      iec: { ...inst, type: 'direct', backfill: null },
      notes,
      warnings: ['The trench has no ground layers; uniform soil is assumed.'],
    };
  }
  const x = inst.mainX_m ?? 0;
  const y = inst.depth_m;
  const native = layerAt(t, y);
  let backfill: BackfillSpec | null = null;
  const zone = insideTrench(t, x, y) ? zoneAt(t, y) : undefined;
  if (zone) {
    const yc = (zone.top_m + zone.bottom_m) / 2;
    backfill = {
      name: zone.name || GROUND[zone.material].label,
      centreX_m: t.centreX_m,
      centreDepth_m: yc,
      width_m: 2 * trenchHalfWidth(t, yc),
      height_m: zone.bottom_m - zone.top_m,
      rho: zone.rho,
    };
    notes.push(
      `IEC method: the fill zone “${backfill.name}” (ρ ${zone.rho} K·m/W, ${backfill.width_m.toFixed(2)} × ${backfill.height_m.toFixed(2)} m) is treated as a backfill rectangle in the layer “${native.name}” (ρ ${native.rho} K·m/W), IEC 60287-2-1 2.2.7.3.`,
    );
  } else {
    notes.push(`IEC method: uniform ground with the resistivity of the layer “${native.name}” at cable depth (ρ ${native.rho} K·m/W).`);
  }
  const otherLayers = new Set(t.layers.map((l) => l.rho)).size > 1;
  if (otherLayers || t.slabs.some((s) => s.kind === 'tile') || t.zones.length > 1 || t.topWidth_m !== t.bottomWidth_m)
    notes.push('Soil layers, cover tiles, other fill zones and sloped walls are only included in the numerical result.');
  if (inst.soilModel !== 'moist') warnings.push('Soil drying models are not used with a trench layout; moist ground is assumed.');
  return {
    iec: {
      ...inst,
      type: t.ducted ? 'ducts' : 'direct',
      soilRho: native.rho,
      soilModel: 'moist',
      backfill,
    },
    notes,
    warnings,
  };
}

// ---------------------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------------------

const layer = (name: string, material: SoilLayer['material'], thickness_m: number, rho?: number): SoilLayer => ({
  id: uid(),
  name,
  material,
  thickness_m,
  rho: rho ?? GROUND[material].rho,
});
const zone = (name: string, material: TrenchZone['material'], top_m: number, bottom_m: number, rho?: number): TrenchZone => ({
  id: uid(),
  name,
  material,
  top_m,
  bottom_m,
  rho: rho ?? GROUND[material].rho,
});

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
      depth_m: 0.85,
      mainX_m: -0.2,
      bonding: 'both',
      ratingMode: 'own-limit',
      trench: {
        present: true,
        centreX_m: 0,
        depth_m: 1.0,
        bottomWidth_m: 0.8,
        topWidth_m: 0.8,
        surface: 'grass',
        ducted: false,
        layers: [layer('Topsoil', 'topsoil', 0.3), layer('Clay', 'clay', 1.5), layer('Sand subsoil', 'sand', 5)],
        zones: [zone('Sand bedding', 'sand', 0.6, 1.0), zone('Excavated soil', 'clay', 0.0, 0.6, 1.2)],
        slabs: [
          { id: uid(), kind: 'tile', x_m: 0, depth_m: 0.6, width_m: 0.7, thickness_m: 0.02, rho: GROUND.polymer.rho },
          { id: uid(), kind: 'tape', x_m: 0, depth_m: 0.3, width_m: 0.5, thickness_m: 0.005, rho: 1 },
        ],
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
      spacing_mm: 250,
      transposed: false,
      depth_m: 1.25,
      mainX_m: 0,
      bonding: 'cross',
      trench: {
        present: true,
        centreX_m: 0,
        depth_m: 1.5,
        bottomWidth_m: 1.0,
        topWidth_m: 1.6,
        surface: 'grass',
        ducted: false,
        layers: [layer('Topsoil', 'topsoil', 0.3), layer('Clay', 'clay', 2.0), layer('Sand subsoil', 'sand', 5, 1.1)],
        zones: [zone('CBS', 'cbs', 0.95, 1.5), zone('Excavated soil', 'clay', 0.0, 0.95, 1.2)],
        slabs: [
          { id: uid(), kind: 'tile', x_m: 0, depth_m: 0.95, width_m: 0.9, thickness_m: 0.05, rho: GROUND.concrete.rho },
          { id: uid(), kind: 'tape', x_m: 0, depth_m: 0.5, width_m: 0.6, thickness_m: 0.005, rho: 1 },
        ],
      },
      circuits: [],
    }),
  },
  {
    id: 'road',
    label: 'Road crossing, ducts in concrete',
    description: 'Under asphalt and sub-base. Trefoil ducts encased in concrete, 0.8 m wide trench, 1.4 m deep.',
    apply: (inst) => ({
      ...inst,
      type: 'trench',
      formation: 'trefoil',
      touching: true,
      depth_m: 1.15,
      mainX_m: 0,
      bonding: inst.bonding,
      duct: { ...inst.duct, material: 'PE', innerD_mm: Math.max(inst.duct.innerD_mm, 100), outerD_mm: Math.max(inst.duct.outerD_mm, 110) },
      trench: {
        present: true,
        centreX_m: 0,
        depth_m: 1.4,
        bottomWidth_m: 0.8,
        topWidth_m: 0.8,
        surface: 'asphalt',
        ducted: true,
        layers: [layer('Asphalt', 'asphalt', 0.12), layer('Sub-base', 'subbase', 0.35), layer('Clay', 'clay', 2), layer('Sand subsoil', 'sand', 5)],
        zones: [zone('Concrete', 'concrete', 0.85, 1.4), zone('Sub-base fill', 'subbase', 0.0, 0.85)],
        slabs: [{ id: uid(), kind: 'tape', x_m: 0, depth_m: 0.6, width_m: 0.5, thickness_m: 0.005, rho: 1 }],
      },
      circuits: [],
    }),
  },
  {
    id: 'hdd',
    label: 'Drilled crossing (HDD), 6 m deep',
    description: 'No trench. One HDPE pipe per cable, 1.5 m apart, in layered ground under a river bank.',
    apply: (inst) => ({
      ...inst,
      type: 'trench',
      formation: 'flat',
      touching: false,
      spacing_mm: 1500,
      transposed: false,
      depth_m: 6,
      mainX_m: 0,
      duct: { ...inst.duct, material: 'PE', innerD_mm: Math.max(inst.duct.innerD_mm, 180), outerD_mm: Math.max(inst.duct.outerD_mm, 200) },
      trench: {
        present: false,
        centreX_m: 0,
        depth_m: 1,
        bottomWidth_m: 1,
        topWidth_m: 1,
        surface: 'grass',
        ducted: true,
        layers: [layer('Topsoil', 'topsoil', 0.4), layer('Clay', 'clay', 3), layer('Wet sand', 'sand', 6, 0.8), layer('Gravel', 'gravel', 10)],
        zones: [],
        slabs: [],
      },
      circuits: [],
    }),
  },
];

/** A plain trench to start from: the current circuit in sand, 1.0 m deep. */
export function defaultTrench(inst: InstallationSpec): TrenchSpec {
  const d = Math.max(inst.depth_m + 0.25, 0.9);
  return {
    present: true,
    centreX_m: inst.mainX_m ?? 0,
    depth_m: d,
    bottomWidth_m: 0.7,
    topWidth_m: 0.7,
    surface: 'grass',
    ducted: inst.type === 'ducts' || inst.type === 'ductbank',
    layers: [layer('Topsoil', 'topsoil', 0.3), layer('Native soil', 'clay', 5, inst.soilRho)],
    zones: [zone('Sand bedding', 'sand', Math.max(0.3, d - 0.45), d)],
    slabs: [],
  };
}
