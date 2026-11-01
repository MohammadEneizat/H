import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sweepRating, type CableSpec, type InstallationSpec, type RatingResult, type SweepParam } from '../engine';
import { amps, fmt } from './format';

interface Props {
  cable: CableSpec;
  inst: InstallationSpec;
  result: RatingResult;
}

interface ParamDef {
  key: SweepParam;
  label: string;
  unit: string;
  digits: number;
  range: (inst: InstallationSpec, r: RatingResult) => [number, number];
  current: (inst: InstallationSpec, r: RatingResult) => number;
}

const PARAMS: ParamDef[] = [
  {
    key: 'depth_m',
    label: 'Depth of laying',
    unit: 'm',
    digits: 2,
    range: (i) => [i.type === 'ductbank' ? Math.max(0.5, i.bank.height_m / 2 + 0.2) : 0.5, 2.5],
    current: (i) => i.depth_m,
  },
  { key: 'soilRho', label: 'Soil thermal resistivity', unit: 'K·m/W', digits: 2, range: () => [0.5, 3], current: (i) => i.soilRho },
  {
    key: 'ambient_C',
    label: 'Ambient temperature',
    unit: '°C',
    digits: 0,
    range: (i) => (i.type === 'air' ? [10, 50] : [0, 40]),
    current: (i) => i.ambient_C,
  },
  {
    key: 'spacing_mm',
    label: 'Axial spacing',
    unit: 'mm',
    digits: 0,
    range: (i, r) => {
      const d = i.type === 'ducts' || i.type === 'ductbank' ? i.duct.outerD_mm : r.geometry.De;
      return [d, d * 5];
    },
    current: (_, r) => r.spacing_mm,
  },
];

/** Round ticks that cover [min, max] (first ≤ min, last ≥ max). */
function niceScale(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => raw <= s) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v < max + step - 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

const M = { top: 18, right: 24, bottom: 40, left: 56 };

