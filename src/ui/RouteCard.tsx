import React, { useEffect, useRef, useState } from 'react';
import type { RouteSpec } from '../engine';
import { typeLabel } from '../report/sections';
import { amps } from './format';

interface Props {
  route: RouteSpec;
  ratings: Record<string, number>;
  onEdit: (id: string) => void;
}

/** Round ticks covering [min, max]. */
function niceScale(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => raw <= s) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v < max + step - 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

export function routeSummary(route: RouteSpec, ratings: Record<string, number>) {
  let chain = 0;
  const rows = route.sections.map((s, i) => {
    const from = chain;
    chain += Math.max(0, s.length_m || 0);
    return { s, i, from, to: chain, I: ratings[s.id] };
  });
  const valid = rows.filter((r) => Number.isFinite(r.I));
  const min = valid.length ? Math.min(...valid.map((r) => r.I)) : NaN;
  const bottleneck = valid.find((r) => r.I === min);
  return { rows, total: chain, min, bottleneck };
}

const M = { top: 22, right: 16, bottom: 34, left: 52 };

export function RouteCard({ route, ratings, onEdit }: Props) {
  const box = useRef<HTMLElement>(null);
  const [W, setW] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.min(1100, Math.round(e.contentRect.width)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!route.sections.length) return null;

  const { rows, total, min, bottleneck } = routeSummary(route, ratings);
  const H = 230;
  const maxI = Math.max(...rows.map((r) => (Number.isFinite(r.I) ? r.I : 0)), 1);
  const yTicks = niceScale(0, maxI * 1.08, 4);
  const y1 = yTicks[yTicks.length - 1];
  const sx = (v: number) => M.left + (total > 0 ? (v / total) * (W - M.left - M.right) : 0);
  const sy = (v: number) => H - M.bottom - (v / y1) * (H - M.top - M.bottom);
  const hr = hover !== null ? rows[hover] : null;

  return (
    <section className="card route-card" aria-labelledby="route-title" ref={box}>
      <header className="card-head">
        <div>
          <h2 id="route-title">Cable route</h2>
          <p className="card-sub">
            {rows.length} sections · {Math.round(total).toLocaleString('en-GB')} m. Ratings by the IEC method; the route
            is limited by its lowest section.
          </p>
        </div>
        {Number.isFinite(min) && bottleneck && (
          <div className="route-headline">
            <span className="eyebrow">Route rating</span>
            <span className="route-big">{amps(min)} A</span>
            <span className="route-limit">limited by {bottleneck.s.name}</span>
          </div>
        )}
      </header>
      <div className="chart-wrap">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="chart"
          role="img"
          aria-label={`Rating along the route. Lowest ${amps(min)} A in ${bottleneck?.s.name ?? 'no section'}.`}
          onPointerMove={(e) => {
            const b = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - b.left) / b.width) * W;
            const at = rows.findIndex((r) => px >= sx(r.from) && px <= sx(r.to));
            setHover(at >= 0 ? at : null);
          }}
          onPointerLeave={() => setHover(null)}
        >
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} className="grid" />
              <text x={M.left - 8} y={sy(t)} className="tick" textAnchor="end" dominantBaseline="middle">
                {amps(t)}
              </text>
            </g>
          ))}
          {rows.map((r) => {
            if (!Number.isFinite(r.I)) return null;
            const x = sx(r.from) + 1;
            const w = Math.max(2, sx(r.to) - sx(r.from) - 2);
            const isMin = r === bottleneck;
            const active = r.s.id === route.activeId;
            return (
              <g key={r.s.id}>
                <rect
                  x={x}
                  y={sy(r.I)}
                  width={w}
                  height={sy(0) - sy(r.I)}
                  rx={Math.min(4, w / 2)}
                  className={`route-bar${isMin ? ' is-min' : ''}${active ? ' is-active' : ''}${hover === r.i ? ' is-hover' : ''}`}
                />
                {w > 34 && (
                  <text x={x + w / 2} y={sy(r.I) - 6} className="dot-label route-val" textAnchor="middle">
                    {amps(r.I)}
                  </text>
                )}
                <text x={x + w / 2} y={H - M.bottom + 16} className="tick" textAnchor="middle">
                  {w > 14 ? r.i + 1 : ''}
                </text>
              </g>
            );
          })}
          {Number.isFinite(min) && (
            <g>
              <line x1={M.left} x2={W - M.right} y1={sy(min)} y2={sy(min)} className="route-min" />
              <text x={M.left + 6} y={sy(min) + 14} className="tick axis-title route-min-label">
                Route rating {amps(min)} A
              </text>
            </g>
          )}
          <text x={W - M.right} y={H - 4} className="tick axis-title" textAnchor="end">
            Chainage (m), sections numbered
          </text>
          <text x={12} y={M.top - 8} className="tick axis-title">
            A
          </text>
        </svg>
        {hr && Number.isFinite(hr.I) && (
          <div
            className="tooltip"
            style={{
              left: `${((sx(hr.from) + sx(hr.to)) / 2 / W) * 100}%`,
              top: `${(sy(hr.I) / H) * 100}%`,
              transform: `translate(${(sx(hr.from) + sx(hr.to)) / 2 > W * 0.6 ? 'calc(-100% - 12px)' : '12px'}, -50%)`,
            }}
          >
            <span className="tooltip-k">
              {hr.i + 1}. {hr.s.name}
            </span>
            <span className="tooltip-v">{amps(hr.I)} A</span>
            <span className="tooltip-k">
              {Math.round(hr.from).toLocaleString('en-GB')}–{Math.round(hr.to).toLocaleString('en-GB')} m
            </span>
          </div>
        )}
      </div>
      <div className="table-scroll">
        <table className="data-table circuits-table route-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Section</th>
              <th scope="col">Installation</th>
              <th scope="col" className="num">
                Chainage
              </th>
              <th scope="col" className="num">
                Length
              </th>
              <th scope="col" className="num">
                Rating
              </th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.s.id} className={r === bottleneck ? 'is-governing' : ''}>
                <th scope="row">{r.i + 1}</th>
                <td className="text">
                  {r.s.name}{' '}
                  {r === bottleneck && <span className="pill pill-warn">Bottleneck</span>}
                  {r.s.id === route.activeId && <span className="pill pill-note">Editing</span>}
                </td>
                <td className="text">{typeLabel[r.s.inst.type]}</td>
                <td className="num">
                  {Math.round(r.from).toLocaleString('en-GB')}–{Math.round(r.to).toLocaleString('en-GB')} m
                </td>
                <td className="num">{Math.round(r.s.length_m).toLocaleString('en-GB')} m</td>
                <td className="num">{Number.isFinite(r.I) ? `${amps(r.I)} A` : 'not available'}</td>
                <td className="text">
                  {r.s.id !== route.activeId && (
                    <button type="button" className="btn btn-quiet" onClick={() => onEdit(r.s.id)}>
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
