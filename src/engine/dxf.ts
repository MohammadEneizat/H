// Reading a trench cross-section from a DXF drawing (ASCII DXF, any version).
// Closed regions become fill shapes, circles become cables and conduits, and the whole
// drawing is kept as an underlay so the editor shows it as drawn.
import { GROUND, type GroundMaterial } from './materials';

export interface P {
  x: number;
  y: number;
}

export type DxfEntity =
  | { kind: 'seg'; a: P; b: P; layer: string }
  | { kind: 'poly'; pts: P[]; closed: boolean; layer: string }
  | { kind: 'circle'; c: P; r: number; layer: string }
  | { kind: 'text'; p: P; h: number; text: string; layer: string };

export interface DxfDoc {
  /** $INSUNITS of the header (0 when not given) */
  insunits: number;
  entities: DxfEntity[];
  layers: string[];
  warnings: string[];
}

type Raw = { type: string; codes: [number, string][] };

const num = (v: string | undefined, d = 0) => {
  const n = v === undefined ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : d;
};

/** Group codes and values, in order. */
function pairs(text: string): [number, string][] {
  const lines = text.split(/\r\n|\r|\n/);
  const out: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (!Number.isFinite(code)) {
      i -= 1; // resynchronise on a stray line
      continue;
    }
    out.push([code, lines[i + 1].replace(/\s+$/, '')]);
  }
  return out;
}

/** Splits a run of group pairs into entities (each starts at a 0 code). */
function entitiesOf(ps: [number, string][]): Raw[] {
  const out: Raw[] = [];
  let cur: Raw | null = null;
  for (const [c, v] of ps) {
    if (c === 0) {
      cur = { type: v.trim(), codes: [] };
      out.push(cur);
    } else if (cur) cur.codes.push([c, v]);
  }
  return out;
}

const get = (r: Raw, code: number) => r.codes.find(([c]) => c === code)?.[1];

/** Points of an arc from a to b with a DXF bulge (tan of a quarter of the included angle). */
function bulgeArc(a: P, b: P, bulge: number): P[] {
  if (!bulge || Math.abs(bulge) < 1e-9) return [];
  const theta = 4 * Math.atan(bulge);
  const s = (1 / bulge - bulge) / 2;
  const cx = (a.x + b.x) / 2 - (s * (b.y - a.y)) / 2;
  const cy = (a.y + b.y) / 2 + (s * (b.x - a.x)) / 2;
  const r = Math.hypot(a.x - cx, a.y - cy);
  const a0 = Math.atan2(a.y - cy, a.x - cx);
  const n = Math.max(2, Math.ceil(Math.abs(theta) / (Math.PI / 24)));
  const pts: P[] = [];
  for (let i = 1; i < n; i++) {
    const t = a0 + (theta * i) / n;
    pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return pts;
}

function arcPoints(c: P, r: number, a0: number, a1: number): P[] {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += 2 * Math.PI;
  const n = Math.max(2, Math.ceil(sweep / (Math.PI / 24)));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = a0 + (sweep * i) / n;
    return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) };
  });
}

