import React, { useId, useMemo, useRef, useState } from 'react';
import {
  GROUND,
  TRENCH_TEMPLATES,
  band as makeBand,
  circleShape,
  deriveGeometry,
  layerBoundaries,
  layoutCircuits,
  parseDxf,
  placeInConduits,
  polygonShape,
  rectShape,
  shapeBounds,
  trenchHalfWidth,
  trenchShape,
  uid,
  type CableGeometry,
  type CableSpec,
  type CircuitSpec,
  type ConduitSpec,
  type DxfDoc,
  type GroundMaterial,
  type GroundShape,
  type HeatSource,
  type InstallationSpec,
  type RatingResult,
  type SoilLayer,
  type TrenchSlab,
  type TrenchSpec,
} from '../engine';
import { CableGlyph, DC_PLUS, GroundDefs, HeatLegend, HeatOverlay, metalOf } from './Drawing';
import { DxfImport } from './DxfImport';
import sampleDxf from '../samples/pv-dc-trench.dxf?raw';
import { NumField, SelectField, Segmented, TextField, Toggle } from './fields';
import { amps, fmt } from './format';
import { analyticField, gridMax, heatLayer, isoLevels, niceStep, sampleField, type FieldSourceLike, type HeatLayer, type Region } from './heatmap';
import { MaterialDefs } from './textures';
import type { Palette } from './theme';
import type { NumericState } from './useNumeric';

const FONT = "'IBM Plex Sans', 'DejaVu Sans', system-ui, sans-serif";
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const materialOptions = (Object.keys(GROUND) as GroundMaterial[]).map((m) => ({ value: m, label: GROUND[m].label }));
const ductOptions = [
  { value: 'PE', label: 'PE / HDPE' },
  { value: 'PVC', label: 'PVC' },
  { value: 'earthenware', label: 'Earthenware' },
] as const;

export type Selection =
  | { kind: 'layer'; id: string }
  | { kind: 'shape'; id: string; band?: string; vertex?: number }
  | { kind: 'slab'; id: string }
  | { kind: 'circuit'; index: number }
  | { kind: 'source'; id: string }
  | { kind: 'conduit'; id: string }
  | null;

interface Group {
  name: string;
  positions: { x: number; y: number }[];
  geo: CableGeometry;
  D: number;
  ductD?: number;
  ductInnerD?: number;
  hottest: number;
  temp: number;
  I: number;
  metal: [string, string, string];
  cond: [string, string, string];
  /** Shared conduit holding the circuit (mm) */
  conduit?: { id: string; x: number; y: number; Do: number; Di: number };
}

export interface TrenchScene {
  region: Region;
  groups: Group[];
  heat: { tMin: number; tMax: number; levels: number[] } | null;
  field: FieldSourceLike | null;
  numeric: boolean;
}

export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

/** Layout and temperature scale of the cross-section drawing. Region in mm. */
export function trenchScene(
  cable: CableSpec,
  inst: InstallationSpec,
  iec: RatingResult,
  num: NumericState | null,
  pal: Palette,
  view: View = { zoom: 1, panX: 0, panY: 0 },
): TrenchScene | null {
  const t = inst.trench;
  if (!t) return null;
  const useNum = iec.ok && !!num?.fresh && !!num.data?.result.ok;
  const r = useNum ? num!.data!.result : iec;
  // Without a rating, draw the circuits where the inputs put them so the layout can be fixed
  const base: {
    name: string;
    positions: { x: number; y: number }[];
    cablePositions: { x: number; y: number }[];
    conduit?: Group['conduit'];
    De: number;
    ductD?: number;
    ductInnerD?: number;
    hottest: number;
    hottestTemp: number;
    I: number;
    geo?: CableGeometry;
  }[] = !iec.ok
    ? layoutCircuits(cable, inst).map((c) => ({ ...c, hottest: -1, hottestTemp: NaN, I: NaN, geo: c.geometry }))
    : (r.system?.circuits ?? [
        {
          name: 'C1',
          positions: r.positions,
          cablePositions: r.geometry.cores === 3 ? [r.positions[0]] : r.positions,
          De: r.geometry.De,
          ductD: t.ducted ? inst.duct.outerD_mm : undefined,
          ductInnerD: t.ducted ? inst.duct.innerD_mm : undefined,
          hottest: r.thermal.t4.hottest,
          hottestTemp: r.temperatures.conductor,
          I: r.I,
        },
      ]);
  const groups: Group[] = base.map((c, i) => {
    const cab = i === 0 ? cable : (inst.circuits[i - 1]?.cable ?? cable);
    return {
      name: c.name.replace(' (main)', ''),
      positions: c.cablePositions,
      conduit: c.conduit,
      geo: c.geo ?? (i === 0 ? iec.geometry : deriveGeometry(cab).geometry),
      D: c.ductD ?? c.De,
      ductD: c.ductD,
      ductInnerD: c.ductInnerD,
      hottest: c.hottest,
      temp: c.hottestTemp,
      I: c.I,
      metal: metalOf(pal, cab.screen.material),
      cond: metalOf(pal, cab.conductor.material),
    };
  });
  // Bounding box of everything (mm)
  let x0 = Infinity;
  let x1 = -Infinity;
  let y1 = 0;
  const grow = (a: number, b: number, yb: number) => {
    x0 = Math.min(x0, a);
    x1 = Math.max(x1, b);
    y1 = Math.max(y1, yb);
  };
  groups.forEach((g) => g.positions.forEach((p) => grow(p.x - g.D / 2, p.x + g.D / 2, p.y + g.D / 2)));
  t.shapes.forEach((s) => {
    const b = shapeBounds(s);
    grow(b.x0 * 1000, b.x1 * 1000, b.y1 * 1000);
  });
  t.slabs.forEach((s) => grow((s.x_m - s.width_m / 2) * 1000, (s.x_m + s.width_m / 2) * 1000, (s.depth_m + s.thickness_m) * 1000));
  (inst.heatSources ?? []).forEach((h) => grow(h.x_m * 1000 - h.diameter_mm / 2, h.x_m * 1000 + h.diameter_mm / 2, h.depth_m * 1000 + h.diameter_mm / 2));
  (inst.conduits ?? []).forEach((k) => grow(k.x_m * 1000 - k.outerD_mm / 2, k.x_m * 1000 + k.outerD_mm / 2, k.depth_m * 1000 + k.outerD_mm / 2));
  y1 += Math.max(450, y1 * 0.3);
  const padX = Math.max(600, (x1 - x0) * 0.3);
  x0 -= padX;
  x1 += padX;
  let y0 = -Math.max(180, y1 * 0.09);
  let w = x1 - x0;
  let h = y1 - y0;
  if (w < h * 1.35) {
    const e = (h * 1.35 - w) / 2;
    x0 -= e;
    x1 += e;
  } else if (w > h * 2.4) {
    y1 += w / 2.4 - h;
  }
  y0 = -Math.max(180, (y1 - y0) * 0.09);
  // Zoom and pan
  w = (x1 - x0) / view.zoom;
  h = (y1 - y0) / view.zoom;
  const cx = (x0 + x1) / 2 + view.panX;
  const cy = (y0 + y1) / 2 + view.panY;
  const region = { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };

  let field: FieldSourceLike | null = null;
  if (useNum) field = { fn: num!.data!.field, sources: num!.data!.numeric.objects };
  else if (iec.ok && iec.field) field = analyticField(iec.field);
  let heat: TrenchScene['heat'] = null;
  if (field) {
    const probe = sampleField(field.fn, { ...region, y0: Math.max(0, region.y0) }, 120, 90);
    const fmax = gridMax(probe);
    const tMin = inst.ambient_C;
    if (Number.isFinite(fmax) && fmax > tMin + 0.5) {
      const step = niceStep(fmax - tMin, 7);
      const tMax = Math.ceil(fmax / step) * step;
      heat = { tMin, tMax, levels: isoLevels(tMin, tMax) };
    }
  }
  return { region, groups, heat, field, numeric: useNum };
}

export function trenchHeat(scene: TrenchScene, pal: Palette): HeatLayer | null {
  if (!scene.heat || !scene.field || scene.region.y1 <= 0) return null;
  const { tMin, tMax, levels } = scene.heat;
  return heatLayer(scene.field, { ...scene.region, y0: Math.max(0, scene.region.y0) }, 300, tMin, tMax, levels, pal.heat);
}

interface DragApi {
  start: (e: React.PointerEvent, kind: string, a?: string | number, b?: string | number) => void;
  selection: Selection;
}

/** Outline of a trench shape as SVG points (mm), between two depths (m). */
function trenchPoints(s: GroundShape, top: number, bottom: number): string {
  const hw = (y: number) => trenchHalfWidth(s, y) * 1000;
  const cx = s.x_m * 1000;
  const yt = top * 1000;
  const yb = bottom * 1000;
  return `${cx - hw(top)},${yt} ${cx + hw(top)},${yt} ${cx + hw(bottom)},${yb} ${cx - hw(bottom)},${yb}`;
}

/** The cross-section drawing; interactive when `drag` is given. */
/** The imported DXF drawing as thin lines. */
function Underlay({ u, pal, sw, fs }: { u: NonNullable<TrenchSpec['underlay']>; pal: Palette; sw: number; fs: number }) {
  const d = useMemo(() => {
    let out = '';
    for (let i = 0; i + 3 < u.lines.length; i += 4) out += `M${u.lines[i]} ${u.lines[i + 1]}L${u.lines[i + 2]} ${u.lines[i + 3]}`;
    return out;
  }, [u]);
  const circles = [];
  for (let i = 0; i + 2 < u.circles.length; i += 3) circles.push([u.circles[i], u.circles[i + 1], u.circles[i + 2]]);
  return (
    <g pointerEvents="none" opacity={0.75}>
      <path d={d} fill="none" stroke={pal.ink} strokeWidth={sw * 0.7} strokeLinecap="round" />
      {circles.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="none" stroke={pal.ink} strokeWidth={sw * 0.5} />
      ))}
      {u.texts.map((t, i) => (
        <text key={`t${i}`} x={t.x} y={t.y} fontSize={Math.min(t.h, fs * 1.2)} fill={pal.ink2}>
          {t.t}
        </text>
      ))}
    </g>
  );
}

