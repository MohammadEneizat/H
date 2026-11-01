// Numerical 2D steady-state thermal model of the ground around buried cables
// (finite volume on a non-uniform rectangular grid; see IEC TR 62095 for numerical
// methods in cable rating). Lengths in mm, resistivity in K·m/W, heat in W/m.
//
// The ground surface and the far boundaries are held at ambient. Each cable or duct is a
// highly conducting body, so its surface is nearly isothermal. One solve per cable gives
// the influence matrix F[p][k] (rise at body p per W/m in body k). A reference solve in
// uniform ground with only the heated body present, compared with the exact image
// solution, measures the grid and boundary error, which is then removed:
//   F = F_actual − ρref·(F_reference − F_exact)
// Neighbouring bodies stay in the actual solve, so the shielding between touching cables
// (which the IEC touching-group formulas allow for) is kept.

export interface NumObject {
  x: number;
  /** Depth of the centre below the surface (mm, positive down) */
  y: number;
  /** Outer radius of the cable or duct (mm) */
  r: number;
}

export interface NumInput {
  objects: NumObject[];
  /** Thermal resistivity of the ground at a point (mm); cables and ducts are handled separately */
  rhoAt: (x: number, y: number) => number;
  /** Material boundaries (mm) to align grid lines with */
  features?: { xs: number[]; ys: number[] };
  /** Grid cells per body radius near the bodies (default 5) */
  resolution?: number;
}

export interface NumericResult {
  /** Corrected influence matrix (K·m/W) */
  F: number[][];
  /** Influence matrix straight from the grid (K·m/W) */
  Fraw: number[][];
  /** Cell edges (mm) */
  xe: Float64Array;
  ye: Float64Array;
  nx: number;
  ny: number;
  /** Temperature rise per W/m in each body, at the cell centres */
  unit: Float64Array[];
  /** Index of the body covering each cell, or −1 */
  owner: Int32Array;
  objects: NumObject[];
  iterations: number;
  ms: number;
}

const K_BODY = 200; // W/(m·K): cables and ducts conduct far better than soil

function axis(lo: number, hi: number, fine: { c: number; half: number; h: number }[], features: number[]): Float64Array {
  const growth = 0.24;
  const hmax = 700;
  const h = (p: number) => {
    let v = hmax;
    for (const f of fine) {
      const d = Math.max(0, Math.abs(p - f.c) - f.half);
      v = Math.min(v, f.h + growth * d);
    }
    return v;
  };
  const lines: { p: number; feature: boolean }[] = [];
  for (let p = lo; p < hi; ) {
    lines.push({ p, feature: false });
    const step = h(p + h(p) / 2);
    p += step;
  }
  lines.push({ p: hi, feature: true });
  lines[0].feature = true;
  for (const f of features) if (f > lo + 1e-6 && f < hi - 1e-6) lines.push({ p: f, feature: true });
  for (const f of fine) {
    for (const q of [f.c - f.half, f.c + f.half]) if (q > lo && q < hi) lines.push({ p: q, feature: true });
  }
  lines.sort((a, b) => a.p - b.p);
  const kept: { p: number; feature: boolean }[] = [];
  for (const l of lines) {
    const last = kept[kept.length - 1];
    if (!last) {
      kept.push(l);
      continue;
    }
    const gap = l.p - last.p;
    if (l.feature && last.feature) {
      if (gap > 0.5) kept.push(l); // keep both material boundaries (thin tiles)
      continue;
    }
    if (gap < 0.4 * h(l.p)) {
      if (l.feature && kept.length > 1) kept[kept.length - 1] = l;
      continue;
    }
    kept.push(l);
  }
  return Float64Array.from(kept.map((l) => l.p));
}

interface Matrix {
  n: number;
  nx: number;
  diag: Float64Array;
  /** Conductance to the east neighbour (i+1) */
  e: Float64Array;
  /** Conductance to the south neighbour (j+1, deeper) */
  s: Float64Array;
  /** Incomplete Cholesky diagonal */
  dt: Float64Array;
}