/** Strips MTEXT formatting codes. */
function plainText(t: string): string {
  return t
    .replace(/\\P/g, ' ')
    .replace(/\\[A-Za-z][^;\\]*;/g, '')
    .replace(/\\[~ ]/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/%%[cC]/g, '⌀')
    .replace(/%%[dD]/g, '°')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Xf {
  ox: number;
  oy: number;
  sx: number;
  sy: number;
  rot: number;
  bx: number;
  by: number;
}
const apply = (t: Xf, p: P): P => {
  const x = (p.x - t.bx) * t.sx;
  const y = (p.y - t.by) * t.sy;
  const c = Math.cos(t.rot);
  const s = Math.sin(t.rot);
  return { x: t.ox + x * c - y * s, y: t.oy + x * s + y * c };
};

/** Reads an ASCII DXF file. Blocks (INSERT) are expanded; hatches and dimensions are skipped. */
export function parseDxf(text: string): DxfDoc {
  const warnings: string[] = [];
  if (/^AutoCAD Binary DXF/.test(text)) throw new Error('This is a binary DXF. Save the drawing as ASCII DXF and try again.');
  const ps = pairs(text);
  if (!ps.length) throw new Error('This file does not look like a DXF drawing.');
  let insunits = 0;
  const blocks = new Map<string, { base: P; raws: Raw[] }>();
  let entityRaws: Raw[] = [];
  // Sections
  for (let i = 0; i < ps.length; i++) {
    if (ps[i][0] !== 0 || ps[i][1].trim() !== 'SECTION') continue;
    const name = ps[i + 1]?.[1].trim();
    let j = i + 2;
    while (j < ps.length && !(ps[j][0] === 0 && ps[j][1].trim() === 'ENDSEC')) j++;
    const body = ps.slice(i + 2, j);
    if (name === 'HEADER') {
      const k = body.findIndex(([c, v]) => c === 9 && v.trim() === '$INSUNITS');
      if (k >= 0) insunits = num(body[k + 1]?.[1]);
    } else if (name === 'BLOCKS') {
      const raws = entitiesOf(body);
      let cur: { name: string; base: P; raws: Raw[] } | null = null;
      for (const r of raws) {
        if (r.type === 'BLOCK') cur = { name: (get(r, 2) ?? '').trim(), base: { x: num(get(r, 10)), y: num(get(r, 20)) }, raws: [] };
        else if (r.type === 'ENDBLK') {
          if (cur) blocks.set(cur.name, { base: cur.base, raws: cur.raws });
          cur = null;
        } else if (cur) cur.raws.push(r);
      }
    } else if (name === 'ENTITIES') entityRaws = entitiesOf(body);
    i = j;
  }
  if (!entityRaws.length) throw new Error('The DXF has no ENTITIES section.');

  const entities: DxfEntity[] = [];
  const layers = new Set<string>();
  const skipped = new Map<string, number>();
  const ident: Xf = { ox: 0, oy: 0, sx: 1, sy: 1, rot: 0, bx: 0, by: 0 };

  const walk = (raws: Raw[], xf: Xf[], depth: number) => {
    const T = (p: P) => xf.reduceRight((q, t) => apply(t, q), p);
    const scale = xf.reduce((a, t) => a * Math.sqrt(Math.abs(t.sx * t.sy)), 1);
    for (let k = 0; k < raws.length; k++) {
      const r = raws[k];
      const layer = (get(r, 8) ?? '0').trim();
      const pt = (cx: number, cy: number) => T({ x: num(get(r, cx)), y: num(get(r, cy)) });
      switch (r.type) {
        case 'LINE':
          entities.push({ kind: 'seg', a: pt(10, 20), b: pt(11, 21), layer });
          break;
        case 'LWPOLYLINE': {
          const closed = (num(get(r, 70)) & 1) === 1;
          const verts: { p: P; bulge: number }[] = [];
          for (const [c, v] of r.codes) {
            if (c === 10) verts.push({ p: { x: num(v), y: 0 }, bulge: 0 });
            else if (c === 20 && verts.length) verts[verts.length - 1].p.y = num(v);
            else if (c === 42 && verts.length) verts[verts.length - 1].bulge = num(v);
          }
          entities.push({ kind: 'poly', pts: withBulges(verts, closed).map(T), closed, layer });
          break;
        }
        case 'POLYLINE': {
          const closed = (num(get(r, 70)) & 1) === 1;
          const verts: { p: P; bulge: number }[] = [];
          while (k + 1 < raws.length && raws[k + 1].type === 'VERTEX') {
            k++;
            const v = raws[k];
            if ((num(get(v, 70)) & 16) === 16) continue; // spline frame point
            verts.push({ p: { x: num(get(v, 10)), y: num(get(v, 20)) }, bulge: num(get(v, 42)) });
          }
          if (k + 1 < raws.length && raws[k + 1].type === 'SEQEND') k++;
          if (verts.length > 1) entities.push({ kind: 'poly', pts: withBulges(verts, closed).map(T), closed, layer });
          break;
        }
        case 'CIRCLE':
          entities.push({ kind: 'circle', c: pt(10, 20), r: num(get(r, 40)) * scale, layer });
          break;
        case 'ARC': {
          const c = { x: num(get(r, 10)), y: num(get(r, 20)) };
          const pts = arcPoints(c, num(get(r, 40)), (num(get(r, 50)) * Math.PI) / 180, (num(get(r, 51)) * Math.PI) / 180);
          entities.push({ kind: 'poly', pts: pts.map(T), closed: false, layer });
          break;
        }
        case 'ELLIPSE': {
          const c = { x: num(get(r, 10)), y: num(get(r, 20)) };
          const mx = num(get(r, 11));
          const my = num(get(r, 21));
          const ratio = num(get(r, 40), 1);
          const t0 = num(get(r, 41));
          let t1 = num(get(r, 42), 2 * Math.PI);
          if (t1 <= t0) t1 += 2 * Math.PI;
          const n = Math.max(8, Math.ceil((t1 - t0) / (Math.PI / 24)));
          const pts = Array.from({ length: n + 1 }, (_, i) => {
            const t = t0 + ((t1 - t0) * i) / n;
            return { x: c.x + mx * Math.cos(t) - my * ratio * Math.sin(t), y: c.y + my * Math.cos(t) + mx * ratio * Math.sin(t) };
          });
          entities.push({ kind: 'poly', pts: pts.map(T), closed: Math.abs(t1 - t0 - 2 * Math.PI) < 1e-6, layer });
          break;
        }
        case 'SPLINE': {
          const fit: P[] = [];
          const ctrl: P[] = [];
          for (let q = 0; q < r.codes.length; q++) {
            const [c, v] = r.codes[q];
            if (c === 11) fit.push({ x: num(v), y: num(r.codes[q + 1]?.[1]) });
            if (c === 10) ctrl.push({ x: num(v), y: num(r.codes[q + 1]?.[1]) });
          }
          const pts = fit.length > 1 ? fit : ctrl;
          if (pts.length > 1) entities.push({ kind: 'poly', pts: pts.map(T), closed: (num(get(r, 70)) & 1) === 1, layer });
          break;
        }
        case 'TEXT':
        case 'MTEXT': {
          const t = plainText([...r.codes.filter(([c]) => c === 3).map(([, v]) => v), get(r, 1) ?? ''].join(''));
          if (t) entities.push({ kind: 'text', p: pt(10, 20), h: num(get(r, 40), 1) * scale, text: t, layer });
          break;
        }
        case 'INSERT': {
          const b = blocks.get((get(r, 2) ?? '').trim());
          if (!b || depth > 6) break;
          const t: Xf = {
            ox: num(get(r, 10)),
            oy: num(get(r, 20)),
            sx: num(get(r, 41), 1),
            sy: num(get(r, 42), 1),
            rot: (num(get(r, 50)) * Math.PI) / 180,
            bx: b.base.x,
            by: b.base.y,
          };
          walk(b.raws, [...xf, t], depth + 1);
          break;
        }
        case 'VERTEX':
        case 'SEQEND':
          break;
        default:
          skipped.set(r.type, (skipped.get(r.type) ?? 0) + 1);
      }
      layers.add(layer);
    }
  };
  walk(entityRaws, [ident], 0);
  const notable = [...skipped.entries()].filter(([t]) => !['ATTRIB', 'ATTDEF', 'VIEWPORT', 'POINT'].includes(t));
  if (notable.length) warnings.push(`Not read: ${notable.map(([t, n]) => `${n} ${t}`).join(', ')}.`);
  return { insunits, entities, layers: [...layers], warnings };
}

function withBulges(verts: { p: P; bulge: number }[], closed: boolean): P[] {
  const out: P[] = [];
  verts.forEach((v, i) => {
    out.push(v.p);
    const next = verts[i + 1] ?? (closed ? verts[0] : undefined);
    if (next) out.push(...bulgeArc(v.p, next.p, v.bulge));
  });
  return out;
}

/** Millimetres per drawing unit for a $INSUNITS code (0 when unknown). */
export function unitScale(insunits: number): number {
  return ({ 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 } as Record<number, number>)[insunits] ?? 0;
}

// ---------------------------------------------------------------------------------------
// Regions: faces of the planar graph made by all lines
// ---------------------------------------------------------------------------------------

/** Line segments of every line, polyline and arc. */
export function segmentsOf(doc: DxfDoc): [P, P][] {
  const out: [P, P][] = [];
  for (const e of doc.entities) {
    if (e.kind === 'seg') out.push([e.a, e.b]);
    else if (e.kind === 'poly') {
      for (let i = 0; i + 1 < e.pts.length; i++) out.push([e.pts[i], e.pts[i + 1]]);
      if (e.closed && e.pts.length > 2) out.push([e.pts[e.pts.length - 1], e.pts[0]]);
    }
  }
  return out.filter(([a, b]) => Number.isFinite(a.x + a.y + b.x + b.y));
}

export const polygonArea = (pts: P[]) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
};