export function TrenchSvg({
  inst,
  scene,
  heat,
  pal,
  idPrefix,
  showHeat,
  showLabels = true,
  showUnderlay = true,
  drag,
}: {
  inst: InstallationSpec;
  scene: TrenchScene;
  heat: HeatLayer | null;
  pal: Palette;
  idPrefix: string;
  showHeat: boolean;
  showLabels?: boolean;
  /** Draw the imported DXF drawing over the ground */
  showUnderlay?: boolean;
  drag?: DragApi;
}) {
  const t = inst.trench!;
  const id = (s: string) => `${idPrefix}-${s}`;
  const R = scene.region;
  const W = R.x1 - R.x0;
  const sw = W / 600;
  const fs = W / 52;
  const tile = W / 26;
  const sel = drag?.selection;
  const selShape = sel?.kind === 'shape' ? sel.id : null;
  const halo = { stroke: pal.halo, strokeWidth: fs * 0.25, paintOrder: 'stroke' as const };
  const pat = (m: GroundMaterial) => `url(#${idPrefix}-m-${m})`;
  const on = (kind: string, a?: string | number, b?: string | number) =>
    drag ? { onPointerDown: (e: React.PointerEvent) => drag.start(e, kind, a, b) } : {};
  const handle = (key: string, x: number, y: number, kind: string, cur: string, a?: string | number, b?: string | number, small = false) => (
    <rect
      key={key}
      x={x - sw * (small ? 4 : 6)}
      y={y - sw * (small ? 4 : 6)}
      width={sw * (small ? 8 : 12)}
      height={sw * (small ? 8 : 12)}
      rx={small ? sw * 4 : 0}
      fill={small ? pal.accent : pal.panel}
      stroke={pal.accent}
      strokeWidth={sw * 1.4}
      className="drag"
      style={{ cursor: cur }}
      {...on(kind, a, b)}
    />
  );

  // Native layers
  let top = 0;
  const layers = t.layers
    .map((l, i) => {
      const last = i === t.layers.length - 1;
      const bottom = last ? Math.max(R.y1, top) : top + l.thickness_m * 1000;
      const out = { l, top, bottom: Math.min(bottom, Math.max(R.y1, top)), last: last || bottom >= R.y1 };
      top = bottom;
      return out;
    })
    .filter((x) => x.top < R.y1 && x.bottom > Math.max(0, R.y0));
  const surfaceH = Math.max(sw * 5, (R.y1 - R.y0) * 0.012);

  const shapeEl = (s: GroundShape) => {
    const selected = selShape === s.id;
    const stroke = selected ? pal.accent : pal.ink3;
    const strokeWidth = sw * (selected ? 2.4 : 0.9);
    const common = {
      className: drag ? 'drag' : undefined,
      style: { cursor: drag ? 'move' : undefined },
      ...on('shape', s.id),
    };
    switch (s.kind) {
      case 'trench':
        return (
          <g key={s.id}>
            <polygon points={trenchPoints(s, s.y_m, s.y_m + s.height_m)} fill={pat(s.material)} {...common} />
            {(s.bands ?? []).map((b) => {
              const bt = Math.max(s.y_m, b.top_m);
              const bb = Math.min(s.y_m + s.height_m, b.bottom_m);
              if (bb <= bt) return null;
              return <polygon key={b.id} points={trenchPoints(s, bt, bb)} fill={pat(b.material)} {...common} {...on('shape', s.id, b.id)} />;
            })}
            <polygon points={trenchPoints(s, s.y_m, s.y_m + s.height_m)} fill="none" stroke={stroke} strokeWidth={strokeWidth * 1.3} strokeDasharray={`${sw * 7} ${sw * 4}`} pointerEvents="none" />
          </g>
        );
      case 'rect':
        return (
          <rect key={s.id} x={(s.x_m - s.width_m / 2) * 1000} y={s.y_m * 1000} width={s.width_m * 1000} height={s.height_m * 1000} fill={pat(s.material)} stroke={stroke} strokeWidth={strokeWidth} {...common} />
        );
      case 'circle':
        return <circle key={s.id} cx={s.x_m * 1000} cy={s.y_m * 1000} r={(s.width_m / 2) * 1000} fill={pat(s.material)} stroke={stroke} strokeWidth={strokeWidth} {...common} />;
      case 'polygon':
        return (
          <polygon key={s.id} points={(s.points ?? []).map(([x, y]) => `${x * 1000},${y * 1000}`).join(' ')} fill={pat(s.material)} stroke={stroke} strokeWidth={strokeWidth} {...common} />
        );
    }
  };

  // Circuit labels: positions first, so other labels can keep clear of them
  const circLabels = (() => {
    type Box = { x0: number; x1: number; y0: number; y1: number };
    const items = scene.groups.map((g, gi) => {
      const xs = g.positions.map((p) => p.x);
      const ys = g.positions.map((p) => p.y);
      const bx0 = Math.min(...xs) - g.D / 2 - sw * 6;
      const by0 = Math.min(...ys) - g.D / 2 - sw * 6;
      const bw = Math.max(...xs) - Math.min(...xs) + g.D + sw * 12;
      const bh = Math.max(...ys) - Math.min(...ys) + g.D + sw * 12;
      const k = g.conduit;
      const gx = k ? k.x : xs.reduce((a, b) => a + b, 0) / xs.length;
      const top = (k ? k.y - k.Do / 2 : by0) - fs * 0.4;
      const bottom = (k ? k.y + k.Do / 2 : by0 + bh) + fs * 1.1;
      const text = Number.isFinite(g.I) ? `${g.name} · ${amps(g.I)} A · ${fmt(g.temp, 0)} °C` : g.name;
      const tw = text.length * fs * 0.56;
      return { gi, bx0, by0, bw, bh, gx, top, bottom, text, tw };
    });
    // Place labels left to right, above or below their circuit, in further rows where they would collide
    const placed: Box[] = items.map((it) => ({ x0: it.bx0, x1: it.bx0 + it.bw, y0: it.by0, y1: it.by0 + it.bh }));
    const hit = (b: Box) => placed.some((p) => !(b.x1 < p.x0 || b.x0 > p.x1 || b.y1 < p.y0 || b.y0 > p.y1));
    const ly = new Map<number, number>();
    [...items]
      .sort((a, b) => a.gx - b.gx)
      .forEach((it, n) => {
        const sides = n % 2 ? (['below', 'above'] as const) : (['above', 'below'] as const);
        let found: number | null = null;
        for (let row = 0; row < 6 && found === null; row++)
          for (const side of sides) {
            const y = side === 'above' ? it.top - row * fs * 1.15 : it.bottom + row * fs * 1.15;
            const box = { x0: it.gx - it.tw / 2, x1: it.gx + it.tw / 2, y0: y - fs, y1: y + fs * 0.2 };
            if (!hit(box)) {
              found = y;
              placed.push(box);
              break;
            }
          }
        ly.set(it.gi, found ?? it.top);
      });
    return items.map((it) => {
      const y = ly.get(it.gi)!;
      return { ...it, ly: y, box: { x0: it.gx - it.tw / 2, x1: it.gx + it.tw / 2, y0: y - fs, y1: y + fs * 0.2 } };
    });
  })();
  const clear = (x: number, y: number, text: string, size: number) => {
    const b = { x0: x, x1: x + text.length * size * 0.56, y0: y - size, y1: y + size * 0.2 };
    return circLabels.every((c) => b.x1 < c.box.x0 || b.x0 > c.box.x1 || b.y1 < c.box.y0 || b.y0 > c.box.y1);
  };
  const placeLabel = (key: string, x: number, yTop: number, yBottom: number, text: string) => {
    const size = fs * 0.72;
    const y = clear(x, yTop, text, size) ? yTop : clear(x, yBottom, text, size) ? yBottom : null;
    if (y === null) return null;
    return (
      <text key={key} x={x} y={y} fontSize={size} fill={pal.ink} {...halo} pointerEvents="none">
        {text}
      </text>
    );
  };

  const shapeLabel = (s: GroundShape) => {
    const b = shapeBounds(s);
    const out: React.ReactNode[] = [];
    if ((b.y1 - b.y0) * 1000 > fs * 1.8 && (b.x1 - b.x0) * 1000 > fs * 5) {
      const x = s.kind === 'trench' ? (s.x_m - trenchHalfWidth(s, s.y_m + 0.02)) * 1000 + fs * 0.4 : b.x0 * 1000 + fs * 0.4;
      out.push(placeLabel('n', x, b.y0 * 1000 + fs * 1.2, b.y1 * 1000 - fs * 0.5, `${s.name} · ρ ${fmt(s.rho, 2)}`));
    }
    (s.bands ?? []).forEach((bd) => {
      const bt = Math.max(s.y_m, bd.top_m);
      const bb = Math.min(s.y_m + s.height_m, bd.bottom_m);
      if ((bb - bt) * 1000 < fs * 1.6) return;
      out.push(
        placeLabel(bd.id, (s.x_m - trenchHalfWidth(s, bt + 0.01)) * 1000 + fs * 0.4, bt * 1000 + fs * 1.2, bb * 1000 - fs * 0.5, `${bd.name} · ρ ${fmt(bd.rho, 2)}`),
      );
    });
    return <g key={`l${s.id}`}>{out}</g>;
  };

  // Shape handles for the selection
  const handles: React.ReactNode[] = [];
  const selected = selShape ? t.shapes.find((s) => s.id === selShape) : undefined;
  if (drag && selected) {
    const s = selected;
    const X = (v: number) => v * 1000;
    if (s.kind === 'rect') {
      const [l, r, tp, bt] = [X(s.x_m - s.width_m / 2), X(s.x_m + s.width_m / 2), X(s.y_m), X(s.y_m + s.height_m)];
      handles.push(
        handle('nw', l, tp, 'rect-corner', 'nwse-resize', s.id, 0),
        handle('ne', r, tp, 'rect-corner', 'nesw-resize', s.id, 1),
        handle('se', r, bt, 'rect-corner', 'nwse-resize', s.id, 2),
        handle('sw', l, bt, 'rect-corner', 'nesw-resize', s.id, 3),
      );
    } else if (s.kind === 'trench') {
      const tw = (s.topWidth_m ?? s.width_m) / 2;
      handles.push(
        handle('tt', X(s.x_m + tw), X(s.y_m), 'trench-top', 'ew-resize', s.id),
        handle('tc', X(s.x_m + s.width_m / 2), X(s.y_m + s.height_m), 'trench-corner', 'nwse-resize', s.id),
      );
      (s.bands ?? []).forEach((bd) => {
        (['top', 'bottom'] as const).forEach((edge) => {
          const y = edge === 'top' ? bd.top_m : bd.bottom_m;
          if (y <= s.y_m + 1e-6 || y >= s.y_m + s.height_m - 1e-6) return;
          const hw = trenchHalfWidth(s, y);
          handles.push(
            <line
              key={`${bd.id}${edge}`}
              x1={X(s.x_m - hw)}
              y1={X(y)}
              x2={X(s.x_m + hw)}
              y2={X(y)}
              stroke={sel?.kind === 'shape' && sel.band === bd.id ? pal.accent : 'transparent'}
              strokeWidth={sw * 8}
              strokeOpacity={sel?.kind === 'shape' && sel.band === bd.id ? 0.5 : 1}
              className="drag"
              style={{ cursor: 'ns-resize' }}
              {...on(`band-${edge}`, s.id, bd.id)}
            />,
          );
        });
      });
    } else if (s.kind === 'circle') {
      handles.push(handle('cr', X(s.x_m + s.width_m / 2), X(s.y_m), 'circle-r', 'ew-resize', s.id));
    } else if (s.kind === 'polygon' && s.points) {
      const pts = s.points;
      pts.forEach(([x, y], i) => {
        const nx = pts[(i + 1) % pts.length];
        handles.push(handle(`m${i}`, X((x + nx[0]) / 2), X((y + nx[1]) / 2), 'vertex-add', 'copy', s.id, i, true));
      });
      pts.forEach(([x, y], i) => handles.push(handle(`v${i}`, X(x), X(y), 'vertex', 'move', s.id, i)));
    }
  }

  const dimTrench = selected?.kind === 'trench' ? selected : t.shapes.find((s) => s.kind === 'trench');

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${R.x0} ${R.y0} ${W} ${R.y1 - R.y0}`}
      role="img"
      aria-label="Cross-section of the installation"
      fontFamily={FONT}
      className="trench-svg"
    >
      <defs>
        <GroundDefs id={id} pal={pal} tile={tile} />
        <MaterialDefs prefix={idPrefix} mode={pal.mode} tile={tile} />
        <pattern id={id('tape')} width={tile * 0.5} height={tile * 0.5} patternUnits="userSpaceOnUse">
          <rect width={tile * 0.5} height={tile * 0.5} fill="#f2c200" />
          <rect width={tile * 0.25} height={tile * 0.5} fill="#d6362a" />
        </pattern>
      </defs>
      <rect x={R.x0} y={R.y0} width={W} height={Math.max(0, -R.y0)} fill={`url(#${id('sky')})`} {...on('pan')} style={{ cursor: drag ? 'grab' : undefined }} />
      {layers.map(({ l, top: yt, bottom: yb }) => (
        <rect key={l.id} x={R.x0} y={yt} width={W} height={Math.max(0, yb - yt)} fill={pat(l.material)} {...on('pan', l.id)} style={{ cursor: drag ? 'grab' : undefined }} />
      ))}
      {t.shapes.map(shapeEl)}
      {t.surface === 'grass' ? (
        <g pointerEvents="none">
          <rect x={R.x0} y={-surfaceH} width={W} height={surfaceH * 1.2} fill={pal.grass} />
          {Array.from({ length: 90 }, (_, i) => {
            const x = R.x0 + (W * (i + 0.5)) / 90;
            return (
              <path
                key={i}
                d={`M${x} ${-surfaceH * 0.9} l ${-surfaceH * 0.5} ${-surfaceH * 1.4} M${x} ${-surfaceH * 0.9} l ${surfaceH * 0.4} ${-surfaceH * 1.6}`}
                stroke={pal.grass}
                strokeWidth={sw * 0.8}
                strokeLinecap="round"
              />
            );
          })}
        </g>
      ) : (
        <rect x={R.x0} y={-surfaceH * 0.6} width={W} height={surfaceH * 0.8} fill={t.surface === 'asphalt' ? '#2f3236' : '#9c958b'} pointerEvents="none" />
      )}
      {showHeat && heat && (
        <g pointerEvents="none">
          <HeatOverlay layer={heat} pal={pal} fs={fs * 0.85} labels sw={sw * 1.2} imageOpacity={0.72} />
        </g>
      )}
      {/* tiles and tape */}
      {t.slabs.map((s) => {
        const isSel = sel?.kind === 'slab' && sel.id === s.id;
        const x = (s.x_m - s.width_m / 2) * 1000;
        const y = s.depth_m * 1000;
        const w = s.width_m * 1000;
        const h = Math.max(s.thickness_m * 1000, s.kind === 'tape' ? sw * 3 : sw * 2);
        return (
          <g key={s.id}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill={s.kind === 'tape' ? `url(#${id('tape')})` : pat(s.rho >= 2 ? 'polymer' : 'concrete')}
              stroke={isSel ? pal.accent : pal.ink2}
              strokeWidth={sw * (isSel ? 2.2 : 0.8)}
              pointerEvents="none"
            />
            {drag && <rect x={x} y={y - sw * 6} width={w} height={h + sw * 12} fill="transparent" className="drag" style={{ cursor: 'move' }} {...on('slab', s.id)} />}
          </g>
        );
      })}
      {/* imported DXF drawing */}
      {showUnderlay && t.underlay && <Underlay u={t.underlay} pal={pal} sw={sw} fs={fs} />}
      {/* other heat sources */}
      {(inst.heatSources ?? []).map((hs, _k, all) => {
        const isSel = sel?.kind === 'source' && sel.id === hs.id;
        const x = hs.x_m * 1000;
        const y = hs.depth_m * 1000;
        const r = hs.diameter_mm / 2;
        const sorted = [...all].sort((a, b) => a.x_m - b.x_m);
        const pos = sorted.findIndex((q) => q.id === hs.id);
        const below = pos % 2 === 1 && Math.abs(sorted[pos].x_m - sorted[pos - 1].x_m) * 1000 < fs * 9;
        return (
          <g key={hs.id}>
            <circle cx={x} cy={y} r={r} fill="#22272b" stroke={isSel ? pal.accent : pal.jacketEdge} strokeWidth={sw * (isSel ? 3 : 1)} pointerEvents="none" />
            <circle cx={x} cy={y} r={r * 0.86} fill="#e7b43c" pointerEvents="none" />
            <circle cx={x} cy={y} r={r * 0.45} fill="#9aa3aa" stroke="#6b737a" strokeWidth={sw * 0.8} pointerEvents="none" />
            <text x={x} y={below ? y + r + fs * 1.1 : y - r - fs * 0.4} fontSize={fs * 0.8} textAnchor="middle" fill={pal.ink} {...halo} pointerEvents="none">
              {hs.name} · {fmt(hs.W, 0)} W/m
            </text>
            {drag && <circle cx={x} cy={y} r={r + sw * 4} fill="transparent" className="drag" style={{ cursor: 'move' }} {...on('source', hs.id)} />}
          </g>
        );
      })}
      {/* shared conduits */}
      {(inst.conduits ?? []).map((k) => {
        const isSel = sel?.kind === 'conduit' && sel.id === k.id;
        const x = k.x_m * 1000;
        const y = k.depth_m * 1000;
        return (
          <g key={k.id}>
            <circle cx={x} cy={y} r={k.outerD_mm / 2} fill={pal.duct} stroke={isSel ? pal.accent : pal.ductEdge} strokeWidth={sw * (isSel ? 3 : 0.8)} pointerEvents="none" />
            <circle cx={x} cy={y} r={k.innerD_mm / 2} fill={pal.air} pointerEvents="none" />
            {drag && (
              <circle
                cx={x}
                cy={y}
                r={k.outerD_mm / 2 + sw * 3}
                fill="transparent"
                className="drag"
                style={{ cursor: 'move' }}
                {...on('conduit', k.id)}
              />
            )}
          </g>
        );
      })}
      {/* ducts and cables */}
      {scene.groups.map((g, gi) => (
        <g key={gi} pointerEvents="none">
          {g.positions.map((p, i) => (
            <g key={i}>
              {g.ductD && (
                <>
                  <circle cx={p.x} cy={p.y} r={g.ductD / 2} fill={pal.duct} stroke={pal.ductEdge} strokeWidth={sw * 0.6} />
                  <circle cx={p.x} cy={p.y} r={(g.ductInnerD ?? g.ductD * 0.9) / 2} fill={pal.air} />
                </>
              )}
              <CableGlyph
                x={p.x}
                y={p.y}
                geo={g.geo}
                metal={g.metal}
                cond={g.cond}
                hot={gi === 0 && i === g.hottest}
                sw={sw}
                pal={pal}
                id={id}
                sheath={g.positions.length === 2 && i === 0 ? DC_PLUS : undefined}
              />
            </g>
          ))}
        </g>
      ))}
      {/* labels */}
      {showLabels && layers.map(({ l, top: yt, bottom: yb, last }) => (
        <text key={`ll${l.id}`} x={R.x0 + fs * 0.5} y={Math.min(yb, Math.max(yt, 0) + (last ? fs * 3 : (yb - Math.max(yt, 0)) / 2 + fs * 0.35))} fontSize={fs * 0.8} fill={pal.ink} {...halo} pointerEvents="none">
          {l.name} · ρ {fmt(l.rho, 2)}
        </text>
      ))}
      {showLabels && t.shapes.map(shapeLabel)}
      {/* circuit labels and hit areas */}
      {circLabels.map(({ gi, bx0, by0, bw, bh, gx, ly, text }) => {
        const isSel = sel?.kind === 'circuit' && sel.index === gi;
        return (
          <g key={`h${gi}`}>
            <text x={gx} y={ly} fontSize={fs} textAnchor="middle" fontWeight={600} fill={gi === 0 ? pal.accent : pal.ink} {...halo} pointerEvents="none">
              {text}
            </text>
            {(drag || isSel) && (
              <rect
                x={bx0}
                y={by0}
                width={bw}
                height={bh}
                rx={sw * 4}
                fill="transparent"
                stroke={isSel ? pal.accent : 'none'}
                strokeWidth={sw * 1.6}
                strokeDasharray={`${sw * 5} ${sw * 3}`}
                className={drag ? 'drag' : undefined}
                style={{ cursor: drag ? 'move' : undefined }}
                {...on('circuit', gi)}
              />
            )}
          </g>
        );
      })}
      {/* dimensions */}
      {dimTrench && (
        <g pointerEvents="none">
          {(() => {
            const s = dimTrench;
            const tw = (s.topWidth_m ?? s.width_m) * 1000;
            const cx = s.x_m * 1000;
            const yt = s.y_m * 1000;
            const yb = (s.y_m + s.height_m) * 1000;
            const xr = cx + Math.max(tw, s.width_m * 1000) / 2 + fs * 1.6;
            const yd = yt - surfaceH * 3.2;
            return (
              <>
                <line x1={cx - tw / 2} y1={yd} x2={cx + tw / 2} y2={yd} stroke={pal.ink2} strokeWidth={sw} markerStart={`url(#${id('arrow')})`} markerEnd={`url(#${id('arrow')})`} />
                <text x={cx} y={yd - fs * 0.35} fontSize={fs * 0.8} textAnchor="middle" fill={pal.ink} {...halo}>
                  {fmt(tw / 1000, 2)} m
                </text>
                <line x1={xr} y1={yt} x2={xr} y2={yb} stroke={pal.ink2} strokeWidth={sw} markerStart={`url(#${id('arrow')})`} markerEnd={`url(#${id('arrow')})`} />
                <text x={xr + fs * 0.4} y={(yt + yb) / 2} fontSize={fs * 0.8} fill={pal.ink} {...halo} dominantBaseline="middle">
                  {fmt(s.height_m, 2)} m
                </text>
              </>
            );
          })()}
        </g>
      )}
      {scene.groups[0] && (
        <g pointerEvents="none">
          {(() => {
            const g = scene.groups[0];
            const gx = g.conduit ? g.conduit.x - g.conduit.Do / 2 - fs * 1.2 : Math.min(...g.positions.map((p) => p.x)) - g.D / 2 - fs * 1.2;
            const yc = g.conduit ? g.conduit.y : g.positions.reduce((a, p) => a + p.y, 0) / g.positions.length;
            return (
              <>
                <line x1={gx} y1={0} x2={gx} y2={yc} stroke={pal.ink3} strokeWidth={sw * 0.9} markerStart={`url(#${id('arrow')})`} markerEnd={`url(#${id('arrow')})`} />
                <text x={gx - fs * 0.35} y={yc / 2} fontSize={fs * 0.75} textAnchor="end" fill={pal.ink} {...halo} dominantBaseline="middle">
                  {fmt(yc / 1000, 2)} m
                </text>
              </>
            );
          })()}
        </g>
      )}
      {/* layer boundaries and handles (editor only) */}
      {drag && (
        <g>
          {layers
            .filter((x) => !x.last)
            .map(({ l, bottom }) => (
              <line key={`lb${l.id}`} x1={R.x0} y1={bottom} x2={R.x1} y2={bottom} stroke="transparent" strokeWidth={sw * 10} className="drag" style={{ cursor: 'ns-resize' }} {...on('layer-bottom', l.id)} />
            ))}
          {handles}
        </g>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------

interface EditorProps {
  cable: CableSpec;
  inst: InstallationSpec;
  iec: RatingResult;
  num: NumericState;
  pal: Palette;
  onChange: (i: InstallationSpec) => void;
  undo?: () => void;
  redo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

interface DragState {
  kind: string;
  a?: string | number;
  b?: string | number;
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  moved: boolean;
  inst: InstallationSpec;
  view: View;
}

/** Drag-and-drop cross-section editor with an inspector and an object list. */
export function TrenchEditor({ cable, inst, iec, num, pal, onChange, undo, redo, canUndo, canRedo }: EditorProps) {
  const idPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [sel, setSel] = useState<Selection>(null);
  const [showHeat, setShowHeat] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [template, setTemplate] = useState(TRENCH_TEMPLATES[0].id);
  const [snap, setSnap] = useState('0.01');
  const [view, setView] = useState<View>({ zoom: 1, panX: 0, panY: 0 });
  const [dxf, setDxf] = useState<{ name: string; doc: DxfDoc } | null>(null);
  const [dxfMsg, setDxfMsg] = useState('');
  const [showDxf, setShowDxf] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const t = inst.trench;

  const scene = useMemo(() => trenchScene(cable, inst, iec, num, pal, view), [cable, inst, iec, num, pal, view]);
  const heat = useMemo(() => (scene && showHeat ? trenchHeat(scene, pal) : null), [scene, pal, showHeat]);

  if (!t) return null;
  const step = Number(snap);
  const sn = (v: number) => (step > 0 ? Math.round(v / step) * step : r3(v));

  // --- updates
  const setT = (patch: Partial<TrenchSpec>, base: InstallationSpec = inst) => onChange({ ...base, trench: { ...base.trench!, ...patch } });
  const setShape = (sid: string, patch: Partial<GroundShape>, base: InstallationSpec = inst) =>
    setT({ shapes: base.trench!.shapes.map((s) => (s.id === sid ? { ...s, ...patch } : s)) }, base);
  const setLayer = (lid: string, patch: Partial<SoilLayer>) => setT({ layers: t.layers.map((l) => (l.id === lid ? { ...l, ...patch } : l)) });
  const setSlab = (sid: string, patch: Partial<TrenchSlab>) => setT({ slabs: t.slabs.map((s) => (s.id === sid ? { ...s, ...patch } : s)) });
  const setSource = (hid: string, patch: Partial<HeatSource>, base: InstallationSpec = inst) =>
    onChange({ ...base, heatSources: (base.heatSources ?? []).map((h) => (h.id === hid ? { ...h, ...patch } : h)) });
  const setCircuit = (index: number, patch: Partial<CircuitSpec>, base: InstallationSpec = inst) => {
    if (index === 0) {
      const m: Partial<InstallationSpec> = {};
      if (patch.x_m !== undefined) m.mainX_m = patch.x_m;
      if (patch.depth_m !== undefined) m.depth_m = patch.depth_m;
      if (patch.formation) m.formation = patch.formation;
      if (patch.touching !== undefined) m.touching = patch.touching;
      if (patch.spacing_mm !== undefined) m.spacing_mm = patch.spacing_mm;
      if (patch.rotated !== undefined) m.rotated = patch.rotated;
      onChange({ ...base, ...m });
    } else onChange({ ...base, circuits: base.circuits.map((c, i) => (i === index - 1 ? { ...c, ...patch } : c)) });
  };
  const conduits = inst.conduits ?? [];
  const setConduit = (kid: string, patch: Partial<ConduitSpec>, base: InstallationSpec = inst) =>
    onChange(placeInConduits({ ...base, conduits: (base.conduits ?? []).map((k) => (k.id === kid ? { ...k, ...patch } : k)) }));
  /** The shared conduit holding circuit `index` (0 = main), if any */
  const conduitOfCircuit = (index: number, base: InstallationSpec = inst) => {
    const id = index === 0 ? base.mainConduit : base.circuits[index - 1]?.conduit;
    return id ? (base.conduits ?? []).find((k) => k.id === id) : undefined;
  };
  /** Puts circuit `index` in conduit `kid`, or takes it out (undefined) */
  const placeCircuit = (index: number, kid: string | undefined, extra: Partial<CircuitSpec> & { mainDucted?: boolean } = {}) => {
    // Taken out of a conduit: put the circuit just beside it, so it does not overlap
    const was = conduitOfCircuit(index);
    const beside = !kid && was ? { x_m: r3(was.x_m + was.outerD_mm / 2000 + 0.25), depth_m: was.depth_m } : {};
    const { mainDucted, ...rest } = extra;
    const next: InstallationSpec =
      index === 0
        ? {
            ...inst,
            mainConduit: kid,
            ...('x_m' in beside ? { mainX_m: beside.x_m, depth_m: beside.depth_m } : {}),
            ...(mainDucted !== undefined ? { trench: { ...t, ducted: mainDucted } } : {}),
          }
        : { ...inst, circuits: inst.circuits.map((c, i) => (i === index - 1 ? { ...c, ...rest, ...beside, conduit: kid } : c)) };
    onChange(placeInConduits(next));
  };

  // --- pointer handling
  const toMm = (e: { clientX: number; clientY: number }) => {
    const svg = wrap.current?.querySelector('svg');
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const start = (e: React.PointerEvent, kind: string, a?: string | number, b?: string | number) => {
    e.stopPropagation();
    e.preventDefault();
    wrap.current?.focus({ preventScroll: true });
    const p = toMm(e);
    let base = inst;
    // inserting a polygon corner at an edge midpoint, then dragging it
    if (kind === 'vertex-add') {
      const s = t.shapes.find((x) => x.id === a)!;
      const pts = [...(s.points ?? [])];
      const i = b as number;
      const nx = pts[(i + 1) % pts.length];
      pts.splice(i + 1, 0, [r3((pts[i][0] + nx[0]) / 2), r3((pts[i][1] + nx[1]) / 2)]);
      base = { ...inst, trench: { ...t, shapes: t.shapes.map((x) => (x.id === s.id ? { ...x, points: pts } : x)) } };
      onChange(base);
      kind = 'vertex';
      b = i + 1;
    }
    dragRef.current = { kind, a, b, x0: p.x, y0: p.y, cx: e.clientX, cy: e.clientY, moved: false, inst: base, view };
    wrap.current?.setPointerCapture?.(e.pointerId);
    if (kind === 'circuit') setSel({ kind: 'circuit', index: a as number });
    else if (kind === 'slab') setSel({ kind: 'slab', id: a as string });
    else if (kind === 'source') setSel({ kind: 'source', id: a as string });
    else if (kind === 'conduit') setSel({ kind: 'conduit', id: a as string });
    else if (kind === 'shape') setSel({ kind: 'shape', id: a as string, band: b as string | undefined });
    else if (kind.startsWith('band-')) setSel({ kind: 'shape', id: a as string, band: b as string });
    else if (kind === 'vertex') setSel({ kind: 'shape', id: a as string, vertex: b as number });
    else if (kind === 'layer-bottom') setSel({ kind: 'layer', id: a as string });
    else if (['rect-corner', 'trench-top', 'trench-corner', 'circle-r'].includes(kind)) setSel({ kind: 'shape', id: a as string });
  };

  const move = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < 3) return;
    d.moved = true;
    if (d.kind === 'pan') {
      // move the view, in screen terms
      const svg = wrap.current?.querySelector('svg');
      const m = svg?.getScreenCTM();
      if (!m) return;
      const dx = (e.clientX - d.cx) / m.a;
      const dy = (e.clientY - d.cy) / m.d;
      setView({ ...d.view, panX: d.view.panX - dx, panY: d.view.panY - dy });
      return;
    }
    const p = toMm(e);
    const dx = (p.x - d.x0) / 1000;
    const dy = (p.y - d.y0) / 1000;
    const b = d.inst;
    const bt = b.trench!;
    switch (d.kind) {
      case 'conduit': {
        const k = (b.conduits ?? []).find((x) => x.id === d.a)!;
        setConduit(k.id, { x_m: sn(k.x_m + dx), depth_m: Math.max(0.05, sn(k.depth_m + dy)) }, b);
        break;
      }
      case 'circuit': {
        const i = d.a as number;
        const kc = conduitOfCircuit(i, b);
        if (kc) {
          setConduit(kc.id, { x_m: sn(kc.x_m + dx), depth_m: Math.max(0.05, sn(kc.depth_m + dy)) }, b);
          break;
        }
        const x0 = i === 0 ? (b.mainX_m ?? 0) : b.circuits[i - 1].x_m;
        const y0 = i === 0 ? b.depth_m : b.circuits[i - 1].depth_m;
        setCircuit(i, { x_m: sn(x0 + dx), depth_m: Math.max(0.1, sn(y0 + dy)) }, b);
        break;
      }
      case 'source': {
        const h = (b.heatSources ?? []).find((x) => x.id === d.a)!;
        setSource(h.id, { x_m: sn(h.x_m + dx), depth_m: Math.max(0.05, sn(h.depth_m + dy)) }, b);
        break;
      }
      case 'slab': {
        const s = bt.slabs.find((x) => x.id === d.a)!;
        setT({ slabs: bt.slabs.map((x) => (x.id === s.id ? { ...x, x_m: sn(s.x_m + dx), depth_m: Math.max(0, sn(s.depth_m + dy)) } : x)) }, b);
        break;
      }
      case 'shape': {
        const s = bt.shapes.find((x) => x.id === d.a)!;
        const ddx = sn(dx);
        const ddy = s.kind === 'trench' && s.y_m === 0 ? 0 : sn(dy);
        if (s.kind === 'polygon') setShape(s.id, { points: (s.points ?? []).map(([x, y]) => [r3(x + ddx), r3(y + ddy)]) }, b);
        else
          setShape(
            s.id,
            {
              x_m: r3(s.x_m + ddx),
              y_m: r3(Math.max(s.kind === 'circle' ? s.width_m / 2 : 0, s.y_m + ddy)),
              bands: s.bands?.map((bd) => ({ ...bd, top_m: r3(bd.top_m + ddy), bottom_m: r3(bd.bottom_m + ddy) })),
            },
            b,
          );
        break;
      }
      case 'rect-corner': {
        const s = bt.shapes.find((x) => x.id === d.a)!;
        const c = d.b as number;
        let l = s.x_m - s.width_m / 2;
        let r = s.x_m + s.width_m / 2;
        let tp = s.y_m;
        let bo = s.y_m + s.height_m;
        if (c === 0 || c === 3) l = sn(l + dx);
        else r = sn(r + dx);
        if (c === 0 || c === 1) tp = Math.max(0, sn(tp + dy));
        else bo = sn(bo + dy);
        if (r - l < 0.02 || bo - tp < 0.02) return;
        setShape(s.id, { x_m: r3((l + r) / 2), width_m: r3(r - l), y_m: r3(tp), height_m: r3(bo - tp) }, b);
        break;
      }
      case 'trench-top': {
        const s = bt.shapes.find((x) => x.id === d.a)!;
        setShape(s.id, { topWidth_m: Math.max(0.1, sn((s.topWidth_m ?? s.width_m) + 2 * dx)) }, b);
        break;
      }
      case 'trench-corner': {
        const s = bt.shapes.find((x) => x.id === d.a)!;
        const height = Math.max(0.2, sn(s.height_m + dy));
        const bottom = s.y_m + height;
        setShape(
          s.id,
          {
            width_m: Math.max(0.1, sn(s.width_m + 2 * dx)),
            height_m: height,
            bands: s.bands?.map((bd) => ({
              ...bd,
              bottom_m: Math.abs(bd.bottom_m - (s.y_m + s.height_m)) < 1e-6 ? bottom : Math.min(bd.bottom_m, bottom),
              top_m: Math.min(bd.top_m, bottom - 0.02),
            })),
          },
          b,
        );
        break;
      }
      case 'circle-r': {
        const s = bt.shapes.find((x) => x.id === d.a)!;
        setShape(s.id, { width_m: Math.max(0.05, sn(s.width_m + 2 * dx)), height_m: Math.max(0.05, sn(s.width_m + 2 * dx)) }, b);
        break;
      }
      case 'vertex': {
        const s = bt.shapes.find((x) => x.id === d.a)!;
        const i = d.b as number;
        const pts = (s.points ?? []).map((q, k) => (k === i ? ([sn(q[0] + dx), Math.max(0, sn(q[1] + dy))] as [number, number]) : q));
        setShape(s.id, { points: pts }, b);
        break;
      }
      case 'band-top':
      case 'band-bottom': {
        const s = bt.shapes.find((x) => x.id === d.a)!;
        setShape(
          s.id,
          {
            bands: s.bands?.map((bd) => {
              if (bd.id !== d.b) return bd;
              if (d.kind === 'band-top') return { ...bd, top_m: Math.min(bd.bottom_m - 0.02, Math.max(s.y_m, sn(bd.top_m + dy))) };
              return { ...bd, bottom_m: Math.max(bd.top_m + 0.02, Math.min(s.y_m + s.height_m, sn(bd.bottom_m + dy))) };
            }),
          },
          b,
        );
        break;
      }
      case 'layer-bottom': {
        const l = bt.layers.find((x) => x.id === d.a)!;
        setT({ layers: bt.layers.map((x) => (x.id === l.id ? { ...x, thickness_m: Math.max(0.05, sn(l.thickness_m + dy)) } : x)) }, b);
        break;
      }
    }
  };

  const end = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && d.kind === 'pan' && !d.moved) setSel(typeof d.a === 'string' ? { kind: 'layer', id: d.a } : null);
  };

  // --- add, duplicate, delete
  const native = t.layers[Math.min(1, t.layers.length - 1)];
  const contentRight = () => {
    let x = (inst.mainX_m ?? 0) + 0.3;
    inst.circuits.forEach((c) => (x = Math.max(x, c.x_m + 0.3)));
    t.shapes.forEach((s) => (x = Math.max(x, shapeBounds(s).x1)));
    (inst.heatSources ?? []).forEach((h) => (x = Math.max(x, h.x_m + h.diameter_mm / 2000)));
    return x;
  };
  const mx = inst.mainX_m ?? 0;
  const md = inst.depth_m;
  const addShape = (s: GroundShape) => {
    setT({ shapes: [...t.shapes, s] });
    setSel({ kind: 'shape', id: s.id });
  };
  const addCircuit = () => {
    const D = (t.ducted ? inst.duct.outerD_mm : deriveGeometry(cable).geometry.De || 50) / 1000;
    const s = inst.touching ? D : inst.spacing_mm / 1000;
    const width = (inst.formation === 'flat' ? 2 * s : s) + D;
    const c: CircuitSpec = {
      id: uid(),
      name: `C${inst.circuits.length + 2}`,
      cable: null,
      x_m: r3(contentRight() + width / 2 + 0.2),
      depth_m: md,
      formation: inst.formation,
      touching: inst.touching,
      spacing_mm: inst.spacing_mm,
      transposed: inst.transposed,
      bonding: inst.bonding,
      crossBondLambda1: null,
      load: 'rated',
      current_A: 300,
    };
    onChange({ ...inst, circuits: [...inst.circuits, c] });
    setSel({ kind: 'circuit', index: inst.circuits.length + 1 });
  };
  const addSource = () => {
    const h: HeatSource = { id: uid(), name: 'Heat source', x_m: r3(contentRight() + 0.4), depth_m: md, diameter_mm: 200, W: 30 };
    onChange({ ...inst, heatSources: [...(inst.heatSources ?? []), h] });
    setSel({ kind: 'source', id: h.id });
  };
  const addConduit = () => {
    const k: ConduitSpec = {
      id: uid(),
      name: `DN160${conduits.length ? ` (${conduits.length + 1})` : ''}`,
      x_m: r3(contentRight() + 0.4),
      depth_m: md,
      material: 'PE',
      innerD_mm: 141,
      outerD_mm: 160,
    };
    onChange({ ...inst, conduits: [...conduits, k] });
    setSel({ kind: 'conduit', id: k.id });
  };
  const addSlab = (kind: 'tile' | 'tape') => {
    const s: TrenchSlab = {
      id: uid(),
      kind,
      x_m: mx,
      depth_m: kind === 'tile' ? r3(Math.max(0.2, md - 0.25)) : r3(Math.max(0.2, md - 0.55)),
      width_m: 0.5,
      thickness_m: kind === 'tile' ? 0.03 : 0.005,
      rho: kind === 'tile' ? GROUND.polymer.rho : 1,
    };
    setT({ slabs: [...t.slabs, s] });
    setSel({ kind: 'slab', id: s.id });
  };
  const addLayer = () => {
    const l: SoilLayer = { id: uid(), name: 'Clay', material: 'clay', thickness_m: 0.5, rho: GROUND.clay.rho };
    const layers = [...t.layers];
    layers.splice(Math.max(0, layers.length - 1), 0, l);
    setT({ layers });
    setSel({ kind: 'layer', id: l.id });
  };

  const duplicate = () => {
    if (!sel) return;
    if (sel.kind === 'shape') {
      const s = t.shapes.find((x) => x.id === sel.id);
      if (!s) return;
      const c: GroundShape = { ...clone(s), id: uid(), name: `${s.name} copy`, bands: s.bands?.map((b) => ({ ...b, id: uid() })) };
      const off = Math.max(0.3, shapeBounds(s).x1 - shapeBounds(s).x0 + 0.2);
      if (c.kind === 'polygon') c.points = c.points?.map(([x, y]) => [r3(x + off), y]);
      else c.x_m = r3(c.x_m + off);
      addShape(c);
    } else if (sel.kind === 'slab') {
      const s = t.slabs.find((x) => x.id === sel.id);
      if (!s) return;
      const c = { ...s, id: uid(), depth_m: r3(s.depth_m + 0.1) };
      setT({ slabs: [...t.slabs, c] });
      setSel({ kind: 'slab', id: c.id });
    } else if (sel.kind === 'source') {
      const h = (inst.heatSources ?? []).find((x) => x.id === sel.id);
      if (!h) return;
      const c = { ...h, id: uid(), name: `${h.name} copy`, x_m: r3(h.x_m + h.diameter_mm / 1000 + 0.15) };
      onChange({ ...inst, heatSources: [...(inst.heatSources ?? []), c] });
      setSel({ kind: 'source', id: c.id });
    } else if (sel.kind === 'conduit') {
      const k = conduits.find((x) => x.id === sel.id);
      if (!k) return;
      const c = { ...k, id: uid(), name: `${k.name} copy`, x_m: r3(k.x_m + k.outerD_mm / 1000 + 0.15) };
      onChange({ ...inst, conduits: [...conduits, c] });
      setSel({ kind: 'conduit', id: c.id });
    } else if (sel.kind === 'circuit') {
      const src: CircuitSpec =
        sel.index === 0
          ? {
              id: uid(),
              name: '',
              cable: null,
              x_m: mx,
              depth_m: md,
              formation: inst.formation,
              touching: inst.touching,
              spacing_mm: inst.spacing_mm,
              transposed: inst.transposed,
              bonding: inst.bonding,
              crossBondLambda1: inst.crossBondLambda1,
              load: 'rated',
              current_A: 300,
              rotated: inst.rotated,
              ducted: t.ducted,
            }
          : inst.circuits[sel.index - 1];
      const c = { ...clone(src), id: uid(), name: `C${inst.circuits.length + 2}`, x_m: r3(contentRight() + 0.35), conduit: undefined };
      onChange({ ...inst, circuits: [...inst.circuits, c] });
      setSel({ kind: 'circuit', index: inst.circuits.length + 1 });
    }
  };

  const remove = () => {
    if (!sel) return;
    if (sel.kind === 'shape') {
      const s = t.shapes.find((x) => x.id === sel.id);
      if (s && sel.vertex !== undefined && s.kind === 'polygon' && (s.points?.length ?? 0) > 3) {
        setShape(s.id, { points: s.points!.filter((_, i) => i !== sel.vertex) });
        setSel({ kind: 'shape', id: s.id });
        return;
      }
      if (s && sel.band) {
        setShape(s.id, { bands: s.bands?.filter((b) => b.id !== sel.band) });
        setSel({ kind: 'shape', id: s.id });
        return;
      }
      setT({ shapes: t.shapes.filter((x) => x.id !== sel.id) });
    } else if (sel.kind === 'slab') setT({ slabs: t.slabs.filter((x) => x.id !== sel.id) });
    else if (sel.kind === 'source') onChange({ ...inst, heatSources: (inst.heatSources ?? []).filter((x) => x.id !== sel.id) });
    else if (sel.kind === 'conduit') {
      // The circuits stay where the conduit was, without it
      const placed = placeInConduits(inst);
      onChange({
        ...placed,
        conduits: conduits.filter((x) => x.id !== sel.id),
        mainConduit: placed.mainConduit === sel.id ? undefined : placed.mainConduit,
        circuits: placed.circuits.map((c) => (c.conduit === sel.id ? { ...c, conduit: undefined } : c)),
      });
    } else if (sel.kind === 'circuit' && sel.index > 0) onChange({ ...inst, circuits: inst.circuits.filter((_, i) => i !== sel.index - 1) });
    else if (sel.kind === 'layer' && t.layers.length > 1) setT({ layers: t.layers.filter((x) => x.id !== sel.id) });
    else return;
    setSel(null);
  };

  const reorder = (sid: string, d: number) => {
    const i = t.shapes.findIndex((s) => s.id === sid);
    const j = i + d;
    if (i < 0 || j < 0 || j >= t.shapes.length) return;
    const shapes = [...t.shapes];
    [shapes[i], shapes[j]] = [shapes[j], shapes[i]];
    setT({ shapes });
  };

  const onKey = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo?.();
      else undo?.();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo?.();
      return;
    }
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicate();
      return;
    }
    if (!sel) return;
    const st = e.shiftKey ? 0.1 : step > 0 ? step : 0.01;
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] };
    if (dirs[e.key]) {
      const [dx, dy] = dirs[e.key];
      e.preventDefault();
      const kc = sel.kind === 'conduit' ? conduits.find((x) => x.id === sel.id) : sel.kind === 'circuit' ? conduitOfCircuit(sel.index) : undefined;
      if (kc) {
        setConduit(kc.id, { x_m: r3(kc.x_m + dx), depth_m: Math.max(0.05, r3(kc.depth_m + dy)) });
      } else if (sel.kind === 'circuit') {
        const x0 = sel.index === 0 ? mx : inst.circuits[sel.index - 1].x_m;
        const y0 = sel.index === 0 ? md : inst.circuits[sel.index - 1].depth_m;
        setCircuit(sel.index, { x_m: r3(x0 + dx), depth_m: Math.max(0.1, r3(y0 + dy)) });
      } else if (sel.kind === 'slab') {
        const s = t.slabs.find((x) => x.id === sel.id);
        if (s) setSlab(s.id, { x_m: r3(s.x_m + dx), depth_m: Math.max(0, r3(s.depth_m + dy)) });
      } else if (sel.kind === 'source') {
        const h = (inst.heatSources ?? []).find((x) => x.id === sel.id);
        if (h) setSource(h.id, { x_m: r3(h.x_m + dx), depth_m: Math.max(0.05, r3(h.depth_m + dy)) });
      } else if (sel.kind === 'shape') {
        const s = t.shapes.find((x) => x.id === sel.id);
        if (!s) return;
        const ddy = s.kind === 'trench' && s.y_m === 0 ? 0 : dy;
        if (s.kind === 'polygon') setShape(s.id, { points: (s.points ?? []).map(([x, y]) => [r3(x + dx), r3(y + ddy)]) });
        else setShape(s.id, { x_m: r3(s.x_m + dx), y_m: r3(s.y_m + ddy), bands: s.bands?.map((b) => ({ ...b, top_m: r3(b.top_m + ddy), bottom_m: r3(b.bottom_m + ddy) })) });
      }
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove();
    }
  };

  // --- zoom around a point: the selected item, else the main circuit
  const focus = (): { x: number; y: number; size: number } | null => {
    if (!scene) return null;
    const groupFocus = (gi: number) => {
      const g = scene.groups[gi];
      if (!g) return null;
      if (g.conduit) return { x: g.conduit.x, y: g.conduit.y, size: g.conduit.Do };
      const xs = g.positions.map((p) => p.x);
      const ys = g.positions.map((p) => p.y);
      return {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
        size: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + g.D,
      };
    };
    if (sel?.kind === 'conduit') {
      const k = conduits.find((x) => x.id === sel.id);
      if (k) return { x: k.x_m * 1000, y: k.depth_m * 1000, size: k.outerD_mm };
    }
    if (sel?.kind === 'circuit') return groupFocus(sel.index);
    if (sel?.kind === 'source') {
      const h = (inst.heatSources ?? []).find((x) => x.id === sel.id);
      if (h) return { x: h.x_m * 1000, y: h.depth_m * 1000, size: h.diameter_mm };
    }
    if (sel?.kind === 'shape') {
      const sh = t.shapes.find((x) => x.id === sel.id);
      if (sh) {
        const bb = shapeBounds(sh);
        return { x: ((bb.x0 + bb.x1) / 2) * 1000, y: ((bb.y0 + bb.y1) / 2) * 1000, size: Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) * 1000 };
      }
    }
    return groupFocus(0);
  };
  const zoomAt = (factor: number | 'fit-focus', at?: { x: number; y: number }) =>
    setView((v) => {
      const f = at ? { ...at, size: 0 } : focus();
      const reg = scene?.region;
      if (!reg || !f) return { ...v, zoom: Math.min(40, Math.max(0.25, v.zoom * (factor === 'fit-focus' ? 1 : factor))) };
      const w = reg.x1 - reg.x0;
      const z2 =
        factor === 'fit-focus'
          ? Math.min(40, Math.max(0.25, (w * v.zoom) / Math.max(f.size * 5, 350)))
          : Math.min(40, Math.max(0.25, v.zoom * factor));
      const c = { x: (reg.x0 + reg.x1) / 2, y: (reg.y0 + reg.y1) / 2 };
      const c0 = { x: c.x - v.panX, y: c.y - v.panY };
      const k = factor === 'fit-focus' ? 0 : v.zoom / z2;
      const cn = { x: f.x + (c.x - f.x) * k, y: f.y + (c.y - f.y) * k };
      return { zoom: z2, panX: cn.x - c0.x, panY: cn.y - c0.y };
    });

  // --- DXF import
  const openDxf = (name: string, text: string) => {
    try {
      const doc = parseDxf(text);
      setDxf({ name, doc });
      setDxfMsg('');
    } catch (err) {
      setDxf(null);
      setDxfMsg(err instanceof Error ? err.message : 'The DXF could not be read.');
    }
  };
  const onDxfFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/\.dxf$/i.test(f.name)) {
      setDxfMsg('Choose a .dxf file. DWG drawings need to be saved as DXF first.');
      return;
    }
    openDxf(f.name, await f.text());
  };

  // --- inspector
  const n0 = (v: number | null) => (v === null ? 0 : v);
  let title = 'Nothing selected';
  let inspector: React.ReactNode = (
    <>
      <p className="empty-note">
        Select an item here or in the drawing. Drag items to move them, drag the square handles to resize, and drag
        empty ground to pan. Arrow keys move the selected item; Ctrl+Z undoes, Ctrl+D duplicates, Delete removes.
      </p>
      <div className="dxf-side">
        {t.underlay ? (
          <>
            <p className="field-hint">
              Drawing from <strong>{t.underlay.name}</strong> shown underneath ({(t.underlay.lines.length / 4).toLocaleString('en-GB')} lines).
            </p>
            <button type="button" className="btn btn-quiet" onClick={() => setT({ underlay: undefined })}>
              Remove the drawing
            </button>
          </>
        ) : (
          <>
            <p className="field-hint">
              Have a trench section in CAD? <strong>Import DXF…</strong> reads its regions, cables and conduits.
            </p>
            <button type="button" className="btn btn-quiet" onClick={() => openDxf('pv-dc-trench.dxf (sample)', sampleDxf)}>
              Try the sample drawing
            </button>
          </>
        )}
      </div>
    </>
  );
  if (sel?.kind === 'layer') {
    const l = t.layers.find((x) => x.id === sel.id);
    const idx = t.layers.findIndex((x) => x.id === sel.id);
    if (l) {
      title = 'Ground layer';
      inspector = (
        <div className="field-grid">
          <TextField id="ly-name" label="Name" value={l.name} onChange={(name) => setLayer(l.id, { name })} />
          <SelectField id="ly-mat" label="Material" value={l.material} options={materialOptions} onChange={(material) => setLayer(l.id, { material, rho: GROUND[material].rho })} />
          <NumField id="ly-rho" label="Thermal resistivity" unit="K·m/W" value={l.rho} onChange={(v) => setLayer(l.id, { rho: n0(v) })} hint="Use measured site values where you have them." />
          {idx < t.layers.length - 1 ? (
            <NumField id="ly-t" label="Thickness" unit="m" value={l.thickness_m} onChange={(v) => setLayer(l.id, { thickness_m: n0(v) })} />
          ) : (
            <p className="field-hint field-wide">The bottom layer continues downwards.</p>
          )}
        </div>
      );
    }
  } else if (sel?.kind === 'shape') {
    const s = t.shapes.find((x) => x.id === sel.id);
    if (s) {
      title = { trench: 'Trench', rect: 'Rectangle', circle: 'Circle', polygon: 'Polygon' }[s.kind];
      const idx = t.shapes.findIndex((x) => x.id === s.id);
      inspector = (
        <div className="field-grid">
          <TextField id="sh-name" label="Name" value={s.name} onChange={(name) => setShape(s.id, { name })} />
          <SelectField id="sh-mat" label={s.kind === 'trench' ? 'Fill material' : 'Material'} value={s.material} options={materialOptions} onChange={(material) => setShape(s.id, { material, rho: GROUND[material].rho })} />
          <NumField id="sh-rho" label="Thermal resistivity" unit="K·m/W" value={s.rho} onChange={(v) => setShape(s.id, { rho: n0(v) })} />
          {s.kind !== 'polygon' && <NumField id="sh-x" label="Centre position" unit="m" value={s.x_m} onChange={(v) => setShape(s.id, { x_m: n0(v) })} />}
          {(s.kind === 'rect' || s.kind === 'trench') && <NumField id="sh-y" label="Top depth" unit="m" value={s.y_m} onChange={(v) => setShape(s.id, { y_m: n0(v) })} />}
          {s.kind === 'circle' && <NumField id="sh-y" label="Centre depth" unit="m" value={s.y_m} onChange={(v) => setShape(s.id, { y_m: n0(v) })} />}
          {s.kind === 'rect' && (
            <>
              <NumField id="sh-w" label="Width" unit="m" value={s.width_m} onChange={(v) => setShape(s.id, { width_m: n0(v) })} />
              <NumField id="sh-h" label="Height" unit="m" value={s.height_m} onChange={(v) => setShape(s.id, { height_m: n0(v) })} />
            </>
          )}
          {s.kind === 'circle' && <NumField id="sh-d" label="Diameter" unit="m" value={s.width_m} onChange={(v) => setShape(s.id, { width_m: n0(v), height_m: n0(v) })} />}
          {s.kind === 'trench' && (
            <>
              <NumField id="sh-h" label="Depth" unit="m" value={s.height_m} onChange={(v) => setShape(s.id, { height_m: n0(v) })} />
              <NumField id="sh-tw" label="Width at top" unit="m" value={s.topWidth_m ?? s.width_m} onChange={(v) => setShape(s.id, { topWidth_m: n0(v) })} />
              <NumField id="sh-w" label="Width at bottom" unit="m" value={s.width_m} onChange={(v) => setShape(s.id, { width_m: n0(v) })} />
              <div className="field-wide sub-list">
                <span className="field-label">Fill bands</span>
                {(s.bands ?? []).map((b) => (
                  <div key={b.id} className={`sub-item${sel.band === b.id ? ' is-on' : ''}`}>
                    <div className="field-grid">
                      <TextField id={`bd-${b.id}-n`} label="Name" value={b.name} onChange={(name) => setShape(s.id, { bands: s.bands!.map((x) => (x.id === b.id ? { ...x, name } : x)) })} />
                      <SelectField
                        id={`bd-${b.id}-m`}
                        label="Material"
                        value={b.material}
                        options={materialOptions}
                        onChange={(material) => setShape(s.id, { bands: s.bands!.map((x) => (x.id === b.id ? { ...x, material, rho: GROUND[material].rho } : x)) })}
                      />
                      <NumField id={`bd-${b.id}-r`} label="ρ" unit="K·m/W" value={b.rho} onChange={(v) => setShape(s.id, { bands: s.bands!.map((x) => (x.id === b.id ? { ...x, rho: n0(v) } : x)) })} />
                      <NumField id={`bd-${b.id}-t`} label="Top" unit="m" value={b.top_m} onChange={(v) => setShape(s.id, { bands: s.bands!.map((x) => (x.id === b.id ? { ...x, top_m: n0(v) } : x)) })} />
                      <NumField id={`bd-${b.id}-b`} label="Bottom" unit="m" value={b.bottom_m} onChange={(v) => setShape(s.id, { bands: s.bands!.map((x) => (x.id === b.id ? { ...x, bottom_m: n0(v) } : x)) })} />
                      <button type="button" className="btn btn-quiet btn-danger" onClick={() => setShape(s.id, { bands: s.bands!.filter((x) => x.id !== b.id) })}>
                        Remove band
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const bottom = Math.min(...(s.bands ?? []).map((b) => b.top_m), s.y_m + s.height_m);
                    const b = makeBand('Sand', 'sand', r3(Math.max(s.y_m, bottom - 0.3)), r3(bottom));
                    if (b.bottom_m - b.top_m >= 0.02) setShape(s.id, { bands: [...(s.bands ?? []), b] });
                  }}
                >
                  Add fill band
                </button>
              </div>
            </>
          )}
          {s.kind === 'polygon' && (
            <div className="field-wide sub-list">
              <span className="field-label">Corner points (x, depth in m)</span>
              {(s.points ?? []).map(([x, y], i) => (
                <div key={i} className={`point-row${sel.vertex === i ? ' is-on' : ''}`}>
                  <span className="point-n">{i + 1}</span>
                  <NumField id={`pt-${i}-x`} label="x" unit="m" value={x} onChange={(v) => setShape(s.id, { points: s.points!.map((q, k) => (k === i ? [n0(v), q[1]] : q)) })} />
                  <NumField id={`pt-${i}-y`} label="Depth" unit="m" value={y} onChange={(v) => setShape(s.id, { points: s.points!.map((q, k) => (k === i ? [q[0], n0(v)] : q)) })} />
                  <button
                    type="button"
                    className="btn btn-quiet btn-danger"
                    disabled={(s.points?.length ?? 0) <= 3}
                    onClick={() => setShape(s.id, { points: s.points!.filter((_, k) => k !== i) })}
                    aria-label={`Remove point ${i + 1}`}
                  >
                    ×
                  </button>
                </div>
              ))}
              <p className="field-hint">Drag the small round handles on the edges to add points.</p>
            </div>
          )}
          <div className="btn-row field-wide">
            <button type="button" className="btn btn-quiet" onClick={() => reorder(s.id, 1)} disabled={idx === t.shapes.length - 1}>
              Bring forward
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => reorder(s.id, -1)} disabled={idx === 0}>
              Send backward
            </button>
          </div>
        </div>
      );
    }
  } else if (sel?.kind === 'slab') {
    const s = t.slabs.find((x) => x.id === sel.id);
    if (s) {
      title = s.kind === 'tile' ? 'Cover tiles' : 'Warning tape';
      inspector = (
        <div className="field-grid">
          <Segmented id="sl-kind" label="Type" value={s.kind} options={[{ value: 'tile', label: 'Cover tiles' }, { value: 'tape', label: 'Warning tape' }]} onChange={(kind) => setSlab(s.id, { kind })} />
          <NumField id="sl-x" label="Centre position" unit="m" value={s.x_m} onChange={(v) => setSlab(s.id, { x_m: n0(v) })} />
          <NumField id="sl-d" label="Depth of top" unit="m" value={s.depth_m} onChange={(v) => setSlab(s.id, { depth_m: n0(v) })} />
          <NumField id="sl-w" label="Width" unit="m" value={s.width_m} onChange={(v) => setSlab(s.id, { width_m: n0(v) })} />
          {s.kind === 'tile' && (
            <>
              <NumField id="sl-t" label="Thickness" unit="m" value={s.thickness_m} onChange={(v) => setSlab(s.id, { thickness_m: n0(v) })} />
              <SelectField
                id="sl-mat"
                label="Tile material"
                value={s.rho >= 2 ? 'polymer' : 'concrete'}
                options={[
                  { value: 'polymer', label: 'Polymer (ρ 3.5)' },
                  { value: 'concrete', label: 'Concrete (ρ 1.0)' },
                ]}
                onChange={(m) => setSlab(s.id, { rho: GROUND[m as GroundMaterial].rho })}
              />
            </>
          )}
          {s.kind === 'tape' && <p className="field-hint field-wide">Warning tape is drawn but has no thermal effect.</p>}
        </div>
      );
    }
  } else if (sel?.kind === 'source') {
    const h = (inst.heatSources ?? []).find((x) => x.id === sel.id);
    if (h) {
      title = 'Heat source';
      inspector = (
        <div className="field-grid">
          <TextField id="hs-name" label="Name" value={h.name} onChange={(name) => setSource(h.id, { name })} />
          <NumField id="hs-w" label="Heat given off" unit="W/m" value={h.W} onChange={(v) => setSource(h.id, { W: n0(v) })} hint="For a pipe: heat loss per metre at its operating temperature." />
          <NumField id="hs-d" label="Outer diameter" unit="mm" value={h.diameter_mm} onChange={(v) => setSource(h.id, { diameter_mm: n0(v) })} />
          <NumField id="hs-x" label="Horizontal position" unit="m" value={h.x_m} onChange={(v) => setSource(h.id, { x_m: n0(v) })} />
          <NumField id="hs-y" label="Depth to centre" unit="m" value={h.depth_m} onChange={(v) => setSource(h.id, { depth_m: n0(v) })} />
        </div>
      );
    }
  } else if (sel?.kind === 'conduit') {
    const k = conduits.find((x) => x.id === sel.id);
    if (k) {
      title = 'Conduit';
      const all = [{ i: 0, name: 'C1 (main circuit)' }, ...inst.circuits.map((c, n) => ({ i: n + 1, name: c.name || `C${n + 2}` }))];
      const count = all.filter(({ i }) => conduitOfCircuit(i)?.id === k.id).length;
      inspector = (
        <div className="field-grid">
          <TextField id="cd-name" label="Name" value={k.name} onChange={(name) => setConduit(k.id, { name })} />
          <SelectField
            id="cd-mat"
            label="Material"
            value={k.material as 'PE' | 'PVC' | 'earthenware'}
            options={[...ductOptions]}
            onChange={(material) => setConduit(k.id, { material })}
          />
          <NumField id="cd-do" label="Outer diameter" unit="mm" value={k.outerD_mm} onChange={(v) => setConduit(k.id, { outerD_mm: n0(v) })} />
          <NumField id="cd-di" label="Inner diameter" unit="mm" value={k.innerD_mm} onChange={(v) => setConduit(k.id, { innerD_mm: n0(v) })} />
          <NumField id="cd-x" label="Horizontal position" unit="m" value={k.x_m} onChange={(v) => setConduit(k.id, { x_m: n0(v) })} />
          <NumField id="cd-y" label="Depth to centre" unit="m" value={k.depth_m} onChange={(v) => setConduit(k.id, { depth_m: n0(v) })} />
          <fieldset className="field field-wide member-list">
            <legend className="field-label">Circuits in this conduit</legend>
            {all.map(({ i, name }) => (
              <Toggle
                key={i}
                id={`cd-m${i}`}
                label={name}
                checked={conduitOfCircuit(i)?.id === k.id}
                onChange={(v) => placeCircuit(i, v ? k.id : undefined)}
              />
            ))}
          </fieldset>
          <p className="field-hint field-wide">
            {count > 1
              ? `IEC 60287-2-1: the ${count} circuits are rated together. The air in the conduit uses the equivalent diameter of the group of cables (2 cables 1.65·De, 3 cables 2.15·De, 4 cables 2.5·De); the conduit wall and the ground carry the heat of all of them.`
              : 'Switch on the circuits that lie in this conduit. A single-core circuit counts as three cables, a three-core cable as one.'}
          </p>
        </div>
      );
    }
  } else if (sel?.kind === 'circuit') {
    const i = sel.index;
    const c = i === 0 ? null : inst.circuits[i - 1];
    if (i === 0 || c) {
      title = `Circuit C${i + 1}`;
      const ducted = i === 0 ? t.ducted : (c!.ducted ?? t.ducted);
      const duct = i === 0 ? inst.duct : { ...inst.duct, ...(c!.duct ?? {}) };
      const setDuct = (patch: Partial<typeof duct>) =>
        i === 0 ? onChange({ ...inst, duct: { ...inst.duct, ...patch } }) : setCircuit(i, { duct: { material: duct.material, innerD_mm: duct.innerD_mm, outerD_mm: duct.outerD_mm, ...patch } });
      const kc = conduitOfCircuit(i);
      const cab = i === 0 ? cable : (c!.cable ?? cable);
      const threeCore = cab.cores === 3;
      const dcCirc = cab.system === 'dc' && !threeCore;
      const placement = kc ? `k:${kc.id}` : ducted ? 'ducts' : 'direct';
      const setPlacement = (v: string) => {
        if (v.startsWith('k:')) return placeCircuit(i, v.slice(2));
        const d = v === 'ducts';
        if (i === 0) placeCircuit(0, undefined, { mainDucted: d });
        else placeCircuit(i, undefined, { ducted: d });
      };
      inspector = (
        <div className="field-grid">
          <p className="field-hint field-wide">
            {i === 0 ? 'Main circuit. Cable and bonding are set in the Cable and Installation tabs.' : 'Cable, bonding and load are set in the Circuits tab.'}
            {threeCore ? ' Three-core cable: one cable carries the circuit.' : dcCirc ? ' DC circuit: two cables, + and −.' : ''}
          </p>
          <SelectField
            id="ci-place"
            label="Placement"
            value={placement}
            options={[
              { value: 'direct', label: 'Direct in the ground' },
              { value: 'ducts', label: threeCore ? 'In its own duct' : 'In its own ducts (one per cable)' },
              ...conduits.map((k) => ({ value: `k:${k.id}`, label: `In ${k.name} (shared conduit)` })),
            ]}
            onChange={setPlacement}
          />
          {kc ? (
            <p className="field-hint field-wide">
              Lies in {kc.name} at {fmt(kc.x_m, 2)} m, {fmt(kc.depth_m, 2)} m deep. Drag it or the conduit to move both.{' '}
              <button type="button" className="link-btn" onClick={() => setSel({ kind: 'conduit', id: kc.id })}>
                Edit the conduit
              </button>
            </p>
          ) : (
            <>
          <NumField id="ci-x" label="Horizontal position" unit="m" value={i === 0 ? mx : c!.x_m} onChange={(v) => setCircuit(i, { x_m: n0(v) })} />
          <NumField id="ci-d" label="Depth to centre" unit="m" value={i === 0 ? md : c!.depth_m} onChange={(v) => setCircuit(i, { depth_m: n0(v) })} />
          {!threeCore && (
            <>
          {dcCirc ? (
            <Segmented
              id="ci-form"
              label="DC cables + and −"
              value={(i === 0 ? inst.rotated : c!.rotated) ? 'stacked' : 'side'}
              options={[
                { value: 'side', label: 'Side by side' },
                { value: 'stacked', label: 'One above the other' },
              ]}
              onChange={(v) => setCircuit(i, { formation: 'flat', rotated: v === 'stacked' })}
            />
          ) : (
            <>
              <Segmented
                id="ci-form"
                label="Formation"
                value={i === 0 ? inst.formation : c!.formation}
                options={[
                  { value: 'trefoil', label: 'Trefoil' },
                  { value: 'flat', label: 'Flat' },
                ]}
                onChange={(formation) => setCircuit(i, { formation })}
              />
              <Toggle
                id="ci-rot"
                label={(i === 0 ? inst.formation : c!.formation) === 'flat' ? 'Vertical (stacked)' : 'Point down'}
                checked={!!(i === 0 ? inst.rotated : c!.rotated)}
                onChange={(rotated) => setCircuit(i, { rotated })}
              />
            </>
          )}
          <Toggle id="ci-touch" label={ducted ? 'Ducts touching' : 'Cables touching'} checked={i === 0 ? inst.touching : c!.touching} onChange={(touching) => setCircuit(i, { touching })} />
          {!(i === 0 ? inst.touching : c!.touching) && (
            <NumField id="ci-s" label="Axial spacing" unit="mm" value={i === 0 ? inst.spacing_mm : c!.spacing_mm} onChange={(v) => setCircuit(i, { spacing_mm: n0(v) })} />
          )}
            </>
          )}
          {ducted && (
            <>
              <SelectField id="ci-dm" label="Duct material" value={duct.material as 'PE' | 'PVC' | 'earthenware'} options={[...ductOptions]} onChange={(material) => setDuct({ material })} />
              <NumField id="ci-di" label="Duct inner diameter" unit="mm" value={duct.innerD_mm} onChange={(v) => setDuct({ innerD_mm: n0(v) })} />
              <NumField id="ci-do" label="Duct outer diameter" unit="mm" value={duct.outerD_mm} onChange={(v) => setDuct({ outerD_mm: n0(v) })} />
            </>
          )}
            </>
          )}
        </div>
      );
    }
  }

  const canDuplicate = !!sel && sel.kind !== 'layer';
  const canDelete = !!sel && !(sel.kind === 'circuit' && sel.index === 0) && !(sel.kind === 'layer' && t.layers.length <= 1);
  const isSel = (k: string, v: string | number) => !!sel && sel.kind === k && (('id' in sel && sel.id === v) || ('index' in sel && sel.index === v));

  const numText =
    num.status === 'error'
      ? 'Numerical model failed'
      : !iec.ok
        ? 'Numerical model waits for a valid layout'
        : num.fresh && num.data
          ? `Numerical model · ${(num.data.numeric.nx * num.data.numeric.ny).toLocaleString('en-GB')} cells · ${Math.round(num.data.numeric.ms)} ms`
          : 'Updating numerical model…';
  const numI = iec.ok && num.fresh && num.data?.result.ok ? num.data.result.I : null;

  return (
    <section className="card trench-card" id="cross-section" aria-labelledby="trench-title">
      <header className="trench-head">
        <h2 id="trench-title">Cross-section</h2>
        <div className="trench-rating" aria-live="polite">
          {iec.ok ? (
            <>
              <span className="tr-fig">
                <span className="tr-k">IEC 60287</span>
                <span className="tr-v">{amps(iec.I)} A</span>
              </span>
              <span className="tr-fig">
                <span className="tr-k">Numerical</span>
                <span className="tr-v">{numI !== null ? `${amps(numI)} A` : num.status === 'error' ? 'failed' : '…'}</span>
              </span>
            </>
          ) : (
            <span className="tr-fig is-bad">
              <span className="tr-k">Rating</span>
              <span className="tr-v">–</span>
            </span>
          )}
        </div>
      </header>
      <div className="trench-toolbar" role="toolbar" aria-label="Cross-section tools">
        <div className="tool-group">
          <label htmlFor="tr-template" className="sr-only">
            Template
          </label>
          <select id="tr-template" value={template} onChange={(e) => setTemplate(e.target.value)}>
            {TRENCH_TEMPLATES.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {tp.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            onClick={() => {
              onChange(TRENCH_TEMPLATES.find((x) => x.id === template)!.apply({ ...inst, conduits: [], mainConduit: undefined }));
              setSel(null);
              setView({ zoom: 1, panX: 0, panY: 0 });
            }}
          >
            Use template
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()} title="Read the trench section from a DXF drawing">
            Import DXF…
          </button>
          <input ref={fileRef} type="file" accept=".dxf,image/vnd.dxf,application/dxf" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onDxfFile} />
        </div>
        <div className="tool-group">
          <button type="button" className="btn btn-quiet" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
            ↶ Undo
          </button>
          <button type="button" className="btn btn-quiet" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            ↷ Redo
          </button>
          <button type="button" className="btn btn-quiet" onClick={duplicate} disabled={!canDuplicate} title="Duplicate (Ctrl+D)">
            Duplicate
          </button>
          <button type="button" className="btn btn-quiet btn-danger" onClick={remove} disabled={!canDelete} title="Delete">
            Delete
          </button>
          <label htmlFor="tr-snap" className="tool-label">
            Snap
          </label>
          <select id="tr-snap" value={snap} onChange={(e) => setSnap(e.target.value)}>
            <option value="0">Off</option>
            <option value="0.01">10 mm</option>
            <option value="0.05">50 mm</option>
            <option value="0.1">100 mm</option>
          </select>
        </div>
        <div className="tool-group tool-add">
          <span className="tool-label">Add</span>
          <button type="button" className="btn btn-quiet" onClick={addCircuit}>
            Circuit
          </button>
          <button type="button" className="btn btn-quiet" onClick={addConduit} title="A pipe that can hold several circuits">
            Conduit
          </button>
          <button type="button" className="btn btn-quiet" onClick={addSource}>
            Heat source
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => addShape(trenchShape({ x: r3(contentRight() + 0.5), depth: 1.0, width: 0.6, fill: native.material, fillRho: native.rho }))}
          >
            Trench
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => addShape(rectShape('Backfill', 'cbs', mx, r3(Math.max(0.05, md - 0.3)), 0.6, 0.5))}>
            Rectangle
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => addShape(circleShape('Bore', 'bentonite', mx, md, 0.5))}>
            Circle
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() =>
              addShape(
                polygonShape('Fill', 'sand', [
                  [r3(mx - 0.3), r3(Math.max(0.05, md - 0.35))],
                  [r3(mx + 0.3), r3(Math.max(0.05, md - 0.35))],
                  [r3(mx + 0.4), r3(md + 0.3)],
                  [r3(mx - 0.4), r3(md + 0.3)],
                ]),
              )
            }
          >
            Polygon
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => addSlab('tile')}>
            Tiles
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => addSlab('tape')}>
            Tape
          </button>
          <button type="button" className="btn btn-quiet" onClick={addLayer}>
            Layer
          </button>
        </div>
      </div>
      {!iec.ok && (
        <div className="trench-alert" role="alert">
          <p>
            <strong>The rating cannot be calculated: </strong>
            {iec.errors[0]}
            {iec.errors.length > 1 ? ` (${iec.errors.length - 1} more listed below)` : ''}
          </p>
          {canUndo && (
            <button type="button" className="btn" onClick={undo}>
              ↶ Undo last change
            </button>
          )}
        </div>
      )}
      {dxfMsg && (
        <div className={`dxf-msg${dxf ? '' : ' is-note'}`} role="status">
          <p>{dxfMsg}</p>
          <button type="button" className="btn btn-quiet" onClick={() => setDxfMsg('')}>
            Close
          </button>
        </div>
      )}
      {dxf && (
        <DxfImport
          name={dxf.name}
          doc={dxf.doc}
          cable={cable}
          inst={inst}
          pal={pal}
          onCancel={() => setDxf(null)}
          onApply={(next, summary) => {
            onChange(next);
            setDxf(null);
            setSel(null);
            setShowDxf(true);
            setView({ zoom: 1, panX: 0, panY: 0 });
            setDxfMsg(`${summary} Check the fill of each region in the object list, and the cable in the Cable tab.`);
          }}
        />
      )}
      <div className="trench-body">
        <div
          className="trench-canvas"
          ref={wrap}
          tabIndex={0}
          aria-label="Cross-section drawing. Select an item, then use the arrow keys to move it."
          onKeyDown={onKey}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onWheel={(e) => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, toMm(e));
          }}
        >
          {scene ? (
            <TrenchSvg
              inst={inst}
              scene={scene}
              heat={heat}
              pal={pal}
              idPrefix={idPrefix}
              showHeat={showHeat}
              showLabels={showLabels}
              showUnderlay={showDxf}
              drag={{ start, selection: sel }}
            />
          ) : (
            <div className="drawing-empty">Complete the cable and installation inputs to see the cross-section.</div>
          )}
          {scene && showHeat && (
            <HeatLegend
              scene={scene}
              pal={pal}
              title={scene.numeric ? 'Ground temperature, numerical model, °C' : 'Ground temperature, IEC superposition (numerical model updating), °C'}
            />
          )}
          <div className="trench-viewbar">
            <div className="tool-group">
              <span className="tool-label">Zoom</span>
              <button type="button" className="btn btn-quiet" onClick={() => zoomAt(1 / 1.4)} aria-label="Zoom out">
                −
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => zoomAt(1.4)} aria-label="Zoom in" title="Zoom in on the selected item (or the main circuit)">
                +
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setView({ zoom: 1, panX: 0, panY: 0 })}>
                Fit
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => zoomAt('fit-focus')} title="Zoom to the selected item, or the main circuit">
                Close-up
              </button>
            </div>
            <div className="tool-group">
              <Toggle id="tr-heat" label="Temperatures" checked={showHeat} onChange={setShowHeat} />
              <Toggle id="tr-labels" label="Labels" checked={showLabels} onChange={setShowLabels} />
              {t.underlay && <Toggle id="tr-dxf" label="DXF drawing" checked={showDxf} onChange={setShowDxf} />}
            </div>
            <span className={`trench-status${num.status === 'error' ? ' is-bad' : ''}`} role="status">
              {numText}
            </span>
          </div>
        </div>
        <aside className="trench-inspector" aria-label="Selected item and object list">
          <h3>{title}</h3>
          {inspector}
          <h3 className="objects-title">Objects</h3>
          <ul className="object-list">
            {[{ index: 0, name: 'C1 (main circuit)' }, ...inst.circuits.map((c, k) => ({ index: k + 1, name: c.name || `C${k + 2}` }))].map((c) => (
              <li key={`c${c.index}`}>
                <button type="button" className={`obj${isSel('circuit', c.index) ? ' is-on' : ''}`} onClick={() => setSel({ kind: 'circuit', index: c.index })}>
                  <span className="obj-kind">Circuit</span> {c.name}
                </button>
              </li>
            ))}
            {conduits.map((k) => (
              <li key={k.id}>
                <button type="button" className={`obj${isSel('conduit', k.id) ? ' is-on' : ''}`} onClick={() => setSel({ kind: 'conduit', id: k.id })}>
                  <span className="obj-kind">Conduit</span> {k.name} · ⌀ {fmt(k.outerD_mm, 0)} mm
                </button>
              </li>
            ))}
            {(inst.heatSources ?? []).map((h) => (
              <li key={h.id}>
                <button type="button" className={`obj${isSel('source', h.id) ? ' is-on' : ''}`} onClick={() => setSel({ kind: 'source', id: h.id })}>
                  <span className="obj-kind">Heat</span> {h.name} · {fmt(h.W, 0)} W/m
                </button>
              </li>
            ))}
            {[...t.shapes].reverse().map((s) => (
              <li key={s.id}>
                <button type="button" className={`obj${isSel('shape', s.id) ? ' is-on' : ''}`} onClick={() => setSel({ kind: 'shape', id: s.id })}>
                  <span className="obj-kind">{{ trench: 'Trench', rect: 'Rect', circle: 'Circle', polygon: 'Polygon' }[s.kind]}</span> {s.name} · ρ {fmt(s.rho, 2)}
                </button>
              </li>
            ))}
            {t.slabs.map((s) => (
              <li key={s.id}>
                <button type="button" className={`obj${isSel('slab', s.id) ? ' is-on' : ''}`} onClick={() => setSel({ kind: 'slab', id: s.id })}>
                  <span className="obj-kind">{s.kind === 'tile' ? 'Tiles' : 'Tape'}</span> {fmt(s.width_m, 2)} m at {fmt(s.depth_m, 2)} m
                </button>
              </li>
            ))}
            {t.layers.map((l) => (
              <li key={l.id}>
                <button type="button" className={`obj${isSel('layer', l.id) ? ' is-on' : ''}`} onClick={() => setSel({ kind: 'layer', id: l.id })}>
                  <span className="obj-kind">Layer</span> {l.name} · ρ {fmt(l.rho, 2)}
                </button>
              </li>
            ))}
          </ul>
          <SelectField
            id="tr-surface"
            label="Ground surface"
            value={t.surface}
            options={[
              { value: 'grass', label: 'Grass' },
              { value: 'asphalt', label: 'Asphalt road' },
              { value: 'paving', label: 'Paving' },
            ]}
            onChange={(surface) => setT({ surface })}
          />
          <p className="field-hint">Layer boundaries: {layerBoundaries(t).map((y) => `${fmt(y, 2)} m`).join(', ') || 'single layer'}.</p>
        </aside>
      </div>
    </section>
  );
}
