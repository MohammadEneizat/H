import { describe, expect, it } from 'vitest';
import {
  applyDxfLayout,
  calculateRating,
  dxfDefaults,
  dxfToLayout,
  extractFaces,
  materialFromText,
  numericRating,
  parseDxf,
  polygonArea,
} from '../src/engine';
import { DEFAULT_INSTALLATION, tecsunCable } from '../src/engine/presets';
import { layoutFromInstallation } from '../src/engine/trench';
import { circle, dxf, line, lwpoly, pvTrench, text } from './dxfBuilder';

describe('DXF reading', () => {
  it('reads lines, polylines, circles, text and blocks', () => {
    const doc = parseDxf(pvTrench());
    expect(doc.insunits).toBe(4);
    expect(doc.entities.filter((e) => e.kind === 'circle')).toHaveLength(18);
    expect(doc.entities.filter((e) => e.kind === 'text')).toHaveLength(4);
    // the inserted block lands at its insertion point
    const blockCircles = doc.entities.filter((e) => e.kind === 'circle' && Math.abs(e.c.x - 225) < 20);
    expect(blockCircles).toHaveLength(4);
  });

  it('turns polyline bulges into arcs', () => {
    // 100 × 50 rectangle closed on top by a half circle of radius 50
    const doc = parseDxf(
      dxf(
        lwpoly(
          [
            [0, 0],
            [100, 0],
            [100, 50, 1],
            [0, 50],
          ],
          true,
        ),
      ),
    );
    const poly = doc.entities.find((e) => e.kind === 'poly')!;
    if (poly.kind !== 'poly') throw new Error();
    const exact = 100 * 50 + (Math.PI * 50 * 50) / 2;
    expect(Math.abs(Math.abs(polygonArea(poly.pts)) - exact) / exact).toBeLessThan(0.005);
  });

  it('finds the regions of separate lines that meet and cross', () => {
    // a box split by a line, plus a dangling line that closes nothing
    const segs = [
      line(0, 0, 100, 0),
      line(100, 0, 100, 100),
      line(100, 100, 0, 100),
      line(0, 100, 0, 0),
      line(-20, 40, 120, 40),
      line(50, 100, 50, 150),
    ].join('');
    const doc = parseDxf(dxf(segs));
    const faces = extractFaces(
      doc.entities.flatMap((e) => (e.kind === 'seg' ? [[e.a, e.b] as [typeof e.a, typeof e.b]] : [])),
      0.01,
    );
    const areas = faces.map((f) => Math.round(polygonArea(f))).sort((a, b) => a - b);
    expect(areas).toEqual([4000, 6000]);
  });

  it('reads materials and resistivities from labels', () => {
    expect(materialFromText('SAND BEDDING')?.material).toBe('sand');
    expect(materialFromText('Cement bound sand, 0.9 K.m/W')).toEqual({ material: 'cbs', rho: 0.9 });
    expect(materialFromText('Magerbeton')?.material).toBe('cbs');
    expect(materialFromText('Bentonite')?.material).toBe('bentonite');
    expect(materialFromText('C1')).toBeNull();
  });
});

describe('DXF trench to layout', () => {
  const doc = parseDxf(pvTrench());
  const d = dxfDefaults(doc);
  const layout = dxfToLayout(doc, { ...d, cableMaxD: 40, perCircuit: 2 }, 'pv');

  it('uses millimetres, the top line as ground and the middle as x = 0', () => {
    expect(d.scale).toBe(1);
    expect(d.groundY).toBe(0);
    expect(d.originX).toBe(0);
  });

  it('finds the bedding and backfill regions with their materials, and skips the frame', () => {
    expect(layout.regions).toHaveLength(2);
    const [backfill, bedding] = layout.regions;
    expect(backfill.material).toBe('clay');
    expect(backfill.rho).toBe(1.2);
    expect(backfill.area).toBeCloseTo(800 * 600, -2);
    expect(bedding.material).toBe('sand');
    expect(bedding.area).toBeCloseTo(800 * 400, -2);
  });

  it('groups the cable circles into DC pairs and keeps the empty conduit', () => {
    expect(layout.circuits).toHaveLength(4);
    layout.circuits.forEach((c) => {
      expect(c.cables).toHaveLength(2);
      expect(c.d).toBeCloseTo(27.8, 6);
      expect(c.cables[0].y).toBeCloseTo(800, 6);
    });
    expect(layout.conduits).toEqual([{ x: 250, y: 300, Do: 160, Di: 141 }]);
  });

  it('builds a layout that rates by IEC and by the numerical model', () => {
    const cable = tecsunCable(240);
    const base = { ...DEFAULT_INSTALLATION, type: 'trench' as const };
    const inst = applyDxfLayout({ ...base, trench: layoutFromInstallation(base) }, layout);
    expect(inst.circuits).toHaveLength(3);
    expect(inst.depth_m).toBeCloseTo(0.8, 6);
    expect(inst.touching).toBe(true);
    expect(inst.trench!.shapes).toHaveLength(2);
    expect(inst.trench!.underlay!.lines.length).toBeGreaterThan(20);
    const iec = calculateRating(cable, { ...inst, ratingMode: 'equal-current' });
    expect(iec.ok).toBe(true);
    const num = numericRating(cable, { ...inst, ratingMode: 'equal-current' }, iec)!;
    expect(num.result.ok).toBe(true);
    expect(Math.abs(num.result.I - iec.I) / iec.I).toBeLessThan(0.08);
  });

  it('recognises three-phase trefoils and single-cable ducts', () => {
    const r = 20;
    const h = (2 * r) / Math.sqrt(3);
    const tre = (x: number, y: number) => circle(x - r, y - h / 2, r) + circle(x + r, y - h / 2, r) + circle(x, y + h, r);
    const duct = (x: number, y: number) => circle(x, y, 55) + circle(x, y, 50) + circle(x, y, r);
    const e = line(-1000, 0, 1000, 0) + tre(0, -900) + duct(400, -900) + duct(510, -900) + duct(620, -900);
    const lay = dxfToLayout(parseDxf(dxf(e)), { scale: 1, groundY: 0, originX: 0, cableMaxD: 50, perCircuit: 3 });
    expect(lay.circuits).toHaveLength(2);
    const trefoil = lay.circuits.find((c) => !c.duct)!;
    expect(trefoil.cables).toHaveLength(3);
    const ducted = lay.circuits.find((c) => c.duct)!;
    expect(ducted.duct).toEqual({ Do: 110, Di: 100 });
    expect(lay.conduits).toHaveLength(0);
  });

  it('rejects binary DXF with a clear message', () => {
    expect(() => parseDxf('AutoCAD Binary DXF\r\n\u001a\u0000')).toThrow(/ASCII DXF/);
  });

  it('reads text labels from MTEXT and units from the header', () => {
    const doc2 = parseDxf(dxf(text(0, 0, 'x'), {}, 6));
    expect(dxfDefaults(doc2).scale).toBe(1000);
  });
});