export function pointInPolygon(p: P, pts: P[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Closed regions formed by the segments, whether drawn as closed polylines or as separate
 * lines meeting at their ends or crossing (a trench outline with a line across it for the
 * top of the bedding gives two regions). Returns counter-clockwise polygons.
 */
export function extractFaces(segs: [P, P][], tol: number): P[][] {
  // Split segments where they cross or where an end touches another segment
  const cuts: number[][] = segs.map(() => [0, 1]);
  const bb = segs.map(([a, b]) => ({ x0: Math.min(a.x, b.x) - tol, x1: Math.max(a.x, b.x) + tol, y0: Math.min(a.y, b.y) - tol, y1: Math.max(a.y, b.y) + tol }));
  const order = segs.map((_, i) => i).sort((i, j) => bb[i].x0 - bb[j].x0);
  for (let ii = 0; ii < order.length; ii++) {
    const i = order[ii];
    for (let jj = ii + 1; jj < order.length; jj++) {
      const j = order[jj];
      if (bb[j].x0 > bb[i].x1) break;
      if (bb[j].y0 > bb[i].y1 || bb[j].y1 < bb[i].y0) continue;
      const [a, b] = segs[i];
      const [c, d] = segs[j];
      const r = { x: b.x - a.x, y: b.y - a.y };
      const s = { x: d.x - c.x, y: d.y - c.y };
      const den = r.x * s.y - r.y * s.x;
      const li = Math.hypot(r.x, r.y);
      const lj = Math.hypot(s.x, s.y);
      if (li < tol || lj < tol) continue;
      if (Math.abs(den) > 1e-12 * li * lj) {
        const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
        const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
        const et = tol / li;
        const eu = tol / lj;
        if (t > -et && t < 1 + et && u > -eu && u < 1 + eu) {
          cuts[i].push(Math.min(1, Math.max(0, t)));
          cuts[j].push(Math.min(1, Math.max(0, u)));
        }
      } else {
        // Parallel: ends lying on the other segment (overlaps, collinear joins)
        const onSeg = (p: P, q0: P, q1: P, len: number) => {
          const t = ((p.x - q0.x) * (q1.x - q0.x) + (p.y - q0.y) * (q1.y - q0.y)) / (len * len);
          const dx = q0.x + t * (q1.x - q0.x) - p.x;
          const dy = q0.y + t * (q1.y - q0.y) - p.y;
          return t > 0 && t < 1 && Math.hypot(dx, dy) < tol ? t : null;
        };
        const t1 = onSeg(c, a, b, li);
        const t2 = onSeg(d, a, b, li);
        const u1 = onSeg(a, c, d, lj);
        const u2 = onSeg(b, c, d, lj);
        if (t1 !== null) cuts[i].push(t1);
        if (t2 !== null) cuts[i].push(t2);
        if (u1 !== null) cuts[j].push(u1);
        if (u2 !== null) cuts[j].push(u2);
      }
    }
  }
  // Nodes, merged within tol
  const nodes: P[] = [];
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.round(x / tol)}:${Math.round(y / tol)}`;
  const nodeOf = (p: P) => {
    const gx = Math.round(p.x / tol);
    const gy = Math.round(p.y / tol);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const n of grid.get(`${gx + dx}:${gy + dy}`) ?? []) if (Math.hypot(nodes[n].x - p.x, nodes[n].y - p.y) <= tol) return n;
    nodes.push(p);
    const k = key(p.x, p.y);
    grid.set(k, [...(grid.get(k) ?? []), nodes.length - 1]);
    return nodes.length - 1;
  };
  const edges = new Set<string>();
  const adj = new Map<number, Set<number>>();
  const link = (u: number, v: number) => {
    if (u === v) return;
    const k = u < v ? `${u},${v}` : `${v},${u}`;
    if (edges.has(k)) return;
    edges.add(k);
    if (!adj.has(u)) adj.set(u, new Set());
    if (!adj.has(v)) adj.set(v, new Set());
    adj.get(u)!.add(v);
    adj.get(v)!.add(u);
  };
  segs.forEach(([a, b], i) => {
    const ts = [...new Set(cuts[i].map((t) => Math.round(t * 1e9) / 1e9))].sort((x, y) => x - y);
    let prev = nodeOf(a);
    for (let k = 1; k < ts.length; k++) {
      const t = ts[k];
      const n = nodeOf({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
      link(prev, n);
      prev = n;
    }
  });
  // Remove dangling lines
  let changed = true;
  while (changed) {
    changed = false;
    for (const [n, set] of adj) {
      if (set.size >= 2) continue;
      for (const m of set) adj.get(m)?.delete(n);
      adj.delete(n);
      changed = true;
    }
  }
  // Neighbours in counter-clockwise order
  const sorted = new Map<number, number[]>();
  for (const [n, set] of adj)
    sorted.set(
      n,
      [...set].sort((u, v) => Math.atan2(nodes[u].y - nodes[n].y, nodes[u].x - nodes[n].x) - Math.atan2(nodes[v].y - nodes[n].y, nodes[v].x - nodes[n].x)),
    );
  const used = new Set<string>();
  const faces: P[][] = [];
  for (const [u0, list] of sorted)
    for (const v0 of list) {
      if (used.has(`${u0}>${v0}`)) continue;
      const loop: number[] = [];
      let u = u0;
      let v = v0;
      for (let guard = 0; guard < 100000; guard++) {
        used.add(`${u}>${v}`);
        loop.push(u);
        const nb = sorted.get(v)!;
        const k = nb.indexOf(u);
        const w = nb[(k - 1 + nb.length) % nb.length];
        u = v;
        v = w;
        if (u === u0 && v === v0) break;
      }
      const pts = loop.map((n) => nodes[n]);
      if (pts.length >= 3 && polygonArea(pts) > tol * tol * 10) faces.push(pts);
    }
  return faces;
}

// ---------------------------------------------------------------------------------------
// From drawing to layout
// ---------------------------------------------------------------------------------------

/** Material named in a label, and a resistivity if the label gives one (… K·m/W). */
export function materialFromText(text: string): { material: GroundMaterial; rho?: number } | null {
  const t = text.toLowerCase();
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*k\s*[.·*]?\s*m\s*\/\s*w/);
  const rho = m ? parseFloat(m[1].replace(',', '.')) : undefined;
  const find = (): GroundMaterial | null => {
    if (/\bcbs\b|cement[- ]?bound|lean[- ]?mix|magerbeton|stabili[sz]ed sand/.test(t)) return 'cbs';
    if (/thermal backfill|\bftb\b|fluidi[sz]ed|flowable/.test(t)) return 'ftb';
    if (/bentonite/.test(t)) return 'bentonite';
    if (/concrete|beton/.test(t)) return 'concrete';
    if (/asphalt|bitumen|tarmac/.test(t)) return 'asphalt';
    if (/sub-?base|base course|type 1|frostschutz/.test(t)) return 'subbase';
    if (/gravel|kies|crushed|ballast|schotter/.test(t)) return 'gravel';
    if (/top ?soil|mutterboden|humus/.test(t)) return 'topsoil';
    if (/dry sand/.test(t)) return 'sand-dry';
    if (/sand/.test(t)) return 'sand';
    if (/clay|lehm|loam|backfill|excavated|native|soil|boden|fill/.test(t)) return 'clay';
    if (/\bpe\b|polymer|tile/.test(t)) return 'polymer';
    return null;
  };
  const material = find();
  if (!material && rho === undefined) return null;
  return { material: material ?? 'custom', rho };
}

export interface DxfImportOptions {
  /** Millimetres per drawing unit */
  scale: number;
  /** Drawing y of the ground surface */
  groundY: number;
  /** Drawing x placed at x = 0 */
  originX: number;
  /** Circles up to this outer diameter (mm) are cables; larger ones conduits or bores */
  cableMaxD: number;
  /** Cables per circuit: 3 single-core AC, 2 single-core DC, 1 three-core */
  perCircuit: 1 | 2 | 3;
}

export interface DxfRegion {
  /** Polygon (m, y = depth down) */
  points: [number, number][];
  material: GroundMaterial;
  rho?: number;
  label: string;
  area: number;
}

export interface DxfCircuit {
  /** Cable centres (mm, y = depth down) */
  cables: P[];
  /** Outer diameter of the cables as drawn (mm) */
  d: number;
  conduit?: number;
  /** Each cable in its own duct of this size (mm) */
  duct?: { Do: number; Di: number };
}

export interface DxfLayout {
  regions: DxfRegion[];
  conduits: { x: number; y: number; Do: number; Di: number }[];
  bores: { x: number; y: number; d: number }[];
  circuits: DxfCircuit[];
  underlay: Underlay;
  notes: string[];
}

/** The drawing as thin lines (mm, y = depth down), shown under the editor's shapes. */
export interface Underlay {
  name: string;
  /** x1, y1, x2, y2 for each line */
  lines: number[];
  /** x, y, r for each circle */
  circles: number[];
  texts: { x: number; y: number; h: number; t: string }[];
}

/** Bounding box of the drawing (drawing units). */
export function dxfBounds(doc: DxfDoc) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const add = (p: P, r = 0) => {
    x0 = Math.min(x0, p.x - r);
    x1 = Math.max(x1, p.x + r);
    y0 = Math.min(y0, p.y - r);
    y1 = Math.max(y1, p.y + r);
  };
  for (const e of doc.entities) {
    if (e.kind === 'seg') {
      add(e.a);
      add(e.b);
    } else if (e.kind === 'poly') e.pts.forEach((p) => add(p));
    else if (e.kind === 'circle') add(e.c, e.r);
  }
  return { x0, x1, y0, y1 };
}

/**
 * Sensible defaults: units from the header (or the size of the drawing), the ground at the
 * top of the drawing, x = 0 in the middle of the lines' extent.
 */
export function dxfDefaults(doc: DxfDoc): { scale: number; groundY: number; originX: number; unitsGuessed: boolean } {
  const b = dxfBounds(doc);
  let scale = unitScale(doc.insunits);
  const unitsGuessed = !scale;
  if (!scale) {
    const w = b.x1 - b.x0;
    scale = w > 200 ? 1 : w > 20 ? 10 : 1000;
  }
  // Ground: the highest line; circles do not count
  let top = -Infinity;
  for (const e of doc.entities) {
    if (e.kind === 'seg') top = Math.max(top, e.a.y, e.b.y);
    else if (e.kind === 'poly') e.pts.forEach((p) => (top = Math.max(top, p.y)));
  }
  return { scale, groundY: Number.isFinite(top) ? top : b.y1, originX: (b.x0 + b.x1) / 2, unitsGuessed };
}

/** Converts a parsed drawing to regions, cables, conduits and an underlay. */
export function dxfToLayout(doc: DxfDoc, o: DxfImportOptions, name = 'DXF'): DxfLayout {
  const notes: string[] = [];
  const toMm = (p: P): P => ({ x: (p.x - o.originX) * o.scale, y: (o.groundY - p.y) * o.scale });
  const b = dxfBounds(doc);
  const diag = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) || 1;
  const tol = Math.max(diag * 2e-5, 0.2 / o.scale);

  // Underlay
  const segs = segmentsOf(doc);
  const lines: number[] = [];
  for (const [a, c] of segs.slice(0, 40000)) {
    const p = toMm(a);
    const q = toMm(c);
    lines.push(+p.x.toFixed(1), +p.y.toFixed(1), +q.x.toFixed(1), +q.y.toFixed(1));
  }
  if (segs.length > 40000) notes.push('Only the first 40 000 lines of the drawing are shown.');
  const circlesRaw = doc.entities.filter((e): e is Extract<DxfEntity, { kind: 'circle' }> => e.kind === 'circle' && e.r > 0);
  const texts = doc.entities.filter((e): e is Extract<DxfEntity, { kind: 'text' }> => e.kind === 'text');
  const underlay: Underlay = {
    name,
    lines,
    circles: circlesRaw.flatMap((c) => {
      const p = toMm(c.c);
      return [+p.x.toFixed(1), +p.y.toFixed(1), +(c.r * o.scale).toFixed(2)];
    }),
    texts: texts.slice(0, 500).map((t) => {
      const p = toMm(t.p);
      return { x: +p.x.toFixed(1), y: +p.y.toFixed(1), h: Math.max(10, t.h * o.scale), t: t.text.slice(0, 80) };
    }),
  };

  // Circles: concentric ones of similar size are one object (a cable drawn with its layers,
  // the two sides of a duct wall); a much smaller one inside is a separate object (a cable in its duct)
  type Ring = { c: P; d: number; inner: number[] };
  const byCentre: { c: P; ds: number[] }[] = [];
  for (const c of circlesRaw) {
    const p = toMm(c.c);
    const d = 2 * c.r * o.scale;
    const same = byCentre.find((g) => Math.hypot(g.c.x - p.x, g.c.y - p.y) < Math.max(0.5, d * 0.02));
    if (same) same.ds.push(d);
    else byCentre.push({ c: p, ds: [d] });
  }
  const rings: Ring[] = [];
  for (const g of byCentre) {
    const ds = [...g.ds].sort((a, b) => b - a);
    let cur: Ring | null = null;
    for (const d of ds) {
      if (cur && d >= 0.55 * cur.d) cur.inner.push(d);
      else {
        cur = { c: g.c, d, inner: [] };
        rings.push(cur);
      }
    }
  }
  const cables = rings.filter((r) => r.d <= o.cableMaxD);
  const bigs = rings.filter((r) => r.d > o.cableMaxD);
  const conduits = bigs
    .filter((r) => r.d <= 600)
    .map((r) => {
      const inner = r.inner.filter((d) => d >= 0.6 * r.d).sort((a, c) => c - a)[0];
      return { x: r.c.x, y: r.c.y, Do: r.d, Di: inner ?? Math.round(r.d * 0.9) };
    });
  const bores = bigs.filter((r) => r.d > 600).map((r) => ({ x: r.c.x, y: r.c.y, d: r.d }));

  // Circuits: cables inside conduits, cables in one-cable ducts, free cables
  const circuits: DxfCircuit[] = [];
  const inConduit = cables.map((c) => conduits.findIndex((k) => Math.hypot(k.x - c.c.x, k.y - c.c.y) + c.d / 2 <= k.Di / 2 + 1));
  const n = o.perCircuit;
  const ductOf: { cable: Ring; duct: (typeof conduits)[number] }[] = [];
  conduits.forEach((k, ki) => {
    const members = cables.filter((_, i) => inConduit[i] === ki);
    if (!members.length) return;
    if (members.length === 1 && n > 1) {
      ductOf.push({ cable: members[0], duct: k });
      return;
    }
    const groups = groupCables(members.map((m) => m.c), n);
    groups.forEach((g) => circuits.push({ cables: g, d: members[0].d, conduit: ki }));
    if (members.length % n) notes.push(`A conduit holds ${members.length} cables, not a multiple of ${n}; the rest are left out.`);
  });
  // Single cables in their own ducts: group the ducts into circuits
  if (ductOf.length) {
    const groups = groupCables(
      ductOf.map((x) => x.duct),
      n,
    );
    groups.forEach((g) => {
      const first = ductOf.find((x) => x.duct.x === g[0].x && x.duct.y === g[0].y)!;
      circuits.push({ cables: g, d: first.duct.Do, duct: { Do: first.duct.Do, Di: first.duct.Di } });
    });
  }
  const free = cables.filter((_, i) => inConduit[i] < 0);
  if (free.length) {
    const groups = groupCables(
      free.map((f) => f.c),
      n,
    );
    groups.forEach((g) => circuits.push({ cables: g, d: free[0].d }));
    if (free.length % n) notes.push(`${free.length % n} cable(s) could not be grouped into circuits of ${n} and were left out.`);
  }
  // Conduits that were only ducts of single cables are not shared conduits
  const ductSet = new Set(ductOf.map((x) => x.duct));
  const shared = conduits.filter((k) => !ductSet.has(k));
  const remap = conduits.map((k) => shared.indexOf(k));
  circuits.forEach((c) => {
    if (c.conduit !== undefined) c.conduit = remap[c.conduit];
  });

  // Regions
  const faces = extractFaces(segs, tol).map((f) => f.map(toMm));
  const totalArea = (b.x1 - b.x0) * (b.y1 - b.y0) * o.scale * o.scale;
  const regions: DxfRegion[] = [];
  faces.forEach((f, i) => {
    const area = Math.abs(polygonArea(f));
    const ys = f.map((p) => p.y);
    if (Math.max(...ys) <= 1) return; // entirely above the ground surface
    if (area > 0.85 * totalArea && faces.length > 1) return; // the frame of the drawing: native ground
    // Small closed outlines around a cable or conduit are drawn objects, not fill
    const insideCircle = rings.some((r) => f.every((p) => Math.hypot(p.x - r.c.x, p.y - r.c.y) <= r.d / 2 + 1));
    if (insideCircle) return;
    const label = texts.find((t) => pointInPolygon(toMm(t.p), f));
    const fromText = label ? materialFromText(label.text) : null;
    const holdsCable = circuits.some((c) => c.cables.some((p) => pointInPolygon(p, f)));
    const material: GroundMaterial = fromText?.material ?? (holdsCable ? 'sand' : 'clay');
    regions.push({
      points: f.map((p) => [+(p.x / 1000).toFixed(4), +(Math.max(0, p.y) / 1000).toFixed(4)] as [number, number]),
      material,
      rho: fromText?.rho,
      label: label?.text.slice(0, 40) || `${GROUND[material].label} ${i + 1}`,
      area,
    });
  });
  regions.sort((a, c) => c.area - a.area);
  if (!regions.length) notes.push('No closed regions were found; the drawing is shown as lines only.');
  return { regions, conduits: shared, bores, circuits, underlay, notes };
}

/**
 * Groups cable centres into circuits of n: start from the top-left cable not yet used and
 * take its n − 1 nearest neighbours.
 */
export function groupCables(pts: P[], n: number): P[][] {
  const left = pts.map((p) => p);
  const out: P[][] = [];
  if (n === 1) return left.map((p) => [p]);
  while (left.length >= n) {
    left.sort((a, b) => a.x - b.x || a.y - b.y);
    const first = left.shift()!;
    const near = [...left].sort((a, b) => Math.hypot(a.x - first.x, a.y - first.y) - Math.hypot(b.x - first.x, b.y - first.y)).slice(0, n - 1);
    near.forEach((p) => left.splice(left.indexOf(p), 1));
    out.push([first, ...near]);
  }
  return out;
}

/** Formation of a group of cables (mm, y down): centre, spacing, and how it lies. */
export function formationOf(cables: P[], d: number): { x: number; y: number; formation: 'trefoil' | 'flat'; rotated: boolean; spacing: number; touching: boolean } {
  const n = cables.length;
  const cx = cables.reduce((a, p) => a + p.x, 0) / n;
  const cy = cables.reduce((a, p) => a + p.y, 0) / n;
  if (n === 1) return { x: cx, y: cy, formation: 'trefoil', rotated: false, spacing: d, touching: true };
  const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
  const xs = cables.map((p) => p.x);
  const ys = cables.map((p) => p.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  if (n === 2) {
    const s = dist(cables[0], cables[1]);
    return { x: cx, y: cy, formation: 'flat', rotated: spanY > spanX, spacing: s, touching: s <= d * 1.06 };
  }
  const [a, b, c] = cables;
  const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  const ds = [dist(a, b), dist(b, c), dist(a, c)].sort((p, q) => p - q);
  if (area < 0.15 * ds[0] * ds[0]) {
    // In a row: spacing between neighbours
    const s = (ds[0] + ds[1]) / 2;
    const vertical = spanY > spanX;
    const mid = [...cables].sort((p, q) => (vertical ? p.y - q.y : p.x - q.x))[1];
    return { x: mid.x, y: mid.y, formation: 'flat', rotated: vertical, spacing: s, touching: s <= d * 1.06 };
  }
  const s = (ds[0] + ds[1] + ds[2]) / 3;
  // Point down when the lone cable lies below the other two
  const lone = cables.reduce((best, p) => (Math.abs(p.y - cy) > Math.abs(best.y - cy) ? p : best), cables[0]);
  return { x: cx, y: cy, formation: 'trefoil', rotated: lone.y > cy, spacing: s, touching: s <= d * 1.06 };
}
