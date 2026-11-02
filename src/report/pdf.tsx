// PDF report: A4, generated in the browser with jsPDF (loaded on demand from cdnjs).
import React from 'react';
import {
  numericRating,
  sweepRating,
  type CableSpec,
  type InstallationSpec,
  type RatingResult,
} from '../engine';
import {
  AirSvg,
  CableSectionSvg,
  InstallationDetailSvg,
  InstallationOverviewSvg,
  buildScene,
  cableLayers,
  heatScaleColor,
  sceneHeat,
} from '../ui/Drawing';
import { amps, fmt } from '../ui/format';
import { PALETTES } from '../ui/theme';
import { svgMarkup, svgToPng } from './render';
import { calcSections, inputSections, summaryChips } from './sections';
import type { NumericData } from '../ui/useNumeric';
import { TrenchSvg, trenchHeat, trenchScene, type TrenchScene } from '../ui/TrenchEditor';

const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const FONT_REGULAR = 'fonts/DejaVuSans-subset.ttf';
const FONT_BOLD = 'fonts/DejaVuSans-Bold-subset.ttf';
const F = 'DejaVu';

const COL = {
  ink: '#142029',
  ink2: '#485662',
  ink3: '#66737f',
  accent: '#a24f1c',
  line: '#d4dbe2',
  line2: '#e5eaee',
  panel: '#f5f7f9',
  soft: '#f6e5d9',
  bad: '#ad3535',
  ok: '#2b7a4e',
};

// jsPDF is loaded at run time from a CDN, so it is typed loosely here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = any;

let jsPdfPromise: Promise<new (opts: object) => Doc> | null = null;

function loadJsPdf(): Promise<new (opts: object) => Doc> {
  const w = window as unknown as { jspdf?: { jsPDF: new (opts: object) => Doc } };
  if (w.jspdf?.jsPDF) return Promise.resolve(w.jspdf.jsPDF);
  if (!jsPdfPromise) {
    jsPdfPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = JSPDF_URL;
      s.async = true;
      s.onload = () => (w.jspdf?.jsPDF ? resolve(w.jspdf.jsPDF) : reject(new Error('The PDF library did not load.')));
      s.onerror = () => {
        jsPdfPromise = null;
        reject(new Error('Could not load the PDF library. Check the internet connection and try again.'));
      };
      document.head.appendChild(s);
    });
  }
  return jsPdfPromise;
}

