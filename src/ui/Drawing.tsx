import React from 'react';
import { deriveGeometry, type CableGeometry, type CableSpec, type InstallationSpec, type RatingResult } from '../engine';
import { fmt } from './format';

const metalVar: Record<string, string> = {
  Cu: 'var(--m-cu)',
  Al: 'var(--m-al)',
  Pb: 'var(--m-pb)',
  steel: 'var(--m-steel)',
  bronze: 'var(--m-cu)',
  stainless: 'var(--m-steel)',
};

/** Cross-section of the cable, to scale. */
export function CableSection({ cable, result }: { cable: CableSpec; result: RatingResult }) {
  const g = result.geometry;
  const ok = [g.dc, g.Di, g.Dunder, g.Ds, g.De].every((v) => Number.isFinite(v) && v > 0);
  if (!ok) return <div className="drawing-empty">Complete the cable layers to see the cross-section.</div>;
  const R = Math.max(g.De, g.DeBuilt) / 2;
  const k = 92 / R;
  const r = (d: number) => (d / 2) * k;
  const wires: React.ReactNode[] = [];
  const cond = metalVar[cable.conductor.material];
  const scr = metalVar[cable.screen.material];

  let screenShape: React.ReactNode;
  if (cable.screen.form === 'wires') {
    const t = cable.screen.thickness_mm;
    const count = Math.max(
      6,
      Math.min(160, Math.round(cable.screen.wireCount ?? g.As / ((Math.PI * t * t) / 4)) || 40),
    );
    const rc = r(g.dMean);
    const rw = Math.max(0.6, r(t));
    for (let i = 0; i < count; i++) {
      const a = (2 * Math.PI * i) / count;
      wires.push(<circle key={i} cx={rc * Math.cos(a)} cy={rc * Math.sin(a)} r={rw} fill={scr} />);
    }
    screenShape = <g>{wires}</g>;
  } else if (cable.screen.form === 'corrugated' && g.Dit && g.Doc) {
    const n = 36;
    const pts: string[] = [];
    const rIn = r(g.Dit) + r(cable.screen.thickness_mm * 2) / 2;
    const rOut = r(g.Doc) - r(cable.screen.thickness_mm * 2) / 2;
    for (let i = 0; i <= n * 8; i++) {
      const a = (2 * Math.PI * i) / (n * 8);
      const rr = (rIn + rOut) / 2 + ((rOut - rIn) / 2) * Math.cos(n * a);
      pts.push(`${(rr * Math.cos(a)).toFixed(2)},${(rr * Math.sin(a)).toFixed(2)}`);
    }
    screenShape = (
      <polygon
        points={pts.join(' ')}
        fill="none"
        stroke={scr}
        strokeWidth={Math.max(1, r(cable.screen.thickness_mm * 2))}
        strokeLinejoin="round"
      />
    );
  } else {
    screenShape = <circle r={(r(g.Ds) + r(g.Dunder)) / 2} fill="none" stroke={scr} strokeWidth={r(g.Ds) - r(g.Dunder)} />;
  }

  const segLines =
    cable.conductor.construction === 'milliken'
      ? [0, 1, 2, 3, 4, 5].map((i) => {
          const a = (Math.PI * i) / 3;
          return (
            <line
              key={i}
              x1={0}
              y1={0}
              x2={r(g.dc) * Math.cos(a)}
              y2={r(g.dc) * Math.sin(a)}
              stroke="var(--m-seg)"
              strokeWidth={1}
            />
          );
        })
      : null;

  const layers = [
    { name: 'Oversheath', d: g.De, swatch: 'var(--m-jacket)' },
    {
      name: cable.screen.form === 'wires' ? 'Wire screen' : 'Metallic sheath',
      d: g.Ds,
      swatch: scr,
    },
    { name: 'Insulation', d: g.Di, swatch: 'var(--m-xlpe)' },
    { name: 'Conductor', d: g.dc, swatch: cond },
  ];

  return (
    <figure className="drawing">
      <svg viewBox="-100 -100 200 200" role="img" aria-label={`Cross-section of ${cable.name}`}>
        <circle r={r(g.De)} fill="var(--m-jacket)" stroke="var(--m-edge)" strokeWidth={0.8} />
        <circle r={cable.screen.form === 'corrugated' && g.Doc ? r(g.Doc) : r(g.Ds)} fill="var(--m-tape)" />
        <circle r={r(g.Dunder)} fill="var(--m-tape)" />
        {screenShape}
        <circle r={r(g.Dis)} fill="var(--m-semicon)" />
        <circle r={r(g.Di)} fill="var(--m-xlpe)" />
        <circle r={r(g.dcScreen)} fill="var(--m-semicon)" />
        <circle r={r(g.dc)} fill={cond} />
        {segLines}
      </svg>
      <figcaption>
        <ul className="layer-key">
          {layers.map((l) => (
            <li key={l.name}>
              <span className="swatch" style={{ background: l.swatch }} aria-hidden="true" />
              <span>{l.name}</span>
              <span className="num">⌀ {fmt(l.d, 1)}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

/** The circuit in its surroundings, to scale. */
export function InstallationView({
  cable,
  inst,
  result,
}: {
  cable: CableSpec;
  inst: InstallationSpec;
  result: RatingResult;
}) {
  const g = result.geometry;
  const pos = result.positions;
  if (!pos.length || !Number.isFinite(g.De) || !Number.isFinite(result.spacing_mm))
    return <div className="drawing-empty">Complete the installation to see the layout.</div>;
  const inDucts = inst.type === 'ducts' || inst.type === 'ductbank';
  const hottest = result.thermal.t4.hottest;
  const label = (i: number) => ['L1', 'L2', 'L3'][i];
  const metal = metalVar[cable.screen.material];
  const cond = metalVar[cable.conductor.material];

  if (inst.type === 'air') {
    const vertical = inst.air.arrangement === 'flat-vertical' || inst.air.arrangement === 'flat-vertical-spaced';
    const s = result.spacing_mm;
    const pts = vertical
      ? [-s, 0, s].map((y) => ({ x: 0, y }))
      : pos.map((p) => ({ x: p.x, y: p.y }));
    const span = Math.max(s * 2 + g.De, g.De * 4);
    const vb = `${-span} ${-span * 0.75} ${span * 2} ${span * 1.5}`;
    return (
      <figure className="drawing">
        <svg viewBox={vb} role="img" aria-label="Cables in free air">
          <rect x={-span} y={-span * 0.75} width={span * 2} height={span * 1.5} fill="var(--m-air)" />
          {pts.map((p, i) => (
            <CableGlyph key={i} x={p.x} y={p.y} geo={g} metal={metal} cond={cond} hot={false} sw={span / 300} />
          ))}
          {inst.air.solar && (
            <g stroke="var(--warn)" strokeWidth={span / 120} strokeLinecap="round">
              {[-0.6, -0.2, 0.2, 0.6].map((f) => (
                <line key={f} x1={span * f} y1={-span * 0.7} x2={span * f - span * 0.08} y2={-span * 0.5} />
              ))}
            </g>
          )}
        </svg>
        <figcaption className="drawing-caption">
          Free air, ambient {fmt(inst.ambient_C, 0)} °C · spacing {fmt(result.spacing_mm, 0)} mm
          {inst.air.solar ? ` · sun ${fmt(inst.air.H, 0)} W/m²` : ''}
        </figcaption>
      </figure>
    );
  }

  // Groups to draw: the main circuit plus any other circuits.
  const groups = (
    result.system?.circuits ?? [
      { name: 'C1', positions: pos, De: g.De, dc: g.dc, ductD: inDucts ? inst.duct.outerD_mm : undefined, hottest },
    ]
  ).map((c, i) => {
    const cab = i === 0 ? cable : (inst.circuits[i - 1]?.cable ?? cable);
    const geo = i === 0 ? g : deriveGeometry(cab).geometry;
    return {
      name: c.name,
      positions: c.positions,
      geo,
      D: c.ductD ?? c.De,
      hottest: c.hottest,
      metal: metalVar[cab.screen.material],
      cond: metalVar[cab.conductor.material],
    };
  });
  const many = groups.length > 1;
  const all = groups.flatMap((gr) => gr.positions.map((p) => ({ x: p.x, y: p.y, D: gr.D })));
  const minX = Math.min(...all.map((p) => p.x - p.D / 2));
  const maxX = Math.max(...all.map((p) => p.x + p.D / 2));
  const minY = Math.min(...all.map((p) => p.y - p.D / 2));
  const maxY = Math.max(...all.map((p) => p.y + p.D / 2));
  const maxD = Math.max(...all.map((p) => p.D));
  const depth = inst.depth_m * 1000;
  const isBank = inst.type === 'ductbank';
  const bankW = inst.bank.width_m * 1000;
  const bankH = inst.bank.height_m * 1000;
  const bankX = (inst.bank.centreX_m ?? 0) * 1000;
  const bankD = (inst.bank.centreDepth_m ?? inst.depth_m) * 1000;
  const cx = (minX + maxX) / 2;
  let halfW = Math.max(((maxX - minX) / 2) * 1.7, maxY * 0.55, 300);
  if (isBank) halfW = Math.max(halfW, Math.abs(bankX - cx) + (bankW / 2) * 1.25);
  const bankRect = (sw: number) =>
    isBank ? (
      <rect
        x={bankX - bankW / 2}
        y={bankD - bankH / 2}
        width={bankW}
        height={bankH}
        fill="var(--m-concrete)"
        stroke="var(--m-edge)"
        strokeWidth={sw}
      />
    ) : null;
  const bottom = Math.max(maxY, isBank ? bankD + bankH / 2 : 0) + maxY * 0.25;
  const top = -bottom * 0.08;
  const vb = `${cx - halfW} ${top} ${halfW * 2} ${bottom - top}`;
  const sw = halfW / 250;
  const dimX = cx - halfW * 0.82;
  const mainMinX = Math.min(...groups[0].positions.map((p) => p.x)) - groups[0].D / 2;

  // Detail view around all groups
  let margin = maxD * 0.5 + maxD * 0.5;
  let dx0 = minX - margin;
  let dx1 = maxX + margin;
  const fs = Math.max(maxD * 0.3, (dx1 - dx0) / 24);
  margin = maxD * 0.3 + fs * 1.8;
  dx0 = minX - margin;
  dx1 = maxX + margin;
  const dy0 = minY - margin;
  const dy1 = maxY + margin;
  if (dx1 - dx0 < (dy1 - dy0) * 1.4) {
    const extra = ((dy1 - dy0) * 1.4 - (dx1 - dx0)) / 2;
    dx0 -= extra;
    dx1 += extra;
  }
  const dsw = Math.max(maxD / 60, (dx1 - dx0) / 600);

  return (
    <figure className="drawing">
      <div className="inst-views">
        <svg viewBox={vb} role="img" aria-label="Installation overview, to scale">
          <rect x={cx - halfW} y={top} width={halfW * 2} height={-top} fill="var(--m-air)" />
          <rect x={cx - halfW} y={0} width={halfW * 2} height={bottom} fill="var(--m-soil)" />
          <line x1={cx - halfW} y1={0} x2={cx + halfW} y2={0} stroke="var(--ink-2)" strokeWidth={sw * 1.5} />
          {bankRect(sw)}
          {all.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={p.D / 2} fill={inDucts ? 'var(--m-duct)' : 'var(--m-jacket)'} />
          ))}
          <rect
            x={dx0}
            y={dy0}
            width={dx1 - dx0}
            height={dy1 - dy0}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={sw}
            strokeDasharray={`${sw * 4} ${sw * 3}`}
          />
          <g stroke="var(--ink-2)" strokeWidth={sw} fill="none">
            <line x1={dimX} y1={0} x2={dimX} y2={depth} />
            <line x1={dimX - sw * 6} y1={depth} x2={dimX + sw * 6} y2={depth} />
            <line x1={dimX} y1={depth} x2={Math.min(dx0, mainMinX)} y2={depth} strokeDasharray={`${sw * 4} ${sw * 4}`} />
          </g>
          <text x={dimX + sw * 8} y={depth / 2} className="svg-label" fontSize={halfW / 12} fill="var(--ink)">
            L = {fmt(inst.depth_m, 2)} m
          </text>
        </svg>
        <svg viewBox={`${dx0} ${dy0} ${dx1 - dx0} ${dy1 - dy0}`} role="img" aria-label="Detail of the cable groups">
          <rect x={dx0} y={dy0} width={dx1 - dx0} height={dy1 - dy0} fill="var(--m-soil)" />
          {bankRect(dsw)}
          {groups.map((gr, gi) => {
            const gx = gr.positions.reduce((a, p) => a + p.x, 0) / 3;
            const gy = gr.positions.reduce((a, p) => a + p.y, 0) / 3;
            const gTop = Math.min(...gr.positions.map((p) => p.y)) - gr.D / 2;
            return (
              <g key={gi}>
                {gr.positions.map((p, i) => {
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
                  const lr = gr.D / 2 + fs * 0.9;
                  return (
                    <g key={i}>
                      {inDucts && (
                        <>
                          <circle cx={p.x} cy={p.y} r={inst.duct.outerD_mm / 2} fill="var(--m-duct)" />
                          <circle cx={p.x} cy={p.y} r={inst.duct.innerD_mm / 2} fill="var(--m-air)" />
                        </>
                      )}
                      <CableGlyph
                        x={p.x}
                        y={p.y}
                        geo={gr.geo}
                        metal={gr.metal}
                        cond={gr.cond}
                        hot={gi === 0 && i === hottest}
                        sw={dsw}
                      />
                      {!many && (
                        <text
                          x={p.x + ux * lr}
                          y={p.y + uy * lr}
                          fontSize={fs}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          className="svg-label"
                          fill="var(--ink)"
                        >
                          {label(i)}
                        </text>
                      )}
                    </g>
                  );
                })}
                {many && (
                  <text
                    x={gx}
                    y={gTop - fs * 0.7}
                    fontSize={fs}
                    textAnchor="middle"
                    className="svg-label"
                    fill={gi === 0 ? 'var(--accent)' : 'var(--ink)'}
                    fontWeight={600}
                  >
                    {gr.name.replace(' (main)', '')}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="drawing-caption">
        <span className="swatch swatch-ring" aria-hidden="true" /> Hottest position of the main circuit
        {many ? '' : ` (${label(hottest)})`} · axial spacing {fmt(result.spacing_mm, 0)} mm · soil{' '}
        {fmt(inst.soilRho, 2)} K·m/W
        {isBank ? ` · concrete ${fmt(inst.bank.concreteRho, 2)} K·m/W` : ''}
        {many ? ` · ${groups.length} circuits` : ''}
      </figcaption>
    </figure>
  );
}

/** One cable drawn with its main layers. */
function CableGlyph({
  x,
  y,
  geo,
  metal,
  cond,
  hot,
  sw,
}: {
  x: number;
  y: number;
  geo: CableGeometry;
  metal: string;
  cond: string;
  hot: boolean;
  sw: number;
}) {
  const g = geo;
  return (
    <g>
      <circle cx={x} cy={y} r={g.De / 2} fill="var(--m-jacket)" stroke={hot ? 'var(--accent)' : 'none'} strokeWidth={sw * 3} />
      <circle cx={x} cy={y} r={(g.Ds + g.Dunder) / 4} fill="none" stroke={metal} strokeWidth={Math.max(sw, (g.Ds - g.Dunder) / 2)} />
      <circle cx={x} cy={y} r={g.Di / 2} fill="var(--m-xlpe)" />
      <circle cx={x} cy={y} r={g.dc / 2} fill={cond} />
    </g>
  );
}
