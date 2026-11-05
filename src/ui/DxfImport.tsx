import React, { useMemo, useState } from 'react';
import {
  GROUND,
  applyDxfLayout,
  cablesPerCircuit,
  deriveGeometry,
  dxfBounds,
  dxfDefaults,
  dxfToLayout,
  type CableSpec,
  type DxfDoc,
  type GroundMaterial,
  type InstallationSpec,
} from '../engine';
import { NumField, SelectField } from './fields';
import { fmt } from './format';
import type { Palette } from './theme';

const UNITS = [
  { value: '1', label: 'Millimetres' },
  { value: '10', label: 'Centimetres' },
  { value: '1000', label: 'Metres' },
  { value: '25.4', label: 'Inches' },
  { value: '304.8', label: 'Feet' },
] as const;

/** Flat colours for the preview, per fill material. */
const FILL: Record<GroundMaterial, string> = {
  topsoil: '#6f4e33',
  clay: '#b88a5e',
  sand: '#e2c98f',
  'sand-dry': '#efdcae',
  gravel: '#a8a299',
  cbs: '#cfc6b4',
  ftb: '#d6b98a',
  concrete: '#c4c8cc',
  asphalt: '#3d3f42',
  subbase: '#9f9487',
  bentonite: '#a59e86',
  polymer: '#9cb4c8',
  custom: '#bdbdbd',
};

const materialOptions = (Object.keys(GROUND) as GroundMaterial[]).map((m) => ({ value: m, label: GROUND[m].label }));

interface Props {
  name: string;
  doc: DxfDoc;
  cable: CableSpec;
  inst: InstallationSpec;
  pal: Palette;
  onApply: (inst: InstallationSpec, summary: string) => void;
  onCancel: () => void;
}