async function fontBase64(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not load the report font (${path}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Round ticks that cover [min, max] (first ≤ min, last ≥ max). */
function niceScale(min: number, max: number, count = 4): number[] {
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

const pt2mm = (pt: number) => pt * 0.3528;

/** Small layout helper on top of jsPDF: a cursor, page breaks and tables. */
class Writer {
  doc: Doc;
  x0 = 16;
  x1 = 194;
  top = 16;
  bottom = 280;
  y = 16;
  constructor(doc: Doc) {
    this.doc = doc;
    doc.setLineHeightFactor(1.25);
  }
  get width() {
    return this.x1 - this.x0;
  }
  font(size: number, bold = false, color = COL.ink) {
    this.doc.setFont(F, bold ? 'bold' : 'normal');
    this.doc.setFontSize(size);
    this.doc.setTextColor(color);
  }
  newPage() {
    this.doc.addPage();
    this.y = this.top;
  }
  ensure(h: number) {
    if (this.y + h > this.bottom) this.newPage();
  }
  heading(text: string) {
    this.ensure(16);
    this.y += 2;
    this.font(12, true);
    this.doc.text(text, this.x0, this.y, { baseline: 'top' });
    this.y += 6.2;
    this.doc.setDrawColor(COL.accent);
    this.doc.setLineWidth(0.5);
    this.doc.line(this.x0, this.y, this.x0 + 14, this.y);
    this.y += 3.5;
  }
  /** Height of a table of single-line rows. */
  tableHeight(rows: number, size = 7.8) {
    return (rows + 1) * (pt2mm(size) * 1.25 + 2.6) + 4;
  }
  subheading(text: string, keepWith = 0) {
    this.ensure(keepWith > 0 && keepWith < 120 ? keepWith + 6 : 12);
    this.font(8, true, COL.ink2);
    this.doc.text(text.toUpperCase(), this.x0, this.y, { baseline: 'top', charSpace: 0.25 });
    this.y += 4.6;
  }
  para(text: string, size = 8.5, color = COL.ink2, indent = 0) {
    this.font(size, false, color);
    const lines: string[] = this.doc.splitTextToSize(text, this.width - indent);
    const lh = pt2mm(size) * 1.25;
    this.ensure(lines.length * lh);
    this.doc.text(lines, this.x0 + indent, this.y, { baseline: 'top' });
    this.y += lines.length * lh + 1.6;
  }
  bullets(items: { tag: string; text: string; color: string }[], size = 8) {
    for (const it of items) {
      this.font(size, false, COL.ink2);
      const lines: string[] = this.doc.splitTextToSize(it.text, this.width - 18);
      const lh = pt2mm(size) * 1.25;
      this.ensure(lines.length * lh + 1.5);
      this.font(6.5, true, it.color);
      this.doc.text(it.tag.toUpperCase(), this.x0, this.y + 0.3, { baseline: 'top' });
      this.font(size, false, COL.ink2);
      this.doc.text(lines, this.x0 + 18, this.y, { baseline: 'top' });
      this.y += lines.length * lh + 1.6;
    }
  }
  table(
    cols: { head: string; w: number; align?: 'left' | 'right'; bold?: boolean; color?: string }[],
    rows: string[][],
    opts: { size?: number; highlight?: (i: number) => boolean } = {},
  ) {
    const size = opts.size ?? 7.8;
    const lh = pt2mm(size) * 1.25;
    const pad = 1.3;
    const doc = this.doc;
    const drawHead = () => {
      let x = this.x0;
      this.font(size - 0.8, true, COL.ink3);
      for (const c of cols) {
        const right = c.align === 'right';
        doc.text(c.head, right ? x + c.w - pad : x + pad, this.y + pad, { baseline: 'top', align: right ? 'right' : 'left' });
        x += c.w;
      }
      this.y += lh + 2 * pad;
      doc.setDrawColor(COL.line);
      doc.setLineWidth(0.25);
      doc.line(this.x0, this.y, this.x0 + cols.reduce((a, c) => a + c.w, 0), this.y);
    };
    this.ensure(lh * 3 + 4 * pad);
    drawHead();
    rows.forEach((row, i) => {
      const cells = row.map((text, j) => {
        this.font(size, !!cols[j].bold);
        return doc.splitTextToSize(text ?? '', cols[j].w - 2 * pad) as string[];
      });
      const h = Math.max(...cells.map((c) => c.length)) * lh + 2 * pad;
      if (this.y + h > this.bottom) {
        this.newPage();
        drawHead();
      }
      const totalW = cols.reduce((a, c) => a + c.w, 0);
      if (opts.highlight?.(i)) {
        doc.setFillColor(COL.soft);
        doc.rect(this.x0, this.y, totalW, h, 'F');
      }
      let x = this.x0;
      cells.forEach((lines, j) => {
        const c = cols[j];
        const right = c.align === 'right';
        this.font(size, !!c.bold, c.color ?? (j === 0 ? COL.ink2 : COL.ink));
        doc.text(lines, right ? x + c.w - pad : x + pad, this.y + pad, { baseline: 'top', align: right ? 'right' : 'left' });
        x += c.w;
      });
      this.y += h;
      doc.setDrawColor(COL.line2);
      doc.setLineWidth(0.15);
      doc.line(this.x0, this.y, this.x0 + totalW, this.y);
    });
    this.y += 3.5;
  }
}

function lineChart(
  w: Writer,
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  xLabel: string,
  data: { x: number; I: number }[],
  current: { x: number; I: number } | null,
  digits: number,
) {
  const doc = w.doc;
  const pts = data.filter((d) => Number.isFinite(d.I));
  w.font(8, true);
  doc.text(title, x, y, { baseline: 'top' });
  if (pts.length < 2) return;
  const px0 = x + 11;
  const px1 = x + width - 2;
  const py0 = y + 7;
  const py1 = y + height - 9;
  const Is = pts.map((p) => p.I).concat(current ? [current.I] : []);
  const pad = (Math.max(...Is) - Math.min(...Is)) * 0.08 || 10;
  const yTicks = niceScale(Math.max(0, Math.min(...Is) - pad), Math.max(...Is) + pad, 4);
  const y0 = yTicks[0];
  const y1 = yTicks[yTicks.length - 1];
  const x0 = pts[0].x;
  const x1 = pts[pts.length - 1].x;
  const sx = (v: number) => px0 + ((v - x0) / (x1 - x0)) * (px1 - px0);
  const sy = (v: number) => py1 - ((v - y0) / (y1 - y0)) * (py1 - py0);
  doc.setLineWidth(0.15);
  doc.setDrawColor(COL.line2);
  w.font(6.5, false, COL.ink3);
  for (const t of yTicks) {
    doc.line(px0, sy(t), px1, sy(t));
    doc.text(amps(t), px0 - 1.5, sy(t), { baseline: 'middle', align: 'right' });
  }
  for (const t of niceTicks(x0, x1, 5)) {
    doc.text(Number(t.toFixed(digits)).toLocaleString('en-GB'), sx(t), py1 + 1.8, { baseline: 'top', align: 'center' });
  }
  doc.text(xLabel, px1, py1 + 5.6, { baseline: 'top', align: 'right' });
  doc.text('A', x, py0 - 0.5, { baseline: 'bottom' });
  // area
  const first = [sx(pts[0].x), sy(pts[0].I)];
  const segs: number[][] = [];
  for (let i = 1; i < pts.length; i++) segs.push([sx(pts[i].x) - sx(pts[i - 1].x), sy(pts[i].I) - sy(pts[i - 1].I)]);
  const GState = doc.GState;
  if (GState) doc.setGState(new GState({ opacity: 0.12 }));
  doc.setFillColor(COL.accent);
  doc.lines([...segs, [0, py1 - sy(pts[pts.length - 1].I)], [sx(x0) - sx(x1), 0]], first[0], first[1], [1, 1], 'F', true);
  if (GState) doc.setGState(new GState({ opacity: 1 }));
  doc.setDrawColor(COL.accent);
  doc.setLineWidth(0.5);
  doc.lines(segs, first[0], first[1], [1, 1], 'S', false);
  if (current && current.x >= x0 && current.x <= x1) {
    doc.setDrawColor(COL.ink3);
    doc.setLineWidth(0.2);
    doc.line(sx(current.x), py0, sx(current.x), py1);
    doc.setFillColor('#ffffff');
    doc.circle(sx(current.x), sy(current.I), 1.5, 'F');
    doc.setFillColor(COL.accent);
    doc.circle(sx(current.x), sy(current.I), 1.05, 'F');
    w.font(6.8, true);
    const right = sx(current.x) > x + width * 0.65;
    doc.text(`${amps(current.I)} A`, sx(current.x) + (right ? -2.4 : 2.4), sy(current.I) - 2.2, {
      baseline: 'bottom',
      align: right ? 'right' : 'left',
    });
  }
}

export interface ReportInput {
  cable: CableSpec;
  inst: InstallationSpec;
  result: RatingResult;
  /** Numerical model result for a trench layout, if available */
  numeric?: NumericData | null;
}

/** Builds the PDF report and returns it as a Blob. */
export async function buildPdfReport({ cable, inst, result: r, numeric }: ReportInput): Promise<Blob> {
  if (!r.ok) throw new Error('Complete the inputs so the rating can be calculated first.');
  const [JsPDF, regular, bold] = await Promise.all([loadJsPdf(), fontBase64(FONT_REGULAR), fontBase64(FONT_BOLD)]);
  const doc: Doc = new JsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('DejaVuSans.ttf', regular);
  doc.addFont('DejaVuSans.ttf', F, 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', bold);
  doc.addFont('DejaVuSans-Bold.ttf', F, 'bold');
  doc.setProperties({ title: `Current rating – ${cable.name}`, subject: 'IEC 60287 current rating', creator: 'Ampacity Workbench' });

  const w = new Writer(doc);
  const now = new Date();
  const stamp = now.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const pal = PALETTES.light;

  // ---- Figures (light palette) ----
  const cableFig = svgMarkup(<CableSectionSvg cable={cable} g={r.geometry} pal={pal} idPrefix="rc" />);
  const cablePng = await svgToPng(cableFig.markup, 1, 1000);
  let overviewPng: { png: string; aspect: number } | null = null;
  let detailPng: { png: string; aspect: number } | null = null;
  let airPng: { png: string; aspect: number } | null = null;
  const isTrench = inst.type === 'trench';
  let numData: NumericData | null = numeric ?? null;
  if (isTrench && !numData) {
    const out = numericRating(cable, inst, r);
    if (out && out.result.ok) numData = { ...out, key: '' };
  }
  let trenchPng: { png: string; aspect: number } | null = null;
  let trenchSc: TrenchScene | null = null;
  if (isTrench) {
    trenchSc = trenchScene(cable, inst, r, numData ? { status: 'ready', data: numData, fresh: true } : null, pal);
    if (trenchSc) {
      const heat = trenchHeat(trenchSc, pal);
      const tf = svgMarkup(<TrenchSvg inst={inst} scene={trenchSc} heat={heat} pal={pal} idPrefix="rt" showHeat />);
      trenchPng = { png: await svgToPng(tf.markup, tf.height / tf.width, 1800), aspect: tf.height / tf.width };
    }
  }
  const scene = inst.type === 'air' || isTrench ? null : buildScene(cable, inst, r, pal);
  if (scene) {
    const heat = sceneHeat(scene, r, pal);
    const ov = svgMarkup(<InstallationOverviewSvg scene={scene} heat={heat.overview} pal={pal} idPrefix="ro" inst={inst} />);
    const dt = svgMarkup(<InstallationDetailSvg scene={scene} heat={heat.detail} pal={pal} idPrefix="rd" inst={inst} />);
    overviewPng = { png: await svgToPng(ov.markup, ov.height / ov.width, 1000), aspect: ov.height / ov.width };
    detailPng = { png: await svgToPng(dt.markup, dt.height / dt.width, 1600), aspect: dt.height / dt.width };
  } else if (inst.type === 'air') {
    const air = svgMarkup(<AirSvg cable={cable} inst={inst} result={r} pal={pal} idPrefix="ra" />);
    airPng = { png: await svgToPng(air.markup, air.height / air.width, 1400), aspect: air.height / air.width };
  }

  // ---- Page 1: title, result, circuits, drawings ----
  w.font(7, true, COL.ink3);
  doc.text('AMPACITY WORKBENCH', w.x0, w.y, { baseline: 'top', charSpace: 0.4 });
  w.font(7, false, COL.ink3);
  doc.text(`IEC 60287 current rating report · ${stamp}`, w.x1, w.y, { baseline: 'top', align: 'right' });
  w.y += 7;
  w.font(15, true);
  const titleLines: string[] = doc.splitTextToSize(cable.name, w.width);
  doc.text(titleLines, w.x0, w.y, { baseline: 'top' });
  w.y += titleLines.length * pt2mm(15) * 1.25 + 3;

  // Result box
  const boxY = w.y;
  const boxH = 34;
  doc.setFillColor(COL.panel);
  doc.rect(w.x0, boxY, w.width, boxH, 'F');
  doc.setFillColor(COL.accent);
  doc.rect(w.x0, boxY, w.width, 0.9, 'F');
  w.font(6.8, true, COL.ink3);
  doc.text(
    (r.system && r.system.circuits.length > 1 ? 'MAIN CIRCUIT C1 · PERMISSIBLE CURRENT PER PHASE' : 'PERMISSIBLE CURRENT PER PHASE'),
    w.x0 + 5,
    boxY + 4.5,
    { baseline: 'top', charSpace: 0.3 },
  );
  w.font(30, true);
  const big = amps(r.I);
  doc.text(big, w.x0 + 5, boxY + 9, { baseline: 'top' });
  const bigW = doc.getTextWidth(big);
  w.font(14, false, COL.ink2);
  doc.text('A', w.x0 + 6.5 + bigW, boxY + 15.2, { baseline: 'top' });
  w.font(7.5, false, COL.ink2);
  const sub: string[] = doc.splitTextToSize(
    `${r.governingCase} · conductor at ${fmt(r.temperatures.conductor, 1)} °C · 100 % load factor`,
    90,
  );
  doc.text(sub, w.x0 + 5, boxY + 22.5, { baseline: 'top' });
  // key figures on the right
  const kv: [string, string][] = [
    ['Temperatures θc / θs / θe', `${fmt(r.temperatures.conductor, 1)} / ${fmt(r.temperatures.sheath, 1)} / ${fmt(r.temperatures.surface, 1)} °C`],
    ['AC resistance R', `${fmt(r.conductor.R * 1000, 4)} Ω/km`],
    ['Screen loss factor λ1', fmt(r.sheath.lambda1, 4)],
    r.geometry.cores === 3 ? ['Heat per cable n·W', `${fmt(3 * r.losses.W, 2)} W/m`] : ['Heat per cable W', `${fmt(r.losses.W, 2)} W/m`],
    ...(numData && numData.result.ok
      ? ([['Numerical 2D model', `${amps(numData.result.I)} A (${numData.result.I >= r.I ? '+' : '−'}${fmt(Math.abs((numData.result.I / r.I - 1) * 100), 1)} %)`]] as [string, string][])
      : []),
    [inst.type === 'air' ? 'External T4*' : 'External T4', `${fmt(r.thermal.t4.T4, 4)} K·m/W`],
  ];
  kv.forEach(([k, v], i) => {
    w.font(7, false, COL.ink3);
    doc.text(k, w.x0 + 104, boxY + 5 + i * 5.4, { baseline: 'top' });
    w.font(7.5, true);
    doc.text(v, w.x1 - 4, boxY + 5 + i * 5.4, { baseline: 'top', align: 'right' });
  });
  w.y = boxY + boxH + 3;
  w.font(7.2, false, COL.ink2);
  doc.text(summaryChips(inst, r).join('   ·   '), w.x0, w.y, { baseline: 'top', maxWidth: w.width });
  w.y += 7;

  if (r.system && r.system.circuits.length > 1) {
    w.heading('All circuits');
    w.table(
      [
        { head: 'Circuit', w: 18, bold: true },
        { head: 'Cable', w: 54 },
        { head: 'Load', w: 14 },
        { head: 'Current', w: 18, align: 'right' },
        { head: 'Hottest', w: 22, align: 'right' },
        { head: 'Heat/cable', w: 20, align: 'right' },
        { head: 'From others', w: 18, align: 'right' },
        { head: 'Status', w: 14 },
      ],
      r.system.circuits.map((c) => {
        const atLimit = Math.abs(c.hottestTemp - c.maxTemp) < 0.05;
        const over = !atLimit && c.hottestTemp > c.maxTemp;
        return [
          c.name,
          c.cableName.replace(/^Example: /, ''),
          c.load === 'rated' ? 'Rated' : 'Fixed',
          `${amps(c.I)} A`,
          `${fmt(c.hottestTemp, 1)} / ${fmt(c.maxTemp, 0)} °C`,
          `${fmt(c.W * (c.cores === 3 ? 3 : 1), 1)} W/m`,
          `+${fmt(c.mutualRise, 1)} K`,
          over ? 'Over' : atLimit ? 'At limit' : 'OK',
        ];
      }),
      { size: 7.2, highlight: (i) => i === 0 },
    );
    w.para(
      r.system.mode === 'equal-current'
        ? 'Rated circuits carry the same current, limited by the hottest one. Fixed circuits carry their set load.'
        : 'Each rated circuit is loaded to its own temperature limit. Fixed circuits carry their set load.',
      7.2,
    );
  }

  // Drawings
  w.heading('Cable and installation');
  const cableSize = 58;
  w.ensure(cableSize + 4);
  const figTop = w.y;
  doc.addImage(cablePng, 'PNG', w.x0, figTop, cableSize, cableSize);
  let ky = figTop + 1;
  for (const l of cableLayers(cable, r.geometry)) {
    doc.setDrawColor(COL.ink2);
    doc.setLineWidth(0.2);
    doc.circle(w.x0 + cableSize + 8, ky + 1.9, 1.9, 'S');
    w.font(6.5, true);
    doc.text(String(l.n), w.x0 + cableSize + 8, ky + 1.95, { baseline: 'middle', align: 'center' });
    w.font(7.6, true);
    doc.text(l.name, w.x0 + cableSize + 12, ky, { baseline: 'top' });
    w.font(7, false, COL.ink3);
    doc.text(l.detail, w.x0 + cableSize + 12, ky + 3.4, { baseline: 'top', maxWidth: w.x1 - (w.x0 + cableSize + 12) });
    ky += 8;
  }
  w.y = Math.max(figTop + cableSize, ky) + 4;

  if (overviewPng && detailPng && scene) {
    const gap = 4;
    const ovW = 66;
    const dtW = w.width - ovW - gap;
    const h = Math.min(Math.max(ovW * overviewPng.aspect, dtW * detailPng.aspect), 70);
    w.ensure(h + 22);
    const ovH = Math.min(h, ovW * overviewPng.aspect);
    const dtH = Math.min(h, dtW * detailPng.aspect);
    doc.addImage(overviewPng.png, 'PNG', w.x0, w.y, ovH / overviewPng.aspect, ovH);
    doc.addImage(detailPng.png, 'PNG', w.x0 + ovW + gap, w.y, dtH / detailPng.aspect, dtH);
    doc.setDrawColor(COL.line);
    doc.setLineWidth(0.2);
    doc.rect(w.x0, w.y, ovH / overviewPng.aspect, ovH, 'S');
    doc.rect(w.x0 + ovW + gap, w.y, dtH / detailPng.aspect, dtH, 'S');
    w.y += Math.max(ovH, dtH) + 4;
    if (scene.heat) {
      const { tMin, tMax, levels } = scene.heat;
      const lw = 110;
      w.font(7, false, COL.ink2);
      doc.text('Ground temperature at the rated current, °C', w.x0, w.y, { baseline: 'top' });
      w.y += 3.8;
      const n = 80;
      for (let i = 0; i < n; i++) {
        doc.setFillColor(heatScaleColor(pal, (i + 0.5) / n));
        doc.rect(w.x0 + (lw * i) / n, w.y, lw / n + 0.05, 3, 'F');
      }
      doc.setDrawColor(COL.line);
      doc.rect(w.x0, w.y, lw, 3, 'S');
      w.font(6.3, false, COL.ink3);
      for (const t of [tMin, ...levels, tMax]) {
        const x = w.x0 + ((t - tMin) / (tMax - tMin)) * lw;
        doc.text(fmt(t, t % 1 ? 1 : 0), x, w.y + 4, { baseline: 'top', align: t === tMin ? 'left' : t === tMax ? 'right' : 'center' });
      }
      w.y += 9;
    }
    w.para(
      `Left: overview to scale with the depth of laying. Right: detail of the circuits${r.system ? '' : ' with phases L1–L3'}, with the hottest cable of the main circuit outlined. The ground temperature field is drawn by superposition of the cable losses and their images (the model behind IEC 60287-2-1), for illustration; the rating itself uses the IEC formulas.`,
      6.8,
      COL.ink3,
    );
  } else if (trenchPng && trenchSc) {
    const h = Math.min(w.width * trenchPng.aspect, 105);
    const wImg = h / trenchPng.aspect;
    w.ensure(h + 24);
    doc.addImage(trenchPng.png, 'PNG', w.x0, w.y, wImg, h);
    doc.setDrawColor(COL.line);
    doc.setLineWidth(0.2);
    doc.rect(w.x0, w.y, wImg, h, 'S');
    w.y += h + 4;
    if (trenchSc.heat) {
      const { tMin, tMax, levels } = trenchSc.heat;
      const lw = 110;
      w.font(7, false, COL.ink2);
      doc.text(trenchSc.numeric ? 'Ground temperature, numerical model, °C' : 'Ground temperature, IEC superposition, °C', w.x0, w.y, { baseline: 'top' });
      w.y += 3.8;
      const n = 80;
      for (let i = 0; i < n; i++) {
        doc.setFillColor(heatScaleColor(pal, (i + 0.5) / n));
        doc.rect(w.x0 + (lw * i) / n, w.y, lw / n + 0.05, 3, 'F');
      }
      doc.setDrawColor(COL.line);
      doc.rect(w.x0, w.y, lw, 3, 'S');
      w.font(6.3, false, COL.ink3);
      for (const tt of [tMin, ...levels, tMax]) {
        const x = w.x0 + ((tt - tMin) / (tMax - tMin)) * lw;
        doc.text(fmt(tt, tt % 1 ? 1 : 0), x, w.y + 4, { baseline: 'top', align: tt === tMin ? 'left' : tt === tMax ? 'right' : 'center' });
      }
      w.y += 9;
    }
    w.para(
      'Cross-section to scale with ground layers, trenches and other shapes, cover tiles, warning tape and heat sources. The temperature field is the numerical model at its own rating; the IEC rating treats the shape around the main circuit as a backfill rectangle.',
      6.8,
      COL.ink3,
    );
  } else if (airPng) {
    const wImg = Math.min(w.width, 100);
    const hImg = wImg * airPng.aspect;
    w.ensure(hImg + 6);
    doc.addImage(airPng.png, 'PNG', w.x0, w.y, wImg, hImg);
    w.y += hImg + 4;
  }

  // ---- Inputs ----
  w.ensure(90);
  w.heading('Input data');
  for (const sec of inputSections(cable, inst)) {
    w.subheading(sec.title, w.tableHeight(sec.rows.length));
    w.table(
      [
        { head: 'Item', w: 62 },
        { head: 'Value', w: w.width - 62 },
      ],
      sec.rows,
    );
  }

  // ---- Sensitivity ----
  const chartH = 58;
  w.ensure(chartH + 26);
  w.heading('Rating sensitivity');
  w.para('Rating of the main circuit when one input changes and all others stay as entered.', 7.2);
  const cw = (w.width - 8) / 2;
  const range = (a: number, b: number, n = 20) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  if (isTrench) {
    lineChart(w, w.x0, w.y, cw, chartH, 'Rating against ground temperature (IEC)', 'Ground temperature (°C)', sweepRating(cable, inst, 'ambient_C', range(0, 40)), { x: inst.ambient_C, I: r.I }, 0);
    if (!inst.touching)
      lineChart(w, w.x0 + cw + 8, w.y, cw, chartH, 'Rating against spacing (IEC)', 'Axial spacing (mm)', sweepRating(cable, inst, 'spacing_mm', range(inst.spacing_mm * 0.5, inst.spacing_mm * 2)), { x: inst.spacing_mm, I: r.I }, 0);
  } else if (inst.type === 'air') {
    lineChart(w, w.x0, w.y, cw, chartH, 'Rating against air temperature', 'Air temperature (°C)', sweepRating(cable, inst, 'ambient_C', range(10, 50)), { x: inst.ambient_C, I: r.I }, 0);
    if (inst.air.arrangement === 'isolated') {
      const De = r.geometry.De;
      lineChart(w, w.x0 + cw + 8, w.y, cw, chartH, 'Rating against spacing', 'Axial spacing (mm)', sweepRating(cable, inst, 'spacing_mm', range(De, De * 5)), { x: r.spacing_mm, I: r.I }, 0);
    }
  } else {
    lineChart(w, w.x0, w.y, cw, chartH, 'Rating against soil thermal resistivity', 'Soil resistivity (K·m/W)', sweepRating(cable, inst, 'soilRho', range(0.5, 3)), { x: inst.soilRho, I: r.I }, 2);
    const dMin = inst.type === 'ductbank' ? Math.max(0.5, inst.bank.height_m / 2 + 0.2) : 0.5;
    lineChart(w, w.x0 + cw + 8, w.y, cw, chartH, 'Rating against depth of laying', 'Depth (m)', sweepRating(cable, inst, 'depth_m', range(dMin, 2.5)), { x: inst.depth_m, I: r.I }, 2);
  }
  w.y += chartH + 4;

  // ---- Calculation sheet ----
  w.ensure(60);
  w.heading('Calculation sheet');
  w.para(
    `Clauses refer to IEC 60287-1-1:2006+A1:2014 (losses and rating equations) and IEC 60287-2-1 (marked 2-1, thermal resistances). The rating converged in ${r.iterations} iterations.`,
    7.2,
  );
  const { sections, lambda } = calcSections(inst, r);
  if (numData && numData.result.ok) {
    w.subheading('Numerical 2D ground model', w.tableHeight(6));
    w.table(
      [
        { head: 'Quantity', w: 74 },
        { head: 'Symbol', w: 18 },
        { head: 'Value', w: 30, align: 'right', bold: true },
        { head: 'Unit', w: 22, color: COL.ink3 },
        { head: 'Reference', w: w.width - 144, color: COL.ink3 },
      ],
      [
        ['Grid cells', '', (numData.numeric.nx * numData.numeric.ny).toLocaleString('en-GB'), '', 'IEC TR 62095'],
        ['External thermal resistance, hottest cable', 'T4', fmt(numData.result.thermal.t4.T4, 4), 'K·m/W', ''],
        ['External thermal resistance, IEC', 'T4', fmt(r.thermal.t4.T4, 4), 'K·m/W', '2-1 2.2'],
        ['Rating, numerical model', 'I', amps(numData.result.I), 'A', ''],
        ['Rating, IEC 60287', 'I', amps(r.I), 'A', '1-1 1.4'],
      ],
    );
    w.para(
      'Finite-volume model of the ground with every layer, fill zone and tile; ground surface and far boundaries at ambient; cables and ducts as conducting bodies. Cable losses, internal thermal resistances and the duct air gap follow IEC 60287.',
      6.8,
      COL.ink3,
    );
  }
  const calcCols = [
    { head: 'Quantity', w: 74 },
    { head: 'Symbol', w: 18, color: COL.ink },
    { head: 'Value', w: 30, align: 'right' as const, bold: true },
    { head: 'Unit', w: 22, color: COL.ink3 },
    { head: 'IEC 60287', w: w.width - 144, color: COL.ink3 },
  ];
  for (const sec of sections) {
    const lambdaTable = sec.title.startsWith('Screen') && lambda.length > 0;
    w.subheading(sec.title, w.tableHeight(sec.rows.length + (lambdaTable ? 4 : 0)));
    w.table(calcCols, sec.rows.map((row) => [row[0], row[1], row[2], row[3], row[4] ?? '']));
    if (lambdaTable) {
      w.table(
        [
          { head: 'Cable', w: 74 },
          { head: 'λ1′ circulating', w: 34, align: 'right' },
          { head: 'λ1″ eddy', w: 34, align: 'right' },
          { head: 'λ1', w: w.width - 142, align: 'right', bold: true },
        ],
        lambda.map((l) => [l[0], l[2], l[3], l[4] ?? '']),
        { highlight: (i) => i === r.sheath.governing },
      );
    }
    if (sec.note) w.para(sec.note, 6.8, COL.ink3);
  }

  if (r.warnings.length || r.notes.length) {
    w.heading('Warnings and assumptions');
    w.bullets([
      ...r.warnings.map((t) => ({ tag: 'Check', text: t, color: '#93600f' })),
      ...r.notes.map((t) => ({ tag: 'Assumed', text: t, color: COL.ink3 })),
    ]);
  }

  w.heading('Method');
  w.para(
    'Steady-state current rating at 100 % load factor to IEC 60287-1-1 and IEC 60287-2-1 for three-phase circuits of single-core cables without armour. The permissible current follows from the conductor temperature limit, the conductor, dielectric and screen losses, and the thermal resistances of the insulation, oversheath and surroundings. Temperature-dependent quantities (sheath temperature, air in ducts, surface of cables in air) are iterated to convergence. Heating between circuits uses superposition (IEC 60287-2-1 2.2.3.1). Material constants default to the IEC tables unless overridden.',
    7.6,
  );
  w.para(
    'This report was produced by a calculation tool that has not been verified against the published benchmark cases (CIGRE TB 880, IEC TR 62095). Check the results against your copy of the standards and the manufacturer’s data before using them for design.',
    7.6,
    COL.ink,
  );

  // ---- Footers ----
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(COL.line);
    doc.setLineWidth(0.2);
    doc.line(w.x0, 287, w.x1, 287);
    w.font(6.5, false, COL.ink3);
    doc.text(`Ampacity Workbench · IEC 60287 steady-state rating · ${cable.name}`, w.x0, 289, { baseline: 'top', maxWidth: 140 });
    doc.text(`Page ${i} of ${pages}`, w.x1, 289, { baseline: 'top', align: 'right' });
  }

  return doc.output('blob') as Blob;
}