/**
 * Assembles the conductance matrix. Where two different bodies touch, heat passes between
 * them through the ground resistivity (kGap), not through the bodies' high conductivity:
 * touching cables meet only along a line, through their oversheaths.
 */
function assemble(xe: Float64Array, ye: Float64Array, k: Float64Array, owner?: Int32Array, kGap?: Float64Array): Matrix {
  const nx = xe.length - 1;
  const ny = ye.length - 1;
  const n = nx * ny;
  const diag = new Float64Array(n);
  const e = new Float64Array(n);
  const s = new Float64Array(n);
  for (let j = 0; j < ny; j++) {
    const dy = ye[j + 1] - ye[j];
    for (let i = 0; i < nx; i++) {
      const idx = j * nx + i;
      const dx = xe[i + 1] - xe[i];
      const kk = k[idx];
      const split = (nb: number) => !!owner && owner[idx] >= 0 && owner[nb] >= 0 && owner[idx] !== owner[nb];
      if (i < nx - 1) {
        const dx2 = xe[i + 2] - xe[i + 1];
        const g = split(idx + 1)
          ? dy / (dx / (2 * kGap![idx]) + dx2 / (2 * kGap![idx + 1]))
          : dy / (dx / (2 * kk) + dx2 / (2 * k[idx + 1]));
        e[idx] = g;
        diag[idx] += g;
        diag[idx + 1] += g;
      }
      if (j < ny - 1) {
        const dy2 = ye[j + 2] - ye[j + 1];
        const g = split(idx + nx)
          ? dx / (dy / (2 * kGap![idx]) + dy2 / (2 * kGap![idx + nx]))
          : dx / (dy / (2 * kk) + dy2 / (2 * k[idx + nx]));
        s[idx] = g;
        diag[idx] += g;
        diag[idx + nx] += g;
      }
      // Fixed (ambient) temperature on all four outer boundaries
      if (i === 0 || i === nx - 1) diag[idx] += dy / (dx / (2 * kk));
      if (j === 0 || j === ny - 1) diag[idx] += dx / (dy / (2 * kk));
    }
  }
  const dt = new Float64Array(n);
  for (let idx = 0; idx < n; idx++) {
    let d = diag[idx];
    if (idx % nx > 0) d -= (e[idx - 1] * e[idx - 1]) / dt[idx - 1];
    if (idx >= nx) d -= (s[idx - nx] * s[idx - nx]) / dt[idx - nx];
    dt[idx] = d;
  }
  return { n, nx, diag, e, s, dt };
}

function multiply(A: Matrix, x: Float64Array, out: Float64Array) {
  const { n, nx, diag, e, s } = A;
  for (let idx = 0; idx < n; idx++) {
    let v = diag[idx] * x[idx];
    if (idx % nx < nx - 1) v -= e[idx] * x[idx + 1];
    if (idx % nx > 0) v -= e[idx - 1] * x[idx - 1];
    if (idx + nx < n) v -= s[idx] * x[idx + nx];
    if (idx >= nx) v -= s[idx - nx] * x[idx - nx];
    out[idx] = v;
  }
}

function precondition(A: Matrix, r: Float64Array, z: Float64Array) {
  const { n, nx, e, s, dt } = A;
  for (let idx = 0; idx < n; idx++) {
    let v = r[idx];
    if (idx % nx > 0) v += e[idx - 1] * z[idx - 1];
    if (idx >= nx) v += s[idx - nx] * z[idx - nx];
    z[idx] = v / dt[idx];
  }
  for (let idx = n - 1; idx >= 0; idx--) {
    let v = 0;
    if (idx % nx < nx - 1) v += e[idx] * z[idx + 1];
    if (idx + nx < n) v += s[idx] * z[idx + nx];
    z[idx] += v / dt[idx];
  }
}