/** Settings and preview for turning a DXF drawing into the cross-section. */
export function DxfImport({ name, doc, cable, inst, pal, onApply, onCancel }: Props) {
  const d0 = useMemo(() => dxfDefaults(doc), [doc]);
  const De = deriveGeometry(cable).geometry.De;
  const [scale, setScale] = useState(String(d0.scale));
  const [groundY, setGroundY] = useState<number | null>(d0.groundY);
  const [originX, setOriginX] = useState<number | null>(d0.originX);
  const [cableMax, setCableMax] = useState<number | null>(Number.isFinite(De) && De > 0 ? Math.round(De * 1.5) : 60);
  const [materials, setMaterials] = useState<Record<number, GroundMaterial>>({});
  const per = cablesPerCircuit(cable);

  const layout = useMemo(
    () =>
      dxfToLayout(
        doc,
        { scale: Number(scale), groundY: groundY ?? d0.groundY, originX: originX ?? d0.originX, cableMaxD: cableMax ?? 60, perCircuit: per },
        name,
      ),
    [doc, scale, groundY, originX, cableMax, per, name, d0],
  );
  const regions = layout.regions.map((r, i) => (materials[i] ? { ...r, material: materials[i], rho: undefined } : r));
  const final = { ...layout, regions };

  // Preview region (mm, y down)
  const b = dxfBounds(doc);
  const sc = Number(scale);
  const view = {
    x0: (b.x0 - (originX ?? 0)) * sc,
    x1: (b.x1 - (originX ?? 0)) * sc,
    y0: ((groundY ?? 0) - b.y1) * sc,
    y1: ((groundY ?? 0) - b.y0) * sc,
  };
  const w = Math.max(1, view.x1 - view.x0);
  const h = Math.max(1, view.y1 - view.y0);
  const pad = Math.max(w, h) * 0.04;
  const sw = Math.max(w, h) / 400;
  const u = layout.underlay;
  const linePath = useMemo(() => {
    let d = '';
    for (let i = 0; i < u.lines.length; i += 4) d += `M${u.lines[i]} ${u.lines[i + 1]}L${u.lines[i + 2]} ${u.lines[i + 3]}`;
    return d;
  }, [u]);

  const unitLabel = ({ '1': 'mm', '10': 'cm', '1000': 'm', '25.4': 'in', '304.8': 'ft' } as Record<string, string>)[scale] ?? '';
  const perText = per === 2 ? 'DC pairs (+ and −)' : per === 1 ? 'one three-core cable each' : 'three single-core cables each';
  const summary = `${regions.length} region${regions.length === 1 ? '' : 's'}, ${layout.circuits.length} circuit${layout.circuits.length === 1 ? '' : 's'}, ${layout.conduits.length} conduit${layout.conduits.length === 1 ? '' : 's'}`;

  return (
    <section className="dxf-import" aria-label="Import a DXF drawing">
      <header className="dxf-head">
        <div>
          <h3>Import {name}</h3>
          <p className="field-hint">
            {doc.entities.length.toLocaleString('en-GB')} objects on {doc.layers.length} layer{doc.layers.length === 1 ? '' : 's'}. Found{' '}
            {summary}.
          </p>
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onApply(applyDxfLayout(inst, final), `Imported ${name}: ${summary}.`)}
          >
            Import
          </button>
        </div>
      </header>
      <div className="dxf-body">
        <svg className="dxf-preview" viewBox={`${view.x0 - pad} ${view.y0 - pad} ${w + 2 * pad} ${h + 2 * pad}`} role="img" aria-label="Preview of the imported cross-section">
          <rect x={view.x0 - pad} y={view.y0 - pad} width={w + 2 * pad} height={h + 2 * pad} fill={pal.panel} />
          <rect x={view.x0 - pad} y={0} width={w + 2 * pad} height={Math.max(0, view.y1 + pad)} fill={FILL.clay} opacity={0.35} />
          {regions.map((r, i) => (
            <polygon key={i} points={r.points.map(([x, y]) => `${x * 1000},${y * 1000}`).join(' ')} fill={FILL[r.material]} stroke={pal.ink2} strokeWidth={sw} />
          ))}
          {layout.bores.map((c, i) => (
            <circle key={`b${i}`} cx={c.x} cy={c.y} r={c.d / 2} fill={FILL.bentonite} stroke={pal.ink2} strokeWidth={sw} />
          ))}
          <path d={linePath} fill="none" stroke={pal.ink} strokeWidth={sw * 0.8} opacity={0.55} />
          <line x1={view.x0 - pad} y1={0} x2={view.x1 + pad} y2={0} stroke="#3f8f3a" strokeWidth={sw * 3} />
          {layout.conduits.map((k, i) => (
            <g key={`k${i}`}>
              <circle cx={k.x} cy={k.y} r={k.Do / 2} fill={pal.duct} stroke={pal.ductEdge} strokeWidth={sw} />
              <circle cx={k.x} cy={k.y} r={k.Di / 2} fill={pal.air} />
            </g>
          ))}
          {layout.circuits.map((c, i) =>
            c.cables.map((p, j) => (
              <circle
                key={`c${i}-${j}`}
                cx={p.x}
                cy={p.y}
                r={Math.max(c.duct ? c.d * 0.3 : c.d / 2, sw * 3)}
                fill={per === 2 && j === 0 ? '#b52a22' : '#25292d'}
                stroke={pal.accent}
                strokeWidth={sw * 1.2}
              />
            )),
          )}
        </svg>
        <div className="dxf-settings field-grid">
          <SelectField id="dxf-units" label={`Drawing units${d0.unitsGuessed ? ' (guessed)' : ''}`} value={scale} options={[...UNITS]} onChange={setScale} />
          <NumField
            id="dxf-ground"
            label="Ground surface at drawing y"
            unit={unitLabel}
            value={groundY}
            onChange={setGroundY}
            hint="The top line of the drawing by default."
          />
          <NumField id="dxf-origin" label="x = 0 at drawing x" unit={unitLabel} value={originX} onChange={setOriginX} />
          <NumField
            id="dxf-cablemax"
            label="Circles up to this are cables"
            unit="mm"
            value={cableMax}
            onChange={setCableMax}
            hint={`Larger circles become conduits (up to 600 mm) or bores. Cables are grouped as ${perText}, from the Cable tab.`}
          />
          {regions.length > 0 && (
            <div className="field field-wide">
              <span className="field-label">Fill of each region (from the labels in the drawing where found)</span>
              <ul className="dxf-regions">
                {regions.map((r, i) => (
                  <li key={i}>
                    <span className="swatch" style={{ background: FILL[r.material] }} aria-hidden="true" />
                    <span className="dxf-region-name">
                      {r.label} · {fmt(r.area / 1e6, 2)} m²{r.rho !== undefined ? ` · ρ ${fmt(r.rho, 2)}` : ''}
                    </span>
                    <label className="sr-only" htmlFor={`dxf-m${i}`}>
                      Material of {r.label}
                    </label>
                    <select id={`dxf-m${i}`} value={r.material} onChange={(e) => setMaterials((m) => ({ ...m, [i]: e.target.value as GroundMaterial }))}>
                      {materialOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {[...doc.warnings, ...layout.notes].map((n) => (
            <p key={n} className="field-hint field-wide">
              {n}
            </p>
          ))}
          <p className="field-hint field-wide">
            {layout.circuits.length
              ? 'Importing replaces the circuits with those in the drawing; the one nearest x = 0 becomes C1. Ground layers are kept.'
              : 'No cables were found, so the circuits stay as they are. Ground layers are kept.'}{' '}
            Each region becomes a shape you can edit afterwards; the drawing stays visible underneath.
          </p>
        </div>
      </div>
    </section>
  );
}