export function SweepChart({ cable, inst, result }: Props) {
  const available = PARAMS.filter((p) =>
    inst.type === 'air'
      ? p.key === 'ambient_C' || (p.key === 'spacing_mm' && inst.air.arrangement === 'isolated')
      : inst.type === 'trench'
        ? p.key === 'ambient_C' || (p.key === 'spacing_mm' && !inst.touching)
        : true,
  );
  const [key, setKey] = useState<SweepParam>(inst.type === 'trench' ? 'ambient_C' : 'soilRho');
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLElement>(null);
  const [W, setW] = useState(640);
  const def = available.find((p) => p.key === key) ?? available[0];

  const data = useMemo(() => {
    if (!result.ok) return [];
    const [a, b] = def.range(inst, result);
    const n = 24;
    const xs = Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
    return sweepRating(cable, inst, def.key, xs).filter((p) => Number.isFinite(p.I));
  }, [cable, inst, def, result]);

  const drawn = result.ok && data.length > 1;
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.min(960, Math.round(e.contentRect.width)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [drawn]);

  if (!drawn) return null;
  const H = Math.round(Math.max(220, Math.min(300, W * 0.42)));

  const x0 = data[0].x;
  const x1 = data[data.length - 1].x;
  const Is = data.map((d) => d.I);
  const yMax = Math.max(...Is, result.I);
  const yMin = Math.min(...Is, result.I);
  const pad = (yMax - yMin) * 0.06 || yMax * 0.1;
  const yTicks = niceScale(Math.max(0, yMin - pad), yMax + pad, 5);
  const y0 = yTicks[0];
  const y1 = yTicks[yTicks.length - 1];
  const sx = (x: number) => M.left + ((x - x0) / (x1 - x0)) * (W - M.left - M.right);
  const sy = (y: number) => H - M.bottom - ((y - y0) / (y1 - y0)) * (H - M.top - M.bottom);
  const xTicks = niceTicks(x0, x1, W < 480 ? 4 : 6);
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${sx(d.x).toFixed(1)},${sy(d.I).toFixed(1)}`).join('');
  const area = `${line}L${sx(x1).toFixed(1)},${sy(y0).toFixed(1)}L${sx(x0).toFixed(1)},${sy(y0).toFixed(1)}Z`;
  const cur = def.current(inst, result);
  const curIn = cur >= x0 && cur <= x1;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    data.forEach((d, i) => {
      if (Math.abs(sx(d.x) - px) < Math.abs(sx(data[best].x) - px)) best = i;
    });
    setHover(best);
  };
  const hp = hover !== null ? data[hover] : null;

  return (
    <section className="card chart-card" aria-labelledby="sweep-title" ref={box}>
      <header className="card-head">
        <div>
          <h2 id="sweep-title">Rating against {def.label.toLowerCase()}</h2>
          <p className="card-sub">
            All other inputs held at their current values.{inst.type === 'trench' ? ' IEC method.' : ''}
          </p>
        </div>
        <div className="chart-controls">
          <label htmlFor="sweep-param" className="sr-only">
            Parameter
          </label>
          <select id="sweep-param" value={def.key} onChange={(e) => setKey(e.target.value as SweepParam)}>
            {available.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-quiet" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
            {showTable ? 'Show chart' : 'Show table'}
          </button>
        </div>
      </header>
      {showTable ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">
                  {def.label} ({def.unit})
                </th>
                <th scope="col">Rating (A)</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.x}>
                  <td>{fmt(d.x, def.digits)}</td>
                  <td>{amps(d.I)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-wrap" ref={wrap}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="chart"
            role="img"
            aria-label={`Rating from ${amps(Is[0])} A to ${amps(Is[Is.length - 1])} A as ${def.label.toLowerCase()} goes from ${fmt(x0, def.digits)} to ${fmt(x1, def.digits)} ${def.unit}`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            {yTicks.map((t) => (
              <g key={`y${t}`}>
                <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} className="grid" />
                <text x={M.left - 8} y={sy(t)} className="tick" textAnchor="end" dominantBaseline="middle">
                  {amps(t)}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text key={`x${t}`} x={sx(t)} y={H - M.bottom + 18} className="tick" textAnchor="middle">
                {Number(t.toFixed(def.digits)).toLocaleString('en-GB')}
              </text>
            ))}
            <text x={W - M.right} y={H - 6} className="tick axis-title" textAnchor="end">
              {def.label} ({def.unit})
            </text>
            <text x={12} y={M.top - 4} className="tick axis-title">
              A
            </text>
            <path d={area} className="area" />
            <path d={line} className="line" />
            {curIn && (
              <g>
                <line x1={sx(cur)} x2={sx(cur)} y1={M.top} y2={H - M.bottom} className="marker-line" />
                <circle cx={sx(cur)} cy={sy(result.I)} r={5} className="dot" />
                <text
                  x={sx(cur) + (sx(cur) > W * 0.7 ? -10 : 10)}
                  y={sy(result.I) - 12}
                  className="dot-label"
                  textAnchor={sx(cur) > W * 0.7 ? 'end' : 'start'}
                >
                  Current input: {amps(result.I)} A
                </text>
              </g>
            )}
            {hp && (
              <g pointerEvents="none">
                <line x1={sx(hp.x)} x2={sx(hp.x)} y1={M.top} y2={H - M.bottom} className="crosshair" />
                <circle cx={sx(hp.x)} cy={sy(hp.I)} r={4.5} className="dot dot-hover" />
              </g>
            )}
            <rect x={M.left} y={M.top} width={W - M.left - M.right} height={H - M.top - M.bottom} fill="transparent" />
          </svg>
          {hp && (
            <div
              className="tooltip"
              style={{
                left: `${(sx(hp.x) / W) * 100}%`,
                top: `${(sy(hp.I) / H) * 100}%`,
                transform: `translate(${sx(hp.x) > W * 0.65 ? 'calc(-100% - 12px)' : '12px'}, -50%)`,
              }}
            >
              <span className="tooltip-k">
                {fmt(hp.x, def.digits)} {def.unit}
              </span>
              <span className="tooltip-v">{amps(hp.I)} A</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