/** Preconditioned conjugate gradients with an incomplete Cholesky preconditioner. */
function solve(A: Matrix, b: Float64Array, tol = 1e-10, maxIt = 4000): { x: Float64Array; it: number } {
  const n = A.n;
  const x = new Float64Array(n);
  const r = Float64Array.from(b);
  const z = new Float64Array(n);
  const p = new Float64Array(n);
  const Ap = new Float64Array(n);
  precondition(A, r, z);
  p.set(z);
  let rz = 0;
  let bn = 0;
  for (let i = 0; i < n; i++) {
    rz += r[i] * z[i];
    bn += b[i] * b[i];
  }
  bn = Math.sqrt(bn) || 1;
  let it = 0;
  for (it = 1; it <= maxIt; it++) {
    multiply(A, p, Ap);
    let pAp = 0;
    for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
    const alpha = rz / pAp;
    let rn = 0;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * Ap[i];
      rn += r[i] * r[i];
    }
    if (Math.sqrt(rn) < tol * bn) break;
    precondition(A, r, z);
    let rzNew = 0;
    for (let i = 0; i < n; i++) rzNew += r[i] * z[i];
    const beta = rzNew / rz;
    rz = rzNew;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
  }
  return { x, it };
}

/** Exact rise at body p per W/m in body k for uniform ground of resistivity 1 (image method). */
export function exactInfluence(objects: NumObject[], p: number, k: number): number {
  const a = objects[p];
  const b = objects[k];
  if (p === k) return Math.acosh(a.y / a.r) / (2 * Math.PI);
  return Math.log(Math.hypot(a.x - b.x, a.y + b.y) / Math.hypot(a.x - b.x, a.y - b.y)) / (2 * Math.PI);
}

export function solveNumeric(input: NumInput): NumericResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { objects, rhoAt } = input;
  const N = objects.length;
  const maxDepth = Math.max(...objects.map((o) => o.y + o.r), 500);
  const xs = objects.map((o) => o.x);
  const spread = Math.max(...xs) - Math.min(...xs);
  const half = Math.max(8000, 4 * maxDepth, spread / 2 + 5000);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const depth = Math.max(8000, 4 * maxDepth);
  const res = input.resolution ?? 5;
  const fx = objects.map((o) => ({ c: o.x, half: o.r * 1.15, h: o.r / res }));
  const fy = objects.map((o) => ({ c: o.y, half: o.r * 1.15, h: o.r / res }));
  const xe = axis(cx - half, cx + half, fx, input.features?.xs ?? []);
  const ye = axis(0, depth, [...fy, { c: 0, half: 0, h: 60 }], input.features?.ys ?? []);
  const nx = xe.length - 1;
  const ny = ye.length - 1;
  const n = nx * ny;

  const owner = new Int32Array(n).fill(-1);
  const kAct = new Float64Array(n);
  const kGround = new Float64Array(n);
  const area = new Float64Array(n);
  const bodyArea = new Float64Array(N);
  for (let j = 0; j < ny; j++) {
    const yc = (ye[j] + ye[j + 1]) / 2;
    for (let i = 0; i < nx; i++) {
      const idx = j * nx + i;
      const xc = (xe[i] + xe[i + 1]) / 2;
      area[idx] = (xe[i + 1] - xe[i]) * (ye[j + 1] - ye[j]);
      let o = -1;
      for (let q = 0; q < N; q++) {
        const ob = objects[q];
        if ((xc - ob.x) ** 2 + (yc - ob.y) ** 2 <= ob.r * ob.r) {
          o = q;
          break;
        }
      }
      owner[idx] = o;
      kGround[idx] = 1 / rhoAt(xc, yc);
      if (o >= 0) {
        kAct[idx] = K_BODY;
        bodyArea[o] += area[idx];
      } else {
        kAct[idx] = kGround[idx];
      }
    }
  }
  if ([...bodyArea].some((a) => a === 0)) throw new Error('A cable is smaller than the numerical grid.');

  const Aact = assemble(xe, ye, kAct, owner, kGround);
  const meanOver = (T: Float64Array, q: number) => {
    let s = 0;
    for (let idx = 0; idx < n; idx++) if (owner[idx] === q) s += T[idx] * area[idx];
    return s / bodyArea[q];
  };
  const unit: Float64Array[] = [];
  const Fraw: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
  const Fu: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
  let iterations = 0;
  for (let k = 0; k < N; k++) {
    const b = new Float64Array(n);
    for (let idx = 0; idx < n; idx++) if (owner[idx] === k) b[idx] = area[idx] / bodyArea[k];
    const act = solve(Aact, b);
    // Reference: uniform ground (ρ = 1) with only body k present
    const kRef = new Float64Array(n);
    for (let idx = 0; idx < n; idx++) kRef[idx] = owner[idx] === k ? K_BODY : 1;
    const uni = solve(assemble(xe, ye, kRef), b);
    iterations += act.it + uni.it;
    unit.push(act.x);
    for (let p = 0; p < N; p++) {
      Fraw[p][k] = meanOver(act.x, p);
      Fu[p][k] = meanOver(uni.x, p);
    }
  }
  const rhoRef = objects.map((o) => {
    const pts = [
      [o.x + 1.3 * o.r, o.y],
      [o.x - 1.3 * o.r, o.y],
      [o.x, o.y + 1.3 * o.r],
      [o.x, Math.max(1, o.y - 1.3 * o.r)],
    ];
    return pts.reduce((a, [x, y]) => a + rhoAt(x, y), 0) / pts.length;
  });
  const F = Fraw.map((row, p) => row.map((v, k) => v - rhoRef[k] * (Fu[p][k] - exactInfluence(objects, p, k))));
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { F, Fraw, xe, ye, nx, ny, unit, owner, objects, iterations, ms: t1 - t0 };
}

