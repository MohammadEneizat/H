import { fieldTemperature, type FieldModel } from '../engine';
import { heatAlpha, makeRamp } from './theme';

/** Rectangle in mm; y is depth, positive down. */
export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Grid {
  region: Region;
  nx: number;
  ny: number;
  /** Values at cell centres, row-major (j * nx + i) */
  v: Float64Array;
}

export function sampleField(field: FieldModel, region: Region, nx: number, ny: number): Grid {
  const v = new Float64Array(nx * ny);
  const dx = (region.x1 - region.x0) / nx;
  const dy = (region.y1 - region.y0) / ny;
  for (let j = 0; j < ny; j++) {
    const y = region.y0 + (j + 0.5) * dy;
    for (let i = 0; i < nx; i++) v[j * nx + i] = fieldTemperature(field, region.x0 + (i + 0.5) * dx, y);
  }
  return { region, nx, ny, v };
}

export function gridMax(g: Grid): number {
  let m = -Infinity;
  for (const x of g.v) if (x > m) m = x;
  return m;
}

/** A round step giving about `count` intervals over `span`. */
export function niceStep(span: number, count = 6): number {
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}

/** Isotherm levels strictly between tMin and tMax. */
export function isoLevels(tMin: number, tMax: number): number[] {
  const step = niceStep(tMax - tMin, 7);
  const out: number[] = [];
  for (let t = Math.ceil((tMin + step * 0.5) / step) * step; t < tMax - 1e-9; t += step) out.push(Number(t.toFixed(6)));
  return out;
}

/** PNG data URL of the heat overlay: transparent at tMin, ramp colour with rising opacity towards tMax. */
export function heatImage(g: Grid, tMin: number, tMax: number, stops: string[]): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = g.nx;
  canvas.height = g.ny;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(g.nx, g.ny);
  const ramp = makeRamp(stops);
  for (let k = 0; k < g.v.length; k++) {
    const val = g.v[k];
    if (!Number.isFinite(val)) continue;
    const t = (val - tMin) / (tMax - tMin);
    const [r, gg, b] = ramp(t);
    img.data[k * 4] = r;
    img.data[k * 4 + 1] = gg;
    img.data[k * 4 + 2] = b;
    img.data[k * 4 + 3] = Math.round(heatAlpha(t) * 255);
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

type Pt = [number, number];

/** Marching squares: isotherm at `level` as line segments (mm coordinates). */
export function contourSegments(g: Grid, level: number): [Pt, Pt][] {
  const { nx, ny, v, region } = g;
  const dx = (region.x1 - region.x0) / nx;
  const dy = (region.y1 - region.y0) / ny;
  const X = (i: number) => region.x0 + (i + 0.5) * dx;
  const Y = (j: number) => region.y0 + (j + 0.5) * dy;
  const segs: [Pt, Pt][] = [];
  const lerp = (a: number, b: number) => (level - a) / (b - a);
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = v[j * nx + i];
      const b = v[j * nx + i + 1];
      const c = v[(j + 1) * nx + i + 1];
      const d = v[(j + 1) * nx + i];
      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) continue;
      const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const top: Pt = [X(i) + lerp(a, b) * dx, Y(j)];
      const right: Pt = [X(i + 1), Y(j) + lerp(b, c) * dy];
      const bottom: Pt = [X(i) + lerp(d, c) * dx, Y(j + 1)];
      const left: Pt = [X(i), Y(j) + lerp(a, d) * dy];
      switch (idx) {
        case 1:
        case 14:
          segs.push([left, bottom]);
          break;
        case 2:
        case 13:
          segs.push([bottom, right]);
          break;
        case 3:
        case 12:
          segs.push([left, right]);
          break;
        case 4:
        case 11:
          segs.push([top, right]);
          break;
        case 6:
        case 9:
          segs.push([top, bottom]);
          break;
        case 7:
        case 8:
          segs.push([left, top]);
          break;
        case 5:
          segs.push([left, top], [bottom, right]);
          break;
        case 10:
          segs.push([top, right], [left, bottom]);
          break;
      }
    }
  }
  return segs;
}

export function segmentsPath(segs: [Pt, Pt][]): string {
  return segs.map(([p, q]) => `M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('');
}

/** A spot for the isotherm's label: its right-most point away from the region edges and the cables. */
export function labelSpot(
  segs: [Pt, Pt][],
  region: Region,
  avoid: { x: number; y: number; r: number }[] = [],
): Pt | null {
  const w = region.x1 - region.x0;
  const h = region.y1 - region.y0;
  const clear = w / 28;
  let best: Pt | null = null;
  for (const [p] of segs) {
    if (p[0] > region.x1 - 0.1 * w || p[1] < region.y0 + 0.1 * h || p[1] > region.y1 - 0.08 * h) continue;
    if (avoid.some((a) => Math.hypot(p[0] - a.x, p[1] - a.y) < a.r + clear)) continue;
    if (!best || p[0] > best[0]) best = p;
  }
  return best;
}

export interface HeatLayer {
  href: string;
  region: Region;
  isotherms: { level: number; d: string; label: Pt | null }[];
}

export function heatLayer(
  field: FieldModel,
  region: Region,
  nx: number,
  tMin: number,
  tMax: number,
  levels: number[],
  stops: string[],
): HeatLayer {
  const ny = Math.max(8, Math.round((nx * (region.y1 - region.y0)) / (region.x1 - region.x0)));
  const g = sampleField(field, region, nx, ny);
  return {
    href: heatImage(g, tMin, tMax, stops),
    region,
    isotherms: levels.map((level) => {
      const segs = contourSegments(g, level);
      return { level, d: segmentsPath(segs), label: labelSpot(segs, region, field.sources) };
    }),
  };
}
