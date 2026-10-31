import React, { useId, useMemo } from 'react';
import {
  AIR_CONSTANTS,
  INSULATIONS,
  JACKETS,
  METALS,
  deriveGeometry,
  type CableGeometry,
  type CableSpec,
  type InstallationSpec,
  type MetalKey,
  type RatingResult,
} from '../engine';
import { fmt } from './format';
import { gridMax, heatLayer, isoLevels, niceStep, sampleField, type HeatLayer, type Region } from './heatmap';
import { heatAlpha, makeRamp, rgbHex, type Palette } from './theme';

const FONT = "'IBM Plex Sans', 'DejaVu Sans', system-ui, sans-serif";
const SVGNS = 'http://www.w3.org/2000/svg';
const cleanId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '');

function metalOf(pal: Palette, key: MetalKey): [string, string, string] {
  if (key === 'Cu' || key === 'bronze') return pal.cu;
  if (key === 'Al') return pal.al;
  if (key === 'Pb') return pal.pb;
  return pal.steel;
}

const geometryOk = (g: CableGeometry) => [g.dc, g.Di, g.Dunder, g.Ds, g.De].every((v) => Number.isFinite(v) && v > 0);

// ---------------------------------------------------------------------------------------
// Cable cross-section
// ---------------------------------------------------------------------------------------

export interface LayerInfo {
  n: number;
  name: string;
  detail: string;
  rIn: number;
  rOut: number;
}

/** The layers of the cable, inside out, for the callouts and the report. */
export function cableLayers(cable: CableSpec, g: CableGeometry): LayerInfo[] {
  const out: LayerInfo[] = [];
  const push = (name: string, detail: string, dIn: number, dOut: number) => {
    if (dOut > dIn + 1e-9) out.push({ n: out.length + 1, name, detail, rIn: dIn / 2, rOut: dOut / 2 });
  };
  const c = cable.conductor;
  const construction =
    c.construction === 'milliken' ? 'Milliken segmental' : c.construction === 'solid' ? 'round solid' : 'round stranded';
  push('Conductor', `${METALS[c.material].label}, ${construction}, ${c.area_mm2} mm², ⌀ ${fmt(g.dc, 1)} mm`, 0, g.dc);
  push('Conductor screen', `Semiconducting, ${fmt(cable.conductorScreen_mm, 1)} mm`, g.dc, g.dcScreen);
  push(
    'Insulation',
    `${INSULATIONS[cable.insulation.material].label.split(',')[0]}, ${fmt(cable.insulation.thickness_mm, 1)} mm, ⌀ ${fmt(g.Di, 1)} mm`,
    g.dcScreen,
    g.Di,
  );
  push('Insulation screen', `Semiconducting, ${fmt(cable.insulationScreen_mm, 1)} mm`, g.Di, g.Dis);
  push('Tapes', `Bedding / swelling tape, ${fmt(cable.bedding_mm, 1)} mm`, g.Dis, g.Dunder);
  const metal = METALS[cable.screen.material].label;
  const s = cable.screen;
  if (s.form === 'wires') {
    const count = s.wireCount ? `${s.wireCount} × ` : '';
    push('Metallic screen', `${metal} wires ${count}⌀ ${fmt(s.thickness_mm, 2)} mm, ${fmt(g.As, 1)} mm²`, g.Dunder, g.Ds);
  } else if (s.form === 'smooth') {
    push('Metallic sheath', `${metal}, ${fmt(s.thickness_mm, 2)} mm, ${fmt(g.As, 0)} mm²`, g.Dunder, g.Ds);
  } else {
    push('Corrugated sheath', `${metal}, ${fmt(s.thickness_mm, 2)} mm, ⌀ ${fmt(g.Doc, 1)} mm over crests`, g.Dunder, g.Ds);
  }
  push(
    'Oversheath',
    `${JACKETS[cable.jacket.material].label.split(',')[0]}, ${fmt(cable.jacket.thickness_mm, 1)} mm, ⌀ ${fmt(g.De, 1)} mm`,
    g.Da,
    Math.max(g.De, g.DeBuilt),
  );
  return out;
}

/** Concentric strand layout of a stranded conductor (centre wire plus rings of 6k wires). */
function strands(area: number, dc: number) {
  const rings = area <= 16 ? 1 : area <= 50 ? 2 : area <= 150 ? 3 : area <= 400 ? 4 : area <= 800 ? 5 : 6;
  const ds = dc / (2 * rings + 1);
  const pts: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  for (let k = 1; k <= rings; k++) {
    const count = 6 * k;
    for (let i = 0; i < count; i++) {
      const a = (2 * Math.PI * i) / count + (k % 2 ? 0 : Math.PI / count);
      pts.push({ x: k * ds * Math.cos(a), y: k * ds * Math.sin(a) });
    }
  }
  return { pts, ds };
}