/** Temperature field (°C) from the numerical solution for given losses W (W/m per body). */
export function numericField(res: NumericResult, W: number[], thetaA: number): (x: number, y: number) => number {
  const { xe, ye, nx, ny, unit, objects } = res;
  const n = nx * ny;
  const T = new Float64Array(n);
  unit.forEach((u, k) => {
    const w = W[k];
    for (let idx = 0; idx < n; idx++) T[idx] += w * u[idx];
  });
  const xc = new Float64Array(nx);
  const yc = new Float64Array(ny);
  for (let i = 0; i < nx; i++) xc[i] = (xe[i] + xe[i + 1]) / 2;
  for (let j = 0; j < ny; j++) yc[j] = (ye[j] + ye[j + 1]) / 2;
  const find = (arr: Float64Array, v: number) => {
    let lo = 0;
    let hi = arr.length - 1;
    if (v <= arr[0]) return 0;
    if (v >= arr[hi]) return hi - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= v) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  return (x: number, y: number) => {
    if (y < 0) return NaN;
    for (const o of objects) if ((x - o.x) ** 2 + (y - o.y) ** 2 < o.r * o.r) return NaN;
    if (y < yc[0]) {
      // between the surface (ambient) and the first cell centre
      const i = find(xc, x);
      const f = Math.min(1, Math.max(0, (x - xc[i]) / (xc[i + 1] - xc[i])));
      const top = T[i] * (1 - f) + T[i + 1] * f;
      return thetaA + top * (y / yc[0]);
    }
    const i = find(xc, x);
    const j = find(yc, y);
    const fx = Math.min(1, Math.max(0, (x - xc[i]) / (xc[i + 1] - xc[i])));
    const fy = Math.min(1, Math.max(0, (y - yc[j]) / (yc[j + 1] - yc[j])));
    const a = T[j * nx + i];
    const b = T[j * nx + i + 1];
    const c = T[(j + 1) * nx + i];
    const d = T[(j + 1) * nx + i + 1];
    return thetaA + (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
}
