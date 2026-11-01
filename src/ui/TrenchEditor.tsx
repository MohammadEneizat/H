import React, { useId, useMemo, useRef, useState } from 'react';
import {
  GROUND,
  TRENCH_TEMPLATES,
  deriveGeometry,
  layerBoundaries,
  trenchHalfWidth,
  type CableGeometry,
  type CableSpec,
  type CircuitSpec,
  type GroundMaterial,
  type InstallationSpec,
  type RatingResult,
  type SoilLayer,
  type TrenchSlab,
  type TrenchSpec,
  type TrenchZone,
} from '../engine';
import { CableGlyph, GroundDefs, HeatLegend, HeatOverlay, metalOf } from './Drawing';
import { NumField, SelectField, Segmented, TextField, Toggle } from './fields';
import { amps, fmt } from './format';
import { analyticField, gridMax, heatLayer, isoLevels, niceStep, sampleField, type FieldSourceLike, type HeatLayer, type Region } from './heatmap';
import { MaterialDefs } from './textures';
import type { Palette } from './theme';
import type { NumericState } from './useNumeric';

const FONT = "'IBM Plex Sans', 'DejaVu Sans', system-ui, sans-serif";
const uid = () => Math.random().toString(36).slice(2, 10);
const r2 = (v: number) => Math.round(v * 100) / 100;
const materialOptions = (Object.keys(GROUND) as GroundMaterial[]).map((m) => ({ value: m, label: GROUND[m].label }));

export type Selection =
  | { kind: 'trench' }
  | { kind: 'layer'; id: string }
  | { kind: 'zone'; id: string }
  | { kind: 'slab'; id: string }
  | { kind: 'circuit'; index: number }
  | null;

interface Group {
  name: string;
  positions: { x: number; y: number }[];
  geo: CableGeometry;
  D: number;
  hottest: number;
  temp: number;
  I: number;
  metal: [string, string, string];
  cond: [string, string, string];
}

export interface TrenchScene {
  region: Region;
  groups: Group[];
  heat: { tMin: number; tMax: number; levels: number[] } | null;
  field: FieldSourceLike | null;
  numeric: boolean;
}

/** Layout and temperature scale of the trench drawing. */
export function trenchScene(
  cable: CableSpec,
  inst: InstallationSpec,
  iec: RatingResult,
  num: NumericState | null,
  pal: Palette,
): TrenchScene | null {
  const t = inst.trench;
  if (!t || !iec.ok) return null;
  const useNum = !!num?.fresh && !!num.data?.result.ok;
  const r = useNum ? num!.data!.result : iec;
  const ducted = t.ducted;
  const base = r.system?.circuits ?? [
    {
      name: 'C1',
      positions: r.positions,
      De: r.geometry.De,
      ductD: ducted ? inst.duct.outerD_mm : undefined,
      hottest: r.thermal.t4.hottest,
      hottestTemp: r.temperatures.conductor,
      I: r.I,
    },
  ];
  const groups: Group[] = base.map((c, i) => {
    const cab = i === 0 ? cable : (inst.circuits[i - 1]?.cable ?? cable);
    return {
      name: c.name.replace(' (main)', ''),
      positions: c.positions,
      geo: i === 0 ? iec.geometry : deriveGeometry(cab).geometry,
      D: c.ductD ?? c.De,
      hottest: c.hottest,
      temp: c.hottestTemp,
      I: c.I,
      metal: metalOf(pal, cab.screen.material),
      cond: metalOf(pal, cab.conductor.material),
    };
  });
  const pts = groups.flatMap((g) => g.positions.map((p) => ({ ...p, D: g.D })));
  const cx = t.centreX_m * 1000;
  let x0 = Math.min(...pts.map((p) => p.x - p.D / 2), t.present ? cx - (t.topWidth_m / 2) * 1000 : Infinity);
  let x1 = Math.max(...pts.map((p) => p.x + p.D / 2), t.present ? cx + (t.topWidth_m / 2) * 1000 : -Infinity);
  t.slabs.forEach((s) => {
    x0 = Math.min(x0, (s.x_m - s.width_m / 2) * 1000);
    x1 = Math.max(x1, (s.x_m + s.width_m / 2) * 1000);
  });
  const deepest = Math.max(...pts.map((p) => p.y + p.D / 2), t.present ? t.depth_m * 1000 : 0);
  let y1 = deepest + Math.max(450, deepest * 0.3);
  const padX = Math.max(600, (x1 - x0) * 0.35);
  x0 -= padX;
  x1 += padX;
  let y0 = -Math.max(120, y1 * 0.06);
  // keep a pleasant aspect ratio
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < h * 1.35) {
    const e = (h * 1.35 - w) / 2;
    x0 -= e;
    x1 += e;
  } else if (w > h * 2.4) {
    y1 += w / 2.4 - h;
  }
  y0 = -Math.max(120, (y1 - y0) * 0.06);
  const region = { x0, y0, x1, y1 };

  let field: FieldSourceLike | null = null;
  if (useNum) {
    const bodies = num!.data!.numeric.objects;
    field = { fn: num!.data!.field, sources: bodies };
  } else if (iec.field) field = analyticField(iec.field);
  let heat: TrenchScene['heat'] = null;
  if (field) {
    const probe = sampleField(field.fn, { ...region, y0: 0 }, 120, 90);
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
  if (!scene.heat || !scene.field) return null;
  const { tMin, tMax, levels } = scene.heat;
  return heatLayer(scene.field, { ...scene.region, y0: 0 }, 300, tMin, tMax, levels, pal.heat);
}