export function CableSectionSvg({
  cable,
  g,
  pal,
  idPrefix,
  callouts = true,
}: {
  cable: CableSpec;
  g: CableGeometry;
  pal: Palette;
  idPrefix: string;
  callouts?: boolean;
}) {
  const id = (s: string) => `${idPrefix}-${s}`;
  const R = Math.max(g.De, g.DeBuilt) / 2;
  const k = 92 / R;
  const r = (d: number) => (d / 2) * k;
  const cond = metalOf(pal, cable.conductor.material);
  const scr = metalOf(pal, cable.screen.material);
  const layers = cableLayers(cable, g);

  // Conductor
  let conductor: React.ReactNode;
  if (cable.conductor.construction === 'solid') {
    conductor = <circle r={r(g.dc)} fill={`url(#${id('cond')})`} />;
  } else {
    const { pts, ds } = strands(cable.conductor.area_mm2 || 240, g.dc);
    const segN = cable.conductor.construction === 'milliken' ? (cable.conductor.area_mm2 >= 1600 ? 6 : 5) : 0;
    conductor = (
      <g>
        <circle r={r(g.dc)} fill={cond[2]} />
        <g clipPath={`url(#${id('condclip')})`}>
          {pts.map((p, i) => (
            <circle
              key={i}
              cx={p.x * k}
              cy={p.y * k}
              r={(ds / 2) * k * 1.07}
              fill={`url(#${id('strand')})`}
              stroke={cond[2]}
              strokeWidth={0.25}
            />
          ))}
          {segN > 0 &&
            Array.from({ length: segN }, (_, i) => {
              const a = (2 * Math.PI * i) / segN - Math.PI / 2;
              return (
                <line
                  key={`s${i}`}
                  x1={0}
                  y1={0}
                  x2={r(g.dc) * Math.cos(a)}
                  y2={r(g.dc) * Math.sin(a)}
                  stroke={pal.semicon}
                  strokeWidth={Math.max(0.8, r(g.dc) * 0.05)}
                />
              );
            })}
          {segN > 0 && <circle r={r(g.dc) * 0.1} fill={pal.semicon} />}
        </g>
        <circle r={r(g.dc)} fill={`url(#${id('sheen')})`} />
      </g>
    );
  }

  // Metallic screen or sheath
  let screen: React.ReactNode;
  const rUnder = r(g.Dunder);
  const rDs = r(g.Ds);
  if (cable.screen.form === 'wires') {
    const t = cable.screen.thickness_mm;
    const count = Math.max(6, Math.min(220, Math.round(cable.screen.wireCount ?? g.As / ((Math.PI * t * t) / 4)) || 40));
    const rc = r(g.dMean);
    const rw = Math.max(0.5, r(t));
    screen = (
      <g>
        {Array.from({ length: count }, (_, i) => {
          const a = (2 * Math.PI * i) / count;
          return (
            <circle
              key={i}
              cx={rc * Math.cos(a)}
              cy={rc * Math.sin(a)}
              r={rw}
              fill={`url(#${id('wire')})`}
              stroke={scr[2]}
              strokeWidth={0.15}
            />
          );
        })}
      </g>
    );
  } else if (cable.screen.form === 'corrugated' && g.Dit && g.Doc) {
    const n = 40;
    const tk = r(cable.screen.thickness_mm * 2);
    const rIn = r(g.Dit) + tk / 2;
    const rOut = r(g.Doc) - tk / 2;
    const pts: string[] = [];
    for (let i = 0; i <= n * 10; i++) {
      const a = (2 * Math.PI * i) / (n * 10);
      const rr = (rIn + rOut) / 2 + ((rOut - rIn) / 2) * Math.cos(n * a);
      pts.push(`${(rr * Math.cos(a)).toFixed(2)},${(rr * Math.sin(a)).toFixed(2)}`);
    }
    screen = (
      <polygon
        points={pts.join(' ')}
        fill="none"
        stroke={`url(#${id('sheath')})`}
        strokeWidth={Math.max(0.8, tk)}
        strokeLinejoin="round"
      />
    );
  } else {
    screen = <circle r={(rDs + rUnder) / 2} fill="none" stroke={`url(#${id('sheath')})`} strokeWidth={rDs - rUnder} />;
  }

  const angles = layers.map((_, i) => ((-64 + (128 * i) / Math.max(1, layers.length - 1)) * Math.PI) / 180);
  const rBalloon = 106;

  return (
    <svg
      xmlns={SVGNS}
      viewBox="-118 -118 236 236"
      role="img"
      aria-label={`Cross-section of ${cable.name}`}
      fontFamily={FONT}
    >
      <defs>
        <radialGradient id={id('cond')} cx="38%" cy="34%" r="72%">
          <stop offset="0%" stopColor={cond[0]} />
          <stop offset="55%" stopColor={cond[1]} />
          <stop offset="100%" stopColor={cond[2]} />
        </radialGradient>
        <radialGradient id={id('strand')} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor={cond[0]} />
          <stop offset="60%" stopColor={cond[1]} />
          <stop offset="100%" stopColor={cond[2]} />
        </radialGradient>
        <radialGradient id={id('sheen')} cx="35%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={0.22} />
          <stop offset="60%" stopColor="#ffffff" stopOpacity={0} />
          <stop offset="100%" stopColor="#000000" stopOpacity={0.18} />
        </radialGradient>
        <radialGradient id={id('wire')} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor={scr[0]} />
          <stop offset="60%" stopColor={scr[1]} />
          <stop offset="100%" stopColor={scr[2]} />
        </radialGradient>
        <linearGradient id={id('sheath')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={scr[0]} />
          <stop offset="50%" stopColor={scr[1]} />
          <stop offset="100%" stopColor={scr[2]} />
        </linearGradient>
        <radialGradient id={id('xlpe')} cx="42%" cy="38%" r="70%">
          <stop offset="0%" stopColor={pal.xlpe[0]} />
          <stop offset="100%" stopColor={pal.xlpe[1]} />
        </radialGradient>
        <radialGradient id={id('jacket')} cx="34%" cy="28%" r="80%">
          <stop offset="0%" stopColor={pal.jacket[0]} />
          <stop offset="100%" stopColor={pal.jacket[1]} />
        </radialGradient>
        <clipPath id={id('condclip')}>
          <circle r={r(g.dc)} />
        </clipPath>
      </defs>
      <circle r={r(Math.max(g.De, g.DeBuilt))} fill={`url(#${id('jacket')})`} stroke={pal.jacketEdge} strokeWidth={0.8} />
      <circle r={rUnder} fill={pal.tape} />
      {g.Dunder > g.Dis && (
        <circle
          r={(rUnder + r(g.Dis)) / 2}
          fill="none"
          stroke={pal.tapeLine}
          strokeWidth={rUnder - r(g.Dis)}
          strokeDasharray="1.4 0.9"
          opacity={0.7}
        />
      )}
      {screen}
      <circle r={r(g.Dis)} fill={pal.semicon} />
      <circle r={r(g.Di)} fill={`url(#${id('xlpe')})`} />
      <circle r={r(g.dcScreen)} fill={pal.semicon} />
      {conductor}
      {callouts &&
        layers.map((l, i) => {
          const a = angles[i];
          const rm = ((l.rIn + l.rOut) / 2) * k;
          const sx = rm * Math.cos(a);
          const sy = rm * Math.sin(a);
          const bx = rBalloon * Math.cos(a);
          const by = rBalloon * Math.sin(a);
          const ex = (rBalloon - 7) * Math.cos(a);
          const ey = (rBalloon - 7) * Math.sin(a);
          return (
            <g key={l.n}>
              <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={pal.halo} strokeWidth={1.8} strokeLinecap="round" />
              <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={pal.ink} strokeWidth={0.6} strokeLinecap="round" />
              <circle cx={sx} cy={sy} r={1.3} fill={pal.halo} stroke={pal.ink} strokeWidth={0.6} />
              <circle cx={bx} cy={by} r={7} fill={pal.panel} stroke={pal.ink} strokeWidth={0.7} />
              <text
                x={bx}
                y={by + 0.3}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={8}
                fontWeight={600}
                fill={pal.ink}
              >
                {l.n}
              </text>
            </g>
          );
        })}
    </svg>
  );
}

/** Cross-section with numbered callouts and the layer key. */
export function CableSection({ cable, result, pal }: { cable: CableSpec; result: RatingResult; pal: Palette }) {
  const idPrefix = cleanId(useId());
  const g = result.geometry;
  if (!geometryOk(g)) return <div className="drawing-empty">Complete the cable layers to see the cross-section.</div>;
  return (
    <figure className="drawing cable-drawing">
      <CableSectionSvg cable={cable} g={g} pal={pal} idPrefix={idPrefix} />
      <figcaption>
        <ol className="layer-key">
          {cableLayers(cable, g).map((l) => (
            <li key={l.n}>
              <span className="layer-n" aria-hidden="true">
                {l.n}
              </span>
              <span className="layer-name">{l.name}</span>
              <span className="layer-detail">{l.detail}</span>
            </li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------------------

interface Group {
  name: string;
  positions: { x: number; y: number }[];
  geo: CableGeometry;
  /** Outer diameter of cable or duct */
  D: number;
  hottest: number;
  metal: [string, string, string];
  cond: [string, string, string];
  temp: number;
  I: number;
  touching: boolean;
  formation: 'trefoil' | 'flat';
  spacing: number;
}

export interface Scene {
  groups: Group[];
  many: boolean;
  inDucts: boolean;
  bank: { x: number; y: number; w: number; h: number } | null;
  overview: Region;
  detail: Region;
  depth: number;
  heat: { tMin: number; tMax: number; levels: number[] } | null;
}

/** Layout of the installation drawing and the temperature scale, shared by the page and the report. */
export function buildScene(cable: CableSpec, inst: InstallationSpec, result: RatingResult, pal: Palette): Scene | null {
  const g = result.geometry;
  if (!result.ok || !result.positions.length || !geometryOk(g)) return null;
  const inDucts = inst.type === 'ducts' || inst.type === 'ductbank';
  const base = result.system?.circuits ?? [
    {
      name: 'C1',
      positions: result.positions,
      De: g.De,
      dc: g.dc,
      ductD: inDucts ? inst.duct.outerD_mm : undefined,
      hottest: result.thermal.t4.hottest,
      hottestTemp: result.temperatures.conductor,
      I: result.I,
    },
  ];
  const groups: Group[] = base.map((c, i) => {
    const spec = i === 0 ? null : inst.circuits[i - 1];
    const cab = spec?.cable ?? cable;
    return {
      name: c.name.replace(' (main)', ''),
      positions: c.positions,
      geo: i === 0 ? g : deriveGeometry(cab).geometry,
      D: c.ductD ?? c.De,
      hottest: c.hottest,
      metal: metalOf(pal, cab.screen.material),
      cond: metalOf(pal, cab.conductor.material),
      temp: c.hottestTemp,
      I: c.I,
      touching: spec ? spec.touching : inst.touching,
      formation: spec ? spec.formation : inst.formation,
      spacing: i === 0 ? result.spacing_mm : spec!.touching ? (c.ductD ?? c.De) : spec!.spacing_mm,
    };
  });
  const all = groups.flatMap((gr) => gr.positions.map((p) => ({ x: p.x, y: p.y, D: gr.D })));
  const minX = Math.min(...all.map((p) => p.x - p.D / 2));
  const maxX = Math.max(...all.map((p) => p.x + p.D / 2));
  const minY = Math.min(...all.map((p) => p.y - p.D / 2));
  const maxY = Math.max(...all.map((p) => p.y + p.D / 2));
  const maxD = Math.max(...all.map((p) => p.D));
  const bank =
    inst.type === 'ductbank'
      ? {
          x: (inst.bank.centreX_m ?? 0) * 1000,
          y: (inst.bank.centreDepth_m ?? inst.depth_m) * 1000,
          w: inst.bank.width_m * 1000,
          h: inst.bank.height_m * 1000,
        }
      : null;

  // Overview, to scale from the surface down
  const cx = (minX + maxX) / 2;
  let halfW = Math.max(((maxX - minX) / 2) * 1.7, maxY * 0.6, 350);
  if (bank) halfW = Math.max(halfW, Math.abs(bank.x - cx) + (bank.w / 2) * 1.3);
  const bottom = Math.max(maxY, bank ? bank.y + bank.h / 2 : 0) + Math.max(maxY * 0.35, 200);
  const overview: Region = { x0: cx - halfW, y0: -bottom * 0.1, x1: cx + halfW, y1: bottom };

  // Detail around the circuits (and the bank)
  let x0 = minX;
  let x1 = maxX;
  let y0 = minY;
  let y1 = maxY;
  if (bank) {
    x0 = Math.min(x0, bank.x - bank.w / 2);
    x1 = Math.max(x1, bank.x + bank.w / 2);
    y0 = Math.min(y0, bank.y - bank.h / 2);
    y1 = Math.max(y1, bank.y + bank.h / 2);
  }
  const pad = Math.max(maxD * 1.6, (x1 - x0) * 0.22, 120);
  x0 -= pad;
  x1 += pad;
  y0 -= pad;
  y1 += pad;
  if (x1 - x0 < (y1 - y0) * 1.5) {
    const e = ((y1 - y0) * 1.5 - (x1 - x0)) / 2;
    x0 -= e;
    x1 += e;
  }
  const detail: Region = { x0, y0, x1, y1 };

  let heat: Scene['heat'] = null;
  if (result.field) {
    const probe = sampleField(result.field, { ...detail, y0: Math.max(0, detail.y0) }, 120, 80);
    const fmax = gridMax(probe);
    const tMin = result.field.thetaA;
    if (Number.isFinite(fmax) && fmax > tMin + 0.5) {
      const step = niceStep(fmax - tMin, 7);
      const tMax = Math.ceil(fmax / step) * step;
      heat = { tMin, tMax, levels: isoLevels(tMin, tMax) };
    }
  }
  return {
    groups,
    many: groups.length > 1,
    inDucts,
    bank,
    overview,
    detail,
    depth: inst.depth_m * 1000,
    heat,
  };
}

/** Heat overlays for both views (needs a browser canvas). */
export function sceneHeat(scene: Scene, result: RatingResult, pal: Palette) {
  if (!scene.heat || !result.field) return { overview: null, detail: null };
  const { tMin, tMax, levels } = scene.heat;
  const ov = scene.overview;
  return {
    overview: heatLayer(result.field, { ...ov, y0: 0 }, 240, tMin, tMax, levels, pal.heat),
    detail: heatLayer(result.field, scene.detail, 280, tMin, tMax, levels, pal.heat),
  };
}

const GRAINS = [
  [0.12, 0.18, 0.05],
  [0.42, 0.08, 0.035],
  [0.71, 0.27, 0.045],
  [0.27, 0.52, 0.03],
  [0.58, 0.61, 0.05],
  [0.88, 0.73, 0.035],
  [0.08, 0.83, 0.04],
  [0.4, 0.91, 0.03],
  [0.83, 0.43, 0.03],
];

function GroundDefs({ id, pal, tile }: { id: (s: string) => string; pal: Palette; tile: number }) {
  return (
    <>
      <pattern id={id('grain')} width={tile} height={tile} patternUnits="userSpaceOnUse">
        {GRAINS.map(([x, y, rr], i) => (
          <circle key={i} cx={x * tile} cy={y * tile} r={rr * tile} fill={pal.soilGrain} />
        ))}
      </pattern>
      <pattern id={id('aggregate')} width={tile * 0.8} height={tile * 0.8} patternUnits="userSpaceOnUse">
        {GRAINS.map(([x, y, rr], i) => (
          <circle key={i} cx={y * tile * 0.8} cy={x * tile * 0.8} r={rr * tile * 0.7} fill={pal.aggregate} />
        ))}
      </pattern>
      <linearGradient id={id('sky')} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={pal.sky[0]} />
        <stop offset="100%" stopColor={pal.sky[1]} />
      </linearGradient>
      <radialGradient id={id('gjacket')} cx="34%" cy="28%" r="80%">
        <stop offset="0%" stopColor={pal.jacket[0]} />
        <stop offset="100%" stopColor={pal.jacket[1]} />
      </radialGradient>
      <marker id={id('arrow')} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 1 L10 5 L0 9 z" fill={pal.ink2} />
      </marker>
    </>
  );
}

function CableGlyph({
  x,
  y,
  geo,
  metal,
  cond,
  hot,
  sw,
  pal,
  id,
}: {
  x: number;
  y: number;
  geo: CableGeometry;
  metal: [string, string, string];
  cond: [string, string, string];
  hot: boolean;
  sw: number;
  pal: Palette;
  id: (s: string) => string;
}) {
  const g = geo;
  const De = Math.max(g.De, g.DeBuilt);
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        r={De / 2}
        fill={`url(#${id('gjacket')})`}
        stroke={hot ? pal.accent : pal.jacketEdge}
        strokeWidth={hot ? sw * 3 : sw * 0.8}
      />
      <circle cx={x} cy={y} r={(g.Ds + g.Dunder) / 4} fill="none" stroke={metal[1]} strokeWidth={Math.max(sw, (g.Ds - g.Dunder) / 2)} />
      <circle cx={x} cy={y} r={g.Dis / 2} fill={pal.semicon} />
      <circle cx={x} cy={y} r={g.Di / 2} fill={pal.xlpe[0]} />
      <circle cx={x} cy={y} r={g.dc / 2} fill={cond[1]} stroke={cond[2]} strokeWidth={sw * 0.6} />
      <circle cx={x - g.dc * 0.12} cy={y - g.dc * 0.14} r={g.dc * 0.22} fill={cond[0]} opacity={0.55} />
    </g>
  );
}

function Ground({
  region,
  pal,
  id,
  tile,
  topsoil,
}: {
  region: Region;
  pal: Palette;
  id: (s: string) => string;
  tile: number;
  topsoil: number;
}) {
  const w = region.x1 - region.x0;
  const top = Math.max(0, region.y0);
  const grass = Math.max((region.y1 - region.y0) * 0.012, tile * 0.08);
  return (
    <g>
      {region.y0 < 0 && <rect x={region.x0} y={region.y0} width={w} height={-region.y0} fill={`url(#${id('sky')})`} />}
      <rect x={region.x0} y={top} width={w} height={region.y1 - top} fill={pal.soil} />
      <rect x={region.x0} y={top} width={w} height={region.y1 - top} fill={`url(#${id('grain')})`} opacity={0.8} />
      {top < topsoil && <rect x={region.x0} y={top} width={w} height={topsoil - top} fill={pal.topsoil} opacity={0.35} />}
      {region.y0 < 0 && <rect x={region.x0} y={-grass} width={w} height={grass * 1.4} fill={pal.grass} />}
    </g>
  );
}

function BankShape({ scene, pal, id, sw, fill }: { scene: Scene; pal: Palette; id: (s: string) => string; sw: number; fill: boolean }) {
  const b = scene.bank;
  if (!b) return null;
  const x = b.x - b.w / 2;
  const y = b.y - b.h / 2;
  return fill ? (
    <g>
      <rect x={x} y={y} width={b.w} height={b.h} fill={pal.concrete} />
      <rect x={x} y={y} width={b.w} height={b.h} fill={`url(#${id('aggregate')})`} />
    </g>
  ) : (
    <rect x={x} y={y} width={b.w} height={b.h} fill="none" stroke={pal.ink3} strokeWidth={sw} />
  );
}

function HeatOverlay({
  layer,
  pal,
  fs,
  labels,
  sw,
}: {
  layer: HeatLayer | null;
  pal: Palette;
  fs: number;
  labels: boolean;
  sw: number;
}) {
  if (!layer) return null;
  const r = layer.region;
  return (
    <g>
      {layer.href && (
        <image href={layer.href} x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} preserveAspectRatio="none" />
      )}
      {layer.isotherms.map((iso) => (
        <path key={iso.level} d={iso.d} fill="none" stroke={pal.isotherm} strokeWidth={sw} opacity={0.55} />
      ))}
      {labels &&
        layer.isotherms.map((iso) =>
          iso.label ? (
            <text
              key={`l${iso.level}`}
              x={iso.label[0]}
              y={iso.label[1]}
              fontSize={fs}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={pal.ink}
              stroke={pal.halo}
              strokeWidth={fs * 0.28}
              paintOrder="stroke"
            >
              {fmt(iso.level, iso.level % 1 ? 1 : 0)}°
            </text>
          ) : null,
        )}
    </g>
  );
}

function CircuitShapes({
  scene,
  pal,
  id,
  sw,
  inst,
  detailed,
}: {
  scene: Scene;
  pal: Palette;
  id: (s: string) => string;
  sw: number;
  inst: InstallationSpec;
  detailed: boolean;
}) {
  return (
    <g>
      {scene.groups.map((gr, gi) =>
        gr.positions.map((p, i) => (
          <g key={`${gi}-${i}`}>
            {scene.inDucts && (
              <>
                <circle cx={p.x} cy={p.y} r={inst.duct.outerD_mm / 2} fill={pal.duct} stroke={pal.ductEdge} strokeWidth={sw * 0.6} />
                <circle cx={p.x} cy={p.y} r={inst.duct.innerD_mm / 2} fill={pal.air} />
              </>
            )}
            {detailed ? (
              <CableGlyph
                x={p.x}
                y={p.y}
                geo={gr.geo}
                metal={gr.metal}
                cond={gr.cond}
                hot={gi === 0 && i === gr.hottest}
                sw={sw}
                pal={pal}
                id={id}
              />
            ) : (
              <circle cx={p.x} cy={p.y} r={Math.max(gr.geo.De, gr.geo.DeBuilt) / 2} fill={pal.jacket[1]} />
            )}
          </g>
        )),
      )}
    </g>
  );
}

export function InstallationOverviewSvg({
  scene,
  heat,
  pal,
  idPrefix,
  inst,
}: {
  scene: Scene;
  heat: HeatLayer | null;
  pal: Palette;
  idPrefix: string;
  inst: InstallationSpec;
}) {
  const id = (s: string) => `${idPrefix}-${s}`;
  const r = scene.overview;
  const w = r.x1 - r.x0;
  const sw = w / 400;
  const fs = w / 17;
  const dimX = r.x0 + w * 0.09;
  const d = scene.detail;
  const fx0 = Math.max(r.x0, d.x0);
  const fy0 = Math.max(r.y0, d.y0);
  return (
    <svg
      xmlns={SVGNS}
      viewBox={`${r.x0} ${r.y0} ${w} ${r.y1 - r.y0}`}
      role="img"
      aria-label="Installation overview, to scale"
      fontFamily={FONT}
    >
      <defs>
        <GroundDefs id={id} pal={pal} tile={w / 14} />
      </defs>
      <Ground region={r} pal={pal} id={id} tile={w / 14} topsoil={Math.min(300, scene.depth * 0.3)} />
      <BankShape scene={scene} pal={pal} id={id} sw={sw} fill />
      <HeatOverlay layer={heat} pal={pal} fs={fs} labels={false} sw={sw * 0.8} />
      <BankShape scene={scene} pal={pal} id={id} sw={sw} fill={false} />
      <CircuitShapes scene={scene} pal={pal} id={id} sw={sw} inst={inst} detailed={false} />
      <rect
        x={fx0}
        y={fy0}
        width={Math.min(r.x1, d.x1) - fx0}
        height={Math.min(r.y1, d.y1) - fy0}
        fill="none"
        stroke={pal.accent}
        strokeWidth={sw * 1.4}
        strokeDasharray={`${sw * 6} ${sw * 4}`}
      />
      <line
        x1={dimX}
        y1={0}
        x2={dimX}
        y2={scene.depth}
        stroke={pal.ink2}
        strokeWidth={sw * 1.2}
        markerStart={`url(#${id('arrow')})`}
        markerEnd={`url(#${id('arrow')})`}
      />
      <line
        x1={dimX}
        y1={scene.depth}
        x2={fx0}
        y2={scene.depth}
        stroke={pal.ink2}
        strokeWidth={sw}
        strokeDasharray={`${sw * 4} ${sw * 4}`}
      />
      <text
        x={dimX + fs * 0.4}
        y={scene.depth / 2}
        fontSize={fs}
        fill={pal.ink}
        stroke={pal.halo}
        strokeWidth={fs * 0.22}
        paintOrder="stroke"
        dominantBaseline="middle"
      >
        L = {fmt(scene.depth / 1000, 2)} m
      </text>
    </svg>
  );
}

export function InstallationDetailSvg({
  scene,
  heat,
  pal,
  idPrefix,
  inst,
}: {
  scene: Scene;
  heat: HeatLayer | null;
  pal: Palette;
  idPrefix: string;
  inst: InstallationSpec;
}) {
  const id = (s: string) => `${idPrefix}-${s}`;
  const r = scene.detail;
  const w = r.x1 - r.x0;
  const sw = w / 500;
  const fs = w / 30;
  const main = scene.groups[0];
  const halo = { stroke: pal.halo, strokeWidth: fs * 0.24, paintOrder: 'stroke' as const };
  let spacingDim: React.ReactNode = null;
  if (!main.touching && main.formation === 'flat') {
    const a = main.positions[0];
    const b = main.positions[1];
    // Above the cables for one circuit (phase labels sit below), below them when circuit names sit above
    const below = scene.many;
    const yy = below
      ? Math.max(...main.positions.map((p) => p.y)) + main.D / 2 + fs * 1.2
      : Math.min(...main.positions.map((p) => p.y)) - main.D / 2 - fs * 1.6;
    const edge = below ? main.D / 2 : -main.D / 2;
    const over = below ? fs * 0.3 : -fs * 0.3;
    spacingDim = (
      <g>
        <line x1={a.x} y1={a.y + edge} x2={a.x} y2={yy + over} stroke={pal.ink3} strokeWidth={sw * 0.8} />
        <line x1={b.x} y1={b.y + edge} x2={b.x} y2={yy + over} stroke={pal.ink3} strokeWidth={sw * 0.8} />
        <line
          x1={a.x}
          y1={yy}
          x2={b.x}
          y2={yy}
          stroke={pal.ink2}
          strokeWidth={sw * 1.2}
          markerStart={`url(#${id('arrow')})`}
          markerEnd={`url(#${id('arrow')})`}
        />
        <text x={(a.x + b.x) / 2} y={below ? yy + fs * 1.1 : yy - fs * 0.45} fontSize={fs * 0.85} textAnchor="middle" fill={pal.ink} {...halo}>
          s = {fmt(main.spacing, 0)} mm
        </text>
      </g>
    );
  }
  return (
    <svg
      xmlns={SVGNS}
      viewBox={`${r.x0} ${r.y0} ${w} ${r.y1 - r.y0}`}
      role="img"
      aria-label="Detail of the circuits with the ground temperature field"
      fontFamily={FONT}
    >
      <defs>
        <GroundDefs id={id} pal={pal} tile={w / 9} />
      </defs>
      <Ground region={r} pal={pal} id={id} tile={w / 9} topsoil={Math.min(300, scene.depth * 0.3)} />
      <BankShape scene={scene} pal={pal} id={id} sw={sw} fill />
      <HeatOverlay layer={heat} pal={pal} fs={fs * 0.85} labels sw={sw} />
      <BankShape scene={scene} pal={pal} id={id} sw={sw * 1.2} fill={false} />
      <CircuitShapes scene={scene} pal={pal} id={id} sw={sw} inst={inst} detailed />
      {scene.many ? (
        scene.groups.map((gr, gi) => {
          const gx = gr.positions.reduce((a, p) => a + p.x, 0) / 3;
          const gTop = Math.min(...gr.positions.map((p) => p.y)) - gr.D / 2;
          return (
            <text
              key={gi}
              x={gx}
              y={gTop - fs * 0.9}
              fontSize={fs}
              textAnchor="middle"
              fontWeight={600}
              fill={gi === 0 ? pal.accent : pal.ink}
              {...halo}
            >
              {gr.name} · {fmt(gr.temp, 1)} °C
            </text>
          );
        })
      ) : (
        <text x={r.x0 + fs * 0.7} y={r.y0 + fs * 1.5} fontSize={fs} fontWeight={600} fill={pal.accent} {...halo}>
          Hottest conductor {fmt(main.temp, 1)} °C
        </text>
      )}
      {!scene.many &&
        main.positions.map((p, i) => {
          const gx = main.positions.reduce((a, q) => a + q.x, 0) / 3;
          const gy = main.positions.reduce((a, q) => a + q.y, 0) / 3;
          let ux = p.x - gx;
          let uy = p.y - gy;
          const len = Math.hypot(ux, uy);
          if (len < 1e-6) {
            ux = 0;
            uy = 1;
          } else {
            ux /= len;
            uy /= len;
          }
          const lr = main.D / 2 + fs * 0.9;
          return (
            <text
              key={i}
              x={p.x + ux * lr}
              y={p.y + uy * lr}
              fontSize={fs * 0.85}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={pal.ink}
              {...halo}
            >
              {['L1', 'L2', 'L3'][i]}
            </text>
          );
        })}
      {spacingDim}
    </svg>
  );
}

export function AirSvg({
  cable,
  inst,
  result,
  pal,
  idPrefix,
}: {
  cable: CableSpec;
  inst: InstallationSpec;
  result: RatingResult;
  pal: Palette;
  idPrefix: string;
}) {
  const id = (s: string) => `${idPrefix}-${s}`;
  const g = result.geometry;
  const s = result.spacing_mm;
  const vertical = inst.air.arrangement === 'flat-vertical' || inst.air.arrangement === 'flat-vertical-spaced';
  const pts = vertical ? [-s, 0, s].map((y) => ({ x: 0, y })) : result.positions.map((p) => ({ x: p.x, y: p.y }));
  const span = Math.max(s * 2 + g.De, g.De * 4);
  const fs = span / 13;
  const sw = span / 300;
  const metal = metalOf(pal, cable.screen.material);
  const cond = metalOf(pal, cable.conductor.material);
  const sun = { x: span * 0.72, y: -span * 0.5 };
  return (
    <svg
      xmlns={SVGNS}
      viewBox={`${-span} ${-span * 0.75} ${span * 2} ${span * 1.5}`}
      role="img"
      aria-label="Cables in free air"
      fontFamily={FONT}
    >
      <defs>
        <GroundDefs id={id} pal={pal} tile={span / 6} />
      </defs>
      <rect x={-span} y={-span * 0.75} width={span * 2} height={span * 1.5} fill={`url(#${id('sky')})`} />
      {inst.air.solar && (
        <g>
          <circle cx={sun.x} cy={sun.y} r={span * 0.08} fill={pal.heat[2]} />
          {Array.from({ length: 10 }, (_, i) => {
            const a = (2 * Math.PI * i) / 10;
            return (
              <line
                key={i}
                x1={sun.x + Math.cos(a) * span * 0.11}
                y1={sun.y + Math.sin(a) * span * 0.11}
                x2={sun.x + Math.cos(a) * span * 0.16}
                y2={sun.y + Math.sin(a) * span * 0.16}
                stroke={pal.heat[2]}
                strokeWidth={sw * 2.2}
                strokeLinecap="round"
              />
            );
          })}
        </g>
      )}
      {pts.map((p, i) => (
        <CableGlyph key={i} x={p.x} y={p.y} geo={g} metal={metal} cond={cond} hot={false} sw={sw} pal={pal} id={id} />
      ))}
      <text x={0} y={span * 0.62} fontSize={fs * 0.8} textAnchor="middle" fill={pal.ink2}>
        Conductor {fmt(result.temperatures.conductor, 1)} °C · surface {fmt(result.temperatures.surface, 1)} °C
      </text>
    </svg>
  );
}

/** Colour of the heat scale at t, blended over the soil colour as it appears on the drawing. */
export function heatScaleColor(pal: Palette, t: number): string {
  const ramp = makeRamp(pal.heat);
  const [r, g, b] = ramp(t);
  const a = heatAlpha(t);
  const soil = [1, 3, 5].map((i) => parseInt(pal.soil.slice(i, i + 2), 16));
  const rgb = [r, g, b];
  return rgbHex([0, 1, 2].map((k) => Math.round(a * rgb[k] + (1 - a) * soil[k])) as [number, number, number]);
}

function HeatLegend({ scene, pal }: { scene: Scene; pal: Palette }) {
  if (!scene.heat) return null;
  const { tMin, tMax, levels } = scene.heat;
  const stops = Array.from({ length: 11 }, (_, i) => `${heatScaleColor(pal, i / 10)} ${i * 10}%`).join(', ');
  const ticks = [tMin, ...levels, tMax];
  return (
    <div className="heat-legend">
      <span className="heat-legend-title">Ground temperature at the rated current, °C</span>
      <div className="heat-bar" style={{ background: `linear-gradient(90deg, ${stops})` }} aria-hidden="true" />
      <div className="heat-ticks" aria-hidden="true">
        {ticks.map((t, i) => (
          <span key={i} style={{ left: `${((t - tMin) / (tMax - tMin)) * 100}%` }}>
            {fmt(t, t % 1 ? 1 : 0)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Installation with the ground temperature field: overview to scale plus a detail of the circuits. */
export function InstallationView({
  cable,
  inst,
  result,
  pal,
}: {
  cable: CableSpec;
  inst: InstallationSpec;
  result: RatingResult;
  pal: Palette;
}) {
  const idPrefix = cleanId(useId());
  const scene = useMemo(
    () => (inst.type === 'air' ? null : buildScene(cable, inst, result, pal)),
    [cable, inst, result, pal],
  );
  const heat = useMemo(
    () => (scene ? sceneHeat(scene, result, pal) : { overview: null, detail: null }),
    [scene, result, pal],
  );

  if (inst.type === 'air') {
    if (!result.ok) return <div className="drawing-empty">Complete the installation to see the layout.</div>;
    return (
      <figure className="drawing">
        <AirSvg cable={cable} inst={inst} result={result} pal={pal} idPrefix={idPrefix} />
        <figcaption className="drawing-caption">
          {AIR_CONSTANTS[inst.air.arrangement].label} · spacing {fmt(result.spacing_mm, 0)} mm
          {inst.air.solar ? ` · sun ${fmt(inst.air.H, 0)} W/m²` : ' · shaded'}
        </figcaption>
      </figure>
    );
  }
  if (!scene) return <div className="drawing-empty">Complete the installation to see the layout.</div>;
  return (
    <figure className="drawing">
      <div className="inst-views">
        <InstallationOverviewSvg scene={scene} heat={heat.overview} pal={pal} idPrefix={`${idPrefix}o`} inst={inst} />
        <InstallationDetailSvg scene={scene} heat={heat.detail} pal={pal} idPrefix={`${idPrefix}d`} inst={inst} />
      </div>
      <HeatLegend scene={scene} pal={pal} />
      <figcaption className="drawing-caption">
        <span className="swatch swatch-ring" aria-hidden="true" /> Hottest position of the main circuit · soil{' '}
        {fmt(inst.soilRho, 2)} K·m/W
        {scene.bank ? ` · concrete ${fmt(inst.bank.concreteRho, 2)} K·m/W` : ''}
        {scene.many ? ` · ${scene.groups.length} circuits` : ''} · temperature field by superposition, for illustration
      </figcaption>
    </figure>
  );
}
