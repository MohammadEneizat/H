// Turns a DXF drawing into a cross-section layout of the editor.
import { formationOf, type DxfLayout } from './dxf';
import { GROUND } from './materials';
import { circleShape, polygonShape, uid } from './trench';
import type { CableSpec, CircuitSpec, ConduitSpec, InstallationSpec } from './types';

/** Cables per circuit for this cable: 3 (AC single-core), 2 (DC), 1 (three-core). */
export function cablesPerCircuit(cable: CableSpec): 1 | 2 | 3 {
  if (cable.cores === 3) return 1;
  return cable.system === 'dc' ? 2 : 3;
}

/**
 * Builds the layout from the drawing: regions as fill shapes (largest first, so smaller ones
 * lie on top), conduits, bores and circuits. The circuit nearest x = 0 becomes the main circuit.
 * Ground layers and the ground surface are kept; heat sources, tiles and tape are cleared.
 * When the drawing has no cables, the circuits are kept as they are.
 */
export function applyDxfLayout(inst: InstallationSpec, layout: DxfLayout): InstallationSpec {
  const t = inst.trench!;
  const nativeRho = t.layers[t.layers.length - 1]?.rho ?? inst.soilRho;
  const shapes = [
    ...layout.regions.map((r) =>
      polygonShape(r.label, r.material, r.points, r.rho ?? (r.material === 'clay' ? nativeRho : GROUND[r.material].rho)),
    ),
    ...layout.bores.map((b) => circleShape('Bore', 'bentonite', b.x / 1000, b.y / 1000, b.d / 1000)),
  ];
  const conduits: ConduitSpec[] = layout.conduits.map((k, i) => ({
    id: uid(),
    name: `Conduit ${i + 1} (⌀ ${Math.round(k.Do)})`,
    x_m: +(k.x / 1000).toFixed(4),
    depth_m: +(k.y / 1000).toFixed(4),
    material: 'PE',
    innerD_mm: Math.round(k.Di * 10) / 10,
    outerD_mm: Math.round(k.Do * 10) / 10,
  }));
  const base: InstallationSpec = {
    ...inst,
    type: 'trench',
    heatSources: [],
    conduits,
    trench: { ...t, shapes, slabs: [], underlay: layout.underlay },
  };
  if (!layout.circuits.length) return { ...base, conduits: [...conduits], mainConduit: undefined, circuits: inst.circuits.map((c) => ({ ...c, conduit: undefined })) };

  const placed = layout.circuits.map((c) => ({ c, f: formationOf(c.cables, c.d) }));
  placed.sort((a, b) => Math.abs(a.f.x) - Math.abs(b.f.x) || b.f.y - a.f.y);
  const [main, ...rest] = placed;
  const mm = (v: number) => +(v / 1000).toFixed(4);
  const kid = (i?: number) => (i === undefined || i < 0 ? undefined : conduits[i]?.id);
  const out: InstallationSpec = {
    ...base,
    mainX_m: mm(main.f.x),
    depth_m: mm(main.f.y),
    formation: main.f.formation,
    rotated: main.f.rotated,
    touching: main.f.touching,
    spacing_mm: Math.round(main.f.spacing),
    mainConduit: kid(main.c.conduit),
    duct: main.c.duct ? { ...inst.duct, innerD_mm: Math.round(main.c.duct.Di), outerD_mm: Math.round(main.c.duct.Do) } : inst.duct,
    trench: { ...base.trench!, ducted: !!main.c.duct },
    circuits: rest.map(
      ({ c, f }, i): CircuitSpec => ({
        id: uid(),
        name: `C${i + 2}`,
        cable: null,
        x_m: mm(f.x),
        depth_m: mm(f.y),
        formation: f.formation,
        rotated: f.rotated,
        touching: f.touching,
        spacing_mm: Math.round(f.spacing),
        transposed: false,
        bonding: inst.bonding,
        crossBondLambda1: null,
        load: 'rated',
        current_A: 0,
        conduit: kid(c.conduit),
        ducted: !!c.duct,
        duct: c.duct ? { material: inst.duct.material, innerD_mm: Math.round(c.duct.Di), outerD_mm: Math.round(c.duct.Do) } : undefined,
      }),
    ),
  };
  return out;
}