interface DragHandlers {
  start: (e: React.PointerEvent, kind: string, payload?: string | number) => void;
  select: (s: Selection) => void;
  selection: Selection;
}

/** The trench drawing; interactive when `drag` is given. */
export function TrenchSvg({
  inst,
  scene,
  heat,
  pal,
  idPrefix,
  showHeat,
  drag,
}: {
  inst: InstallationSpec;
  scene: TrenchScene;
  heat: HeatLayer | null;
  pal: Palette;
  idPrefix: string;
  showHeat: boolean;
  drag?: DragHandlers;
}) {
  const t = inst.trench!;
  const id = (s: string) => `${idPrefix}-${s}`;
  const { region: R } = scene;
  const W = R.x1 - R.x0;
  const sw = W / 600;
  const fs = W / 52;
  const tile = W / 26;
  const cx = t.centreX_m * 1000;
  const D = t.depth_m * 1000;
  const hw = (y: number) => trenchHalfWidth(t, y / 1000) * 1000;
  const sel = drag?.selection;
  const isSel = (k: string, v?: string | number) =>
    !!sel && sel.kind === k && (v === undefined || ('id' in sel && sel.id === v) || ('index' in sel && sel.index === v));
  const halo = { stroke: pal.halo, strokeWidth: fs * 0.25, paintOrder: 'stroke' as const };
  const pe = drag ? undefined : ('none' as const);

  // Native layers
  let top = 0;
  const layers = t.layers
    .map((l, i) => {
      const last = i === t.layers.length - 1;
      const bottom = last ? Math.max(R.y1, top) : top + l.thickness_m * 1000;
      const out = { l, top, bottom: Math.min(bottom, R.y1), last: last || bottom >= R.y1 };
      top = bottom;
      return out;
    })
    .filter((x) => x.top < R.y1);
  const trenchPoly = (yt: number, yb: number) =>
    `${cx - hw(yt)},${yt} ${cx + hw(yt)},${yt} ${cx + hw(yb)},${yb} ${cx - hw(yb)},${yb}`;
  const surfaceH = Math.max(sw * 5, (R.y1 - R.y0) * 0.012);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${R.x0} ${R.y0} ${W} ${R.y1 - R.y0}`}
      role="img"
      aria-label="Trench cross-section"
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
      <rect x={R.x0} y={R.y0} width={W} height={-R.y0} fill={`url(#${id('sky')})`} />
      {layers.map(({ l, top: yt, bottom: yb }) => (
        <rect
          key={l.id}
          x={R.x0}
          y={yt}
          width={W}
          height={yb - yt}
          fill={`url(#${idPrefix}-m-${l.material})`}
          onPointerDown={drag ? () => drag.select({ kind: 'layer', id: l.id }) : undefined}
          style={{ cursor: drag ? 'pointer' : undefined }}
        />
      ))}
      {t.present && (
        <g>
          <polygon points={trenchPoly(0, D)} fill={pal.mode === 'light' ? '#ffffff' : '#000000'} opacity={0.12} pointerEvents="none" />
          {t.zones.map((z) => {
            const yt = Math.max(0, z.top_m * 1000);
            const yb = Math.min(D, z.bottom_m * 1000);
            if (yb <= yt) return null;
            return (
              <polygon
                key={z.id}
                points={trenchPoly(yt, yb)}
                fill={`url(#${idPrefix}-m-${z.material})`}
                onPointerDown={drag ? () => drag.select({ kind: 'zone', id: z.id }) : undefined}
                style={{ cursor: drag ? 'pointer' : undefined }}
              />
            );
          })}
        </g>
      )}
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
      {showHeat && heat && <g pointerEvents="none"><HeatOverlay layer={heat} pal={pal} fs={fs * 0.85} labels sw={sw * 1.2} imageOpacity={0.72} /></g>}
      {t.present && (
        <polyline
          points={`${cx - hw(0)},0 ${cx - hw(D)},${D} ${cx + hw(D)},${D} ${cx + hw(0)},0`}
          fill="none"
          stroke={isSel('trench') ? pal.accent : pal.ink2}
          strokeWidth={sw * (isSel('trench') ? 2.6 : 1.5)}
          strokeDasharray={`${sw * 7} ${sw * 4}`}
          onPointerDown={drag ? () => drag.select({ kind: 'trench' }) : undefined}
          style={{ cursor: drag ? 'pointer' : undefined }}
        />
      )}
      {/* tiles and tape */}
      {t.slabs.map((s) => {
        const x = (s.x_m - s.width_m / 2) * 1000;
        const y = s.depth_m * 1000;
        const w = s.width_m * 1000;
        const h = Math.max(s.thickness_m * 1000, s.kind === 'tape' ? sw * 3 : sw * 2);
        const fill = s.kind === 'tape' ? `url(#${id('tape')})` : `url(#${idPrefix}-m-${s.rho >= 2 ? 'polymer' : 'concrete'})`;
        return (
          <g key={s.id} pointerEvents={pe}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill={fill}
              stroke={isSel('slab', s.id) ? pal.accent : pal.ink2}
              strokeWidth={sw * (isSel('slab', s.id) ? 2.2 : 0.8)}
              onPointerDown={drag ? (e) => drag.start(e, 'slab', s.id) : undefined}
              className={drag ? 'drag' : undefined} style={{ cursor: drag ? 'move' : undefined }}
            />
            {drag && <rect x={x} y={y - sw * 6} width={w} height={h + sw * 12} fill="transparent" onPointerDown={(e) => drag.start(e, 'slab', s.id)} className="drag" style={{ cursor: 'move' }} />}
          </g>
        );
      })}
      {/* ducts and cables */}
      {scene.groups.map((g, gi) => (
        <g key={gi} pointerEvents="none">
          {g.positions.map((p, i) => (
            <g key={i}>
              {t.ducted && (
                <>
                  <circle cx={p.x} cy={p.y} r={inst.duct.outerD_mm / 2} fill={pal.duct} stroke={pal.ductEdge} strokeWidth={sw * 0.6} />
                  <circle cx={p.x} cy={p.y} r={inst.duct.innerD_mm / 2} fill={pal.air} />
                </>
              )}
              <CableGlyph x={p.x} y={p.y} geo={g.geo} metal={g.metal} cond={g.cond} hot={gi === 0 && i === g.hottest} sw={sw} pal={pal} id={id} />
            </g>
          ))}
        </g>
      ))}
      {/* circuit labels and hit areas */}
      {(() => {
        // Neighbouring circuits that are close get their labels alternately above and below
        const order = scene.groups
          .map((g, gi) => ({ gi, gx: g.positions.reduce((a, p) => a + p.x, 0) / 3 }))
          .sort((a, b) => a.gx - b.gx);
        const below = new Set<number>();
        order.forEach((o, k) => {
          if (k > 0 && o.gx - order[k - 1].gx < fs * 9 && !below.has(order[k - 1].gi)) below.add(o.gi);
        });
        return scene.groups.map((g, gi) => {
          const xs = g.positions.map((p) => p.x);
          const ys = g.positions.map((p) => p.y);
          const bx0 = Math.min(...xs) - g.D / 2 - sw * 6;
          const by0 = Math.min(...ys) - g.D / 2 - sw * 6;
          const bw = Math.max(...xs) - Math.min(...xs) + g.D + sw * 12;
          const bh = Math.max(...ys) - Math.min(...ys) + g.D + sw * 12;
          const gx = xs.reduce((a, b) => a + b, 0) / 3;
          const ly = below.has(gi) ? by0 + bh + fs * 1.1 : by0 - fs * 0.4;
          return (
            <g key={`h${gi}`}>
              <text x={gx} y={ly} fontSize={fs} textAnchor="middle" fontWeight={600} fill={gi === 0 ? pal.accent : pal.ink} {...halo} pointerEvents="none">
                {g.name} · {amps(g.I)} A · {fmt(g.temp, 0)} °C
              </text>
              {(drag || isSel('circuit', gi)) && (
                <rect
                  x={bx0}
                  y={by0}
                  width={bw}
                  height={bh}
                  rx={sw * 4}
                  fill="transparent"
                  stroke={isSel('circuit', gi) ? pal.accent : 'none'}
                  strokeWidth={sw * 1.6}
                  strokeDasharray={`${sw * 5} ${sw * 3}`}
                  onPointerDown={drag ? (e) => drag.start(e, 'circuit', gi) : undefined}
                  className={drag ? 'drag' : undefined}
                  style={{ cursor: drag ? 'move' : undefined }}
                />
              )}
            </g>
          );
        });
      })()}
      {/* labels: layers on the left, zones in the trench */}
      {layers.map(({ l, top: yt, bottom: yb, last }) => (
        <text key={`ll${l.id}`} x={R.x0 + fs * 0.5} y={Math.min(yb, yt + (last ? fs * 3 : (yb - yt) / 2 + fs * 0.35))} fontSize={fs * 0.8} fill={pal.ink} {...halo} pointerEvents="none">
          {l.name} · ρ {fmt(l.rho, 2)}
        </text>
      ))}
      {t.present &&
        t.zones.map((z) => {
          const yt = Math.max(0, z.top_m * 1000);
          const yb = Math.min(D, z.bottom_m * 1000);
          if (yb - yt < fs * 1.6) return null;
          return (
            <text key={`zl${z.id}`} x={cx - hw(yt) + fs * 0.4} y={yt + fs * 1.25} fontSize={fs * 0.75} fill={pal.ink} {...halo} pointerEvents="none">
              {z.name} · ρ {fmt(z.rho, 2)}
            </text>
          );
        })}
      {/* dimensions */}
      {t.present && (
        <g pointerEvents="none">
          <line x1={cx - hw(0)} y1={-surfaceH * 3.2} x2={cx + hw(0)} y2={-surfaceH * 3.2} stroke={pal.ink2} strokeWidth={sw} markerStart={`url(#${id('arrow')})`} markerEnd={`url(#${id('arrow')})`} />
          <text x={cx} y={-surfaceH * 3.2 - fs * 0.35} fontSize={fs * 0.8} textAnchor="middle" fill={pal.ink} {...halo}>
            {fmt(t.topWidth_m, 2)} m
          </text>
          <line x1={cx + hw(D) + fs * 1.6} y1={0} x2={cx + hw(D) + fs * 1.6} y2={D} stroke={pal.ink2} strokeWidth={sw} markerStart={`url(#${id('arrow')})`} markerEnd={`url(#${id('arrow')})`} />
          <text x={cx + hw(D) + fs * 2} y={D / 2} fontSize={fs * 0.8} fill={pal.ink} {...halo} dominantBaseline="middle">
            {fmt(t.depth_m, 2)} m
          </text>
        </g>
      )}
      {scene.groups[0] && (
        <g pointerEvents="none">
          {(() => {
            const g = scene.groups[0];
            const gx = Math.min(...g.positions.map((p) => p.x)) - g.D / 2 - fs * 1.2;
            const yc = g.positions.reduce((a, p) => a + p.y, 0) / 3;
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
      {/* edges and handles (editor only) */}
      {drag && (
        <g>
          {layers
            .filter((x) => !x.last)
            .map(({ l, bottom }) => (
              <line key={`lb${l.id}`} x1={R.x0} y1={bottom} x2={R.x1} y2={bottom} stroke="transparent" strokeWidth={sw * 10} className="drag" style={{ cursor: 'ns-resize' }} onPointerDown={(e) => drag.start(e, 'layer-bottom', l.id)} />
            ))}
          {t.present &&
            t.zones.map((z) => (
              <g key={`ze${z.id}`}>
                {(['top', 'bottom'] as const).map((edge) => {
                  const y = (edge === 'top' ? z.top_m : z.bottom_m) * 1000;
                  if (edge === 'top' && y <= 0) return null;
                  return (
                    <line
                      key={edge}
                      x1={cx - hw(y)}
                      y1={y}
                      x2={cx + hw(y)}
                      y2={y}
                      stroke={isSel('zone', z.id) ? pal.accent : 'transparent'}
                      strokeWidth={isSel('zone', z.id) ? sw * 2 : sw * 10}
                      className="drag" style={{ cursor: 'ns-resize' }}
                      onPointerDown={(e) => drag.start(e, `zone-${edge}`, z.id)}
                    />
                  );
                })}
              </g>
            ))}
          {t.present &&
            [
              { kind: 'trench-top', x: cx + hw(0), y: 0, cur: 'ew-resize' },
              { kind: 'trench-corner', x: cx + hw(D), y: D, cur: 'nwse-resize' },
              { kind: 'trench-move', x: cx, y: D, cur: 'move' },
            ].map((hdl) => (
              <rect
                key={hdl.kind}
                x={hdl.x - sw * 6}
                y={hdl.y - sw * 6}
                width={sw * 12}
                height={sw * 12}
                fill={pal.panel}
                stroke={pal.accent}
                strokeWidth={sw * 1.4}
                className="drag" style={{ cursor: hdl.cur }}
                onPointerDown={(e) => drag.start(e, hdl.kind)}
              />
            ))}
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
}

/** Drag-and-drop trench editor with an inspector for exact values. */
export function TrenchEditor({ cable, inst, iec, num, pal, onChange }: EditorProps) {
  const idPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [sel, setSel] = useState<Selection>(null);
  const [showHeat, setShowHeat] = useState(true);
  const [template, setTemplate] = useState(TRENCH_TEMPLATES[0].id);
  const svgWrap = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ kind: string; payload?: string | number; x0: number; y0: number; inst: InstallationSpec } | null>(null);
  const t = inst.trench;

  const scene = useMemo(() => trenchScene(cable, inst, iec, num, pal), [cable, inst, iec, num, pal]);
  const heat = useMemo(() => (scene && showHeat ? trenchHeat(scene, pal) : null), [scene, pal, showHeat]);

  if (!t) return null;

  const setT = (patch: Partial<TrenchSpec>) => onChange({ ...inst, trench: { ...t, ...patch } });
  const setLayer = (id: string, patch: Partial<SoilLayer>) => setT({ layers: t.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const setZone = (id: string, patch: Partial<TrenchZone>) => setT({ zones: t.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) });
  const setSlab = (id: string, patch: Partial<TrenchSlab>) => setT({ slabs: t.slabs.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const circuitPatch = (base: InstallationSpec, index: number, patch: { x?: number; depth?: number }): InstallationSpec => {
    if (index === 0) return { ...base, mainX_m: patch.x ?? base.mainX_m, depth_m: patch.depth ?? base.depth_m };
    return {
      ...base,
      circuits: base.circuits.map((c, i) =>
        i === index - 1 ? { ...c, x_m: patch.x ?? c.x_m, depth_m: patch.depth ?? c.depth_m } : c,
      ),
    };
  };

  const toMm = (e: { clientX: number; clientY: number }) => {
    const svg = svgWrap.current?.querySelector('svg');
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const start = (e: React.PointerEvent, kind: string, payload?: string | number) => {
    e.stopPropagation();
    e.preventDefault();
    const p = toMm(e);
    dragRef.current = { kind, payload, x0: p.x, y0: p.y, inst };
    svgWrap.current?.setPointerCapture?.(e.pointerId);
    if (kind === 'circuit') setSel({ kind: 'circuit', index: payload as number });
    else if (kind === 'slab') setSel({ kind: 'slab', id: payload as string });
    else if (kind.startsWith('zone')) setSel({ kind: 'zone', id: payload as string });
    else if (kind === 'layer-bottom') setSel({ kind: 'layer', id: payload as string });
    else setSel({ kind: 'trench' });
  };

  const move = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = toMm(e);
    const dx = (p.x - d.x0) / 1000;
    const dy = (p.y - d.y0) / 1000;
    const b = d.inst;
    const bt = b.trench!;
    const snap = (v: number) => r2(v);
    let next: InstallationSpec = b;
    switch (d.kind) {
      case 'circuit': {
        const i = d.payload as number;
        const x0 = i === 0 ? (b.mainX_m ?? 0) : b.circuits[i - 1].x_m;
        const y0 = i === 0 ? b.depth_m : b.circuits[i - 1].depth_m;
        next = circuitPatch(b, i, { x: snap(x0 + dx), depth: Math.max(0.1, snap(y0 + dy)) });
        break;
      }
      case 'slab': {
        const s = bt.slabs.find((x) => x.id === d.payload)!;
        next = {
          ...b,
          trench: {
            ...bt,
            slabs: bt.slabs.map((x) => (x.id === s.id ? { ...x, x_m: snap(s.x_m + dx), depth_m: Math.max(0, snap(s.depth_m + dy)) } : x)),
          },
        };
        break;
      }
      case 'zone-top':
      case 'zone-bottom': {
        const z = bt.zones.find((x) => x.id === d.payload)!;
        const zones = bt.zones.map((x) => {
          if (x.id !== z.id) return x;
          if (d.kind === 'zone-top') return { ...x, top_m: Math.min(x.bottom_m - 0.02, Math.max(0, snap(z.top_m + dy))) };
          return { ...x, bottom_m: Math.max(x.top_m + 0.02, Math.min(bt.depth_m, snap(z.bottom_m + dy))) };
        });
        next = { ...b, trench: { ...bt, zones } };
        break;
      }
      case 'layer-bottom': {
        const l = bt.layers.find((x) => x.id === d.payload)!;
        next = { ...b, trench: { ...bt, layers: bt.layers.map((x) => (x.id === l.id ? { ...x, thickness_m: Math.max(0.05, snap(l.thickness_m + dy)) } : x)) } };
        break;
      }
      case 'trench-top':
        next = { ...b, trench: { ...bt, topWidth_m: Math.max(0.2, snap(bt.topWidth_m + 2 * dx)) } };
        break;
      case 'trench-corner': {
        const depth = Math.max(0.3, snap(bt.depth_m + dy));
        next = {
          ...b,
          trench: {
            ...bt,
            bottomWidth_m: Math.max(0.2, snap(bt.bottomWidth_m + 2 * dx)),
            depth_m: depth,
            zones: bt.zones.map((z) => ({ ...z, bottom_m: Math.min(z.bottom_m === bt.depth_m ? depth : z.bottom_m, depth), top_m: Math.min(z.top_m, depth - 0.02) })),
          },
        };
        break;
      }
      case 'trench-move':
        next = { ...b, trench: { ...bt, centreX_m: snap(bt.centreX_m + dx) } };
        break;
    }
    onChange(next);
  };

  const end = () => {
    dragRef.current = null;
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!sel) return;
    const step = e.shiftKey ? 0.1 : 0.01;
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (dirs[e.key]) {
      const [dx, dy] = dirs[e.key];
      if (sel.kind === 'circuit') {
        const x0 = sel.index === 0 ? (inst.mainX_m ?? 0) : inst.circuits[sel.index - 1].x_m;
        const y0 = sel.index === 0 ? inst.depth_m : inst.circuits[sel.index - 1].depth_m;
        onChange(circuitPatch(inst, sel.index, { x: r2(x0 + dx), depth: Math.max(0.1, r2(y0 + dy)) }));
        e.preventDefault();
      } else if (sel.kind === 'slab') {
        const s = t.slabs.find((x) => x.id === sel.id);
        if (s) setSlab(s.id, { x_m: r2(s.x_m + dx), depth_m: Math.max(0, r2(s.depth_m + dy)) });
        e.preventDefault();
      }
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (sel.kind === 'slab') setT({ slabs: t.slabs.filter((s) => s.id !== sel.id) });
      else if (sel.kind === 'zone') setT({ zones: t.zones.filter((z) => z.id !== sel.id) });
      else if (sel.kind === 'circuit' && sel.index > 0) onChange({ ...inst, circuits: inst.circuits.filter((_, i) => i !== sel.index - 1) });
      else return;
      setSel(null);
      e.preventDefault();
    }
  };

  // --- add actions
  const addCircuit = () => {
    const xs = [inst.mainX_m ?? 0, ...inst.circuits.map((c) => c.x_m)];
    const D = (t.ducted ? inst.duct.outerD_mm : deriveGeometry(cable).geometry.De || 50) / 1000;
    const s = inst.touching ? D : inst.spacing_mm / 1000;
    const width = (inst.formation === 'flat' ? 2 * s : s) + D;
    const c: CircuitSpec = {
      id: uid(),
      name: `C${inst.circuits.length + 2}`,
      cable: null,
      x_m: r2(Math.max(...xs) + width + 0.15),
      depth_m: inst.depth_m,
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
  const addSlab = (kind: 'tile' | 'tape') => {
    const s: TrenchSlab = {
      id: uid(),
      kind,
      x_m: t.centreX_m,
      depth_m: kind === 'tile' ? r2(Math.max(0.2, inst.depth_m - 0.25)) : r2(Math.max(0.2, inst.depth_m - 0.55)),
      width_m: r2(Math.min(t.bottomWidth_m, t.topWidth_m) * 0.85),
      thickness_m: kind === 'tile' ? 0.03 : 0.005,
      rho: kind === 'tile' ? GROUND.polymer.rho : 1,
    };
    setT({ slabs: [...t.slabs, s] });
    setSel({ kind: 'slab', id: s.id });
  };
  const addZone = () => {
    const tops = t.zones.map((z) => z.top_m);
    const bottom = tops.length ? Math.min(...tops) : t.depth_m;
    const z: TrenchZone = { id: uid(), name: 'Sand', material: 'sand', rho: GROUND.sand.rho, top_m: r2(Math.max(0, bottom - 0.3)), bottom_m: r2(bottom) };
    if (z.bottom_m - z.top_m < 0.02) return;
    setT({ zones: [...t.zones, z] });
    setSel({ kind: 'zone', id: z.id });
  };
  const addLayer = () => {
    const l: SoilLayer = { id: uid(), name: 'Clay', material: 'clay', thickness_m: 0.5, rho: GROUND.clay.rho };
    const layers = [...t.layers];
    layers.splice(Math.max(0, layers.length - 1), 0, l);
    setT({ layers });
    setSel({ kind: 'layer', id: l.id });
  };

  // --- inspector
  let inspector: React.ReactNode = (
    <p className="empty-note">
      Select an item to edit it. Drag circuits, tiles and tape; drag zone and layer edges; use the square handles to
      resize or move the trench. Arrow keys move the selected item by 10 mm (Shift: 100 mm).
    </p>
  );
  const num0 = (v: number | null) => (v === null ? 0 : v);
  if (sel?.kind === 'trench') {
    inspector = (
      <div className="field-grid">
        <Toggle id="tr-present" label="Open-cut trench" checked={t.present} onChange={(present) => setT({ present })} hint="Off for drilled or bored crossings: cables lie in the layered ground." />
        <Toggle id="tr-ducted" label="Cables in ducts" checked={t.ducted} onChange={(ducted) => setT({ ducted })} hint="Duct sizes are set in the Installation tab." />
        <NumField id="tr-top" label="Width at surface" unit="m" value={t.topWidth_m} onChange={(v) => setT({ topWidth_m: num0(v) })} />
        <NumField id="tr-bottom" label="Width at bottom" unit="m" value={t.bottomWidth_m} onChange={(v) => setT({ bottomWidth_m: num0(v) })} />
        <NumField id="tr-depth" label="Depth" unit="m" value={t.depth_m} onChange={(v) => setT({ depth_m: num0(v) })} />
        <NumField id="tr-x" label="Centre position" unit="m" value={t.centreX_m} onChange={(v) => setT({ centreX_m: num0(v) })} />
        <SelectField
          id="tr-surface"
          label="Surface"
          value={t.surface}
          options={[
            { value: 'grass', label: 'Grass' },
            { value: 'asphalt', label: 'Asphalt road' },
            { value: 'paving', label: 'Paving' },
          ]}
          onChange={(surface) => setT({ surface })}
        />
      </div>
    );
  } else if (sel?.kind === 'layer') {
    const l = t.layers.find((x) => x.id === sel.id);
    const idx = t.layers.findIndex((x) => x.id === sel.id);
    if (l)
      inspector = (
        <div className="field-grid">
          <TextField id="ly-name" label="Layer name" value={l.name} onChange={(name) => setLayer(l.id, { name })} />
          <SelectField id="ly-mat" label="Material" value={l.material} options={materialOptions} onChange={(material) => setLayer(l.id, { material, rho: GROUND[material].rho })} />
          <NumField id="ly-rho" label="Thermal resistivity" unit="K·m/W" value={l.rho} onChange={(v) => setLayer(l.id, { rho: num0(v) })} hint="Use measured site values where you have them." />
          {idx < t.layers.length - 1 ? (
            <NumField id="ly-t" label="Thickness" unit="m" value={l.thickness_m} onChange={(v) => setLayer(l.id, { thickness_m: num0(v) })} />
          ) : (
            <p className="field-hint field-wide">The bottom layer continues downwards.</p>
          )}
          {t.layers.length > 1 && (
            <div className="btn-row field-wide">
              <button type="button" className="btn btn-quiet btn-danger" onClick={() => { setT({ layers: t.layers.filter((x) => x.id !== l.id) }); setSel(null); }}>
                Remove layer
              </button>
            </div>
          )}
        </div>
      );
  } else if (sel?.kind === 'zone') {
    const z = t.zones.find((x) => x.id === sel.id);
    if (z)
      inspector = (
        <div className="field-grid">
          <TextField id="zn-name" label="Fill name" value={z.name} onChange={(name) => setZone(z.id, { name })} />
          <SelectField id="zn-mat" label="Material" value={z.material} options={materialOptions} onChange={(material) => setZone(z.id, { material, rho: GROUND[material].rho })} />
          <NumField id="zn-rho" label="Thermal resistivity" unit="K·m/W" value={z.rho} onChange={(v) => setZone(z.id, { rho: num0(v) })} />
          <NumField id="zn-top" label="Top depth" unit="m" value={z.top_m} onChange={(v) => setZone(z.id, { top_m: num0(v) })} />
          <NumField id="zn-bot" label="Bottom depth" unit="m" value={z.bottom_m} onChange={(v) => setZone(z.id, { bottom_m: num0(v) })} />
          <div className="btn-row field-wide">
            <button type="button" className="btn btn-quiet btn-danger" onClick={() => { setT({ zones: t.zones.filter((x) => x.id !== z.id) }); setSel(null); }}>
              Remove fill zone
            </button>
          </div>
        </div>
      );
  } else if (sel?.kind === 'slab') {
    const s = t.slabs.find((x) => x.id === sel.id);
    if (s)
      inspector = (
        <div className="field-grid">
          <Segmented
            id="sl-kind"
            label="Type"
            value={s.kind}
            options={[
              { value: 'tile', label: 'Cover tiles' },
              { value: 'tape', label: 'Warning tape' },
            ]}
            onChange={(kind) => setSlab(s.id, { kind })}
          />
          <NumField id="sl-x" label="Centre position" unit="m" value={s.x_m} onChange={(v) => setSlab(s.id, { x_m: num0(v) })} />
          <NumField id="sl-d" label="Depth of top" unit="m" value={s.depth_m} onChange={(v) => setSlab(s.id, { depth_m: num0(v) })} />
          <NumField id="sl-w" label="Width" unit="m" value={s.width_m} onChange={(v) => setSlab(s.id, { width_m: num0(v) })} />
          {s.kind === 'tile' && (
            <>
              <NumField id="sl-t" label="Thickness" unit="m" value={s.thickness_m} onChange={(v) => setSlab(s.id, { thickness_m: num0(v) })} />
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
          <div className="btn-row field-wide">
            <button type="button" className="btn btn-quiet btn-danger" onClick={() => { setT({ slabs: t.slabs.filter((x) => x.id !== s.id) }); setSel(null); }}>
              Remove
            </button>
          </div>
        </div>
      );
  } else if (sel?.kind === 'circuit') {
    const i = sel.index;
    const c = i === 0 ? null : inst.circuits[i - 1];
    if (i === 0 || c)
      inspector = (
        <div className="field-grid">
          <p className="field-hint field-wide">
            {i === 0 ? 'Main circuit C1. Its cable, bonding and spacing are set in the Cable and Installation tabs.' : `${c!.name}. Cable, bonding and load are set in the Circuits tab.`}
          </p>
          <NumField
            id="ci-x"
            label="Horizontal position"
            unit="m"
            value={i === 0 ? (inst.mainX_m ?? 0) : c!.x_m}
            onChange={(v) => onChange(circuitPatch(inst, i, { x: num0(v) }))}
          />
          <NumField
            id="ci-d"
            label="Depth to centre"
            unit="m"
            value={i === 0 ? inst.depth_m : c!.depth_m}
            onChange={(v) => onChange(circuitPatch(inst, i, { depth: num0(v) }))}
          />
          {i > 0 && (
            <div className="btn-row field-wide">
              <button type="button" className="btn btn-quiet btn-danger" onClick={() => { onChange({ ...inst, circuits: inst.circuits.filter((_, k) => k !== i - 1) }); setSel(null); }}>
                Remove circuit
              </button>
            </div>
          )}
        </div>
      );
  }

  const selTitle =
    sel?.kind === 'trench'
      ? 'Trench'
      : sel?.kind === 'layer'
        ? 'Ground layer'
        : sel?.kind === 'zone'
          ? 'Fill zone'
          : sel?.kind === 'slab'
            ? 'Tiles or tape'
            : sel?.kind === 'circuit'
              ? `Circuit C${sel.index + 1}`
              : 'Nothing selected';

  return (
    <section className="card trench-card" aria-labelledby="trench-title">
      <header className="card-head">
        <div>
          <h2 id="trench-title">Trench</h2>
          <p className="card-sub">Drag to arrange. Changes update the IEC rating at once and the numerical model a moment later.</p>
        </div>
        <span className={`pill ${num.status === 'error' ? 'pill-bad' : num.fresh ? 'pill-ok' : 'pill-note'}`} role="status">
          {num.status === 'error'
            ? 'Numerical model failed'
            : num.fresh && num.data
              ? `Numerical model · ${(num.data.numeric.nx * num.data.numeric.ny).toLocaleString('en-GB')} cells · ${Math.round(num.data.numeric.ms)} ms`
              : 'Updating numerical model…'}
        </span>
      </header>
      <div className="trench-toolbar" role="toolbar" aria-label="Trench tools">
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
              const tp = TRENCH_TEMPLATES.find((x) => x.id === template)!;
              onChange(tp.apply(inst));
              setSel(null);
            }}
          >
            Use template
          </button>
        </div>
        <div className="tool-group">
          <span className="tool-label">Add</span>
          <button type="button" className="btn btn-quiet" onClick={addCircuit}>
            Circuit
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => addSlab('tile')}>
            Cover tiles
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => addSlab('tape')}>
            Warning tape
          </button>
          <button type="button" className="btn btn-quiet" onClick={addZone} disabled={!t.present}>
            Fill zone
          </button>
          <button type="button" className="btn btn-quiet" onClick={addLayer}>
            Ground layer
          </button>
        </div>
        <Toggle id="tr-heat" label="Temperatures" checked={showHeat} onChange={setShowHeat} />
      </div>
      <div className="trench-body">
        <div
          className="trench-canvas"
          ref={svgWrap}
          tabIndex={0}
          aria-label="Trench drawing. Select an item, then use the arrow keys to move it."
          onKeyDown={onKey}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setSel(null);
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
              drag={{ start, select: setSel, selection: sel }}
            />
          ) : (
            <div className="drawing-empty">Complete the cable and installation inputs to see the trench.</div>
          )}
          {scene && showHeat && (
            <HeatLegend
              scene={scene}
              pal={pal}
              title={scene.numeric ? 'Ground temperature, numerical model, °C' : 'Ground temperature, IEC superposition (numerical model updating), °C'}
            />
          )}
        </div>
        <aside className="trench-inspector" aria-label="Selected item">
          <h3>{selTitle}</h3>
          {inspector}
          <dl className="trench-facts">
            <dt>Layer boundaries</dt>
            <dd>{layerBoundaries(t).map((y) => `${fmt(y, 2)} m`).join(', ') || 'single layer'}</dd>
            <dt>Fill zones</dt>
            <dd>{t.present ? t.zones.map((z) => `${z.name} ${fmt(z.top_m, 2)}–${fmt(z.bottom_m, 2)} m`).join('; ') || 'none' : 'no trench'}</dd>
          </dl>
        </aside>
      </div>
    </section>
  );
}
