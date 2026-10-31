import React, { useMemo, useState } from 'react';
import {
  AIR_CONSTANTS,
  calculateTemperature,
  type CableSpec,
  type InstallationSpec,
  type RatingResult,
} from '../engine';
import { CableSection, InstallationView } from './Drawing';
import { NumField } from './fields';
import { amps, fmt, sig } from './format';
import { SweepChart } from './SweepChart';

interface Props {
  cable: CableSpec;
  inst: InstallationSpec;
  result: RatingResult;
}

const typeLabel = { direct: 'Direct buried', ducts: 'In ducts', ductbank: 'Duct bank', air: 'Free air' } as const;
const bondLabel = { both: 'Both ends bonded', single: 'Single-point bonded', cross: 'Cross-bonded' } as const;

type Row = [quantity: string, symbol: string, value: string, unit: string, ref?: string];

function CalcTable({ title, rows, note }: { title: string; rows: Row[]; note?: string }) {
  return (
    <section className="calc-block">
      <h3>{title}</h3>
      <div className="table-scroll">
        <table className="calc-table">
          <thead>
            <tr>
              <th scope="col">Quantity</th>
              <th scope="col">Symbol</th>
              <th scope="col" className="num">
                Value
              </th>
              <th scope="col">Unit</th>
              <th scope="col">IEC 60287</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([q, s, v, u, ref]) => (
              <tr key={q + s}>
                <th scope="row">{q}</th>
                <td className="sym">{s}</td>
                <td className="num">{v}</td>
                <td className="unit">{u}</td>
                <td className="ref">{ref ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <p className="calc-note">{note}</p>}
    </section>
  );
}

export function Results({ cable, inst, result: r }: Props) {
  const [load, setLoad] = useState<number | null>(null);
  const loadI = load ?? (r.ok ? Math.round(r.I * 0.8) : 0);
  const temp = useMemo(() => (r.ok ? calculateTemperature(cable, inst, loadI) : null), [cable, inst, loadI, r.ok]);

  const chips = [
    typeLabel[inst.type],
    inst.type === 'air'
      ? AIR_CONSTANTS[inst.air.arrangement].label
      : `${inst.formation === 'trefoil' ? 'Trefoil' : 'Flat'}, ${inst.touching ? 'touching' : `${fmt(inst.spacing_mm, 0)} mm`}`,
    bondLabel[inst.bonding],
    ...(r.system ? [`${r.system.circuits.length} circuits`] : []),
    inst.type === 'air' ? `${fmt(inst.ambient_C, 0)} °C air` : `${fmt(inst.depth_m, 2)} m · ${fmt(inst.soilRho, 2)} K·m/W · ${fmt(inst.ambient_C, 0)} °C`,
  ];

  if (!r.ok) {
    return (
      <div className="results">
        <section className="card summary is-error" aria-live="polite">
          <p className="eyebrow">Permissible current</p>
          <p className="hero-figure">–</p>
          <h2 className="error-title">The rating cannot be calculated yet</h2>
          <ul className="issue-list">
            {r.errors.map((e) => (
              <li key={e} className="issue issue-bad">
                {e}
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }

  const c = r.conductor;
  const t4 = r.thermal.t4;
  const perKm = (v: number) => sig(v * 1000, 4);
  const sheathCols = r.sheath.cables;

  const conductorRows: Row[] = [
    ['DC resistance at 20 °C', 'R0', perKm(c.R0), 'Ω/km', '2.1.1'],
    [`DC resistance at ${fmt(r.temperatures.conductor, 1)} °C`, 'R′', perKm(c.Rdc), 'Ω/km', '2.1.1'],
    ['Skin effect coefficient', 'ks', sig(c.ks, 3), '', 'Table 2'],
    ['Skin effect argument', 'xs', sig(c.xs, 4), '', '2.1.2'],
    ['Skin effect factor', 'ys', sig(c.ys, 4), '', '2.1.2'],
    ['Proximity effect coefficient', 'kp', sig(c.kp, 3), '', 'Table 2'],
    ['Proximity effect argument', 'xp', sig(c.xp, 4), '', '2.1.4'],
    ['Proximity effect factor', 'yp', sig(c.yp, 4), '', '2.1.4'],
    [
      c.fromDatasheet ? 'AC resistance (datasheet)' : 'AC resistance R′(1 + ys + yp)',
      'R',
      perKm(c.R),
      'Ω/km',
      c.fromDatasheet ? 'datasheet' : '2.1',
    ],
  ];

  const dielectricRows: Row[] = [
    ['Capacitance', 'C', sig(r.dielectric.C * 1e9, 4), 'µF/km', '2.2'],
    [
      r.dielectric.included ? 'Dielectric loss ωCU0² tan δ' : `Dielectric loss (neglected below ${r.dielectric.threshold_kV} kV)`,
      'Wd',
      sig(r.dielectric.Wd, 4),
      'W/m',
      '2.2',
    ],
  ];

  const sheathRows: Row[] = [
    ['Screen resistance at 20 °C', 'Rs,20', perKm(r.sheath.Rs20), 'Ω/km', '2.3'],
    [`Screen resistance at ${fmt(r.temperatures.sheath, 1)} °C`, 'Rs', perKm(r.sheath.Rs), 'Ω/km', '2.3'],
    ['Screen reactance', inst.formation === 'flat' && inst.transposed ? 'X1' : 'X', perKm(r.sheath.X), 'Ω/km', '2.3.1'],
    ['Eddy current parameter', 'm', sig(r.sheath.m, 4), '', '2.3.6'],
  ];
  if (r.sheath.Ft !== null) sheathRows.push(['Eddy loss reduction (Milliken)', 'Ft', sig(r.sheath.Ft, 4), '', '2.3.1']);

  const thermalRows: Row[] = [
    ['Insulation (conductor to screen)', 'T1', sig(r.thermal.T1, 4), 'K·m/W', '2-1 2.1.1'],
    ['Bedding (no armour)', 'T2', '0', 'K·m/W', '2-1 2.1.2'],
    ['Oversheath', 'T3', sig(r.thermal.T3, 4), 'K·m/W', '2-1 2.1.3'],
  ];
  if (t4.T4p !== undefined) {
    thermalRows.push(['Air space in duct', 'T4′', sig(t4.T4p, 4), 'K·m/W', '2-1 2.2.7.1']);
    thermalRows.push(['Duct wall', 'T4″', sig(t4.T4pp, 4), 'K·m/W', '2-1 2.2.7.2']);
    thermalRows.push(['Duct to ambient incl. mutual heating', 'T4‴', sig(t4.T4ppp, 4), 'K·m/W', '2-1 2.2.7.3']);
    if (t4.bankCorrection !== undefined)
      thermalRows.push(['of which duct bank correction', '', sig(t4.bankCorrection, 4), 'K·m/W', '2-1 2.2.7.3']);
    thermalRows.push(['Mean temperature in duct', 'θm', fmt(t4.thetaM, 1), '°C', '2-1 2.2.7.1']);
  }
  if (t4.h !== undefined) {
    thermalRows.push(['Heat dissipation coefficient', 'h', sig(t4.h, 4), 'W/m²K^5/4', '2-1 2.2.1']);
    thermalRows.push(['Surface temperature rise', 'Δθs', fmt(t4.dThetaS, 2), 'K', '2-1 2.2.1']);
  }
  thermalRows.push([
    inst.type === 'air' ? 'External, free air' : 'External thermal resistance',
    inst.type === 'air' ? 'T4*' : 'T4',
    sig(t4.T4, 4),
    'K·m/W',
    inst.type === 'air' ? '2-1 2.2.1' : '2-1 2.2.3',
  ]);

  if (r.system && t4.mutual !== undefined)
    thermalRows.push(['Rise from other circuits at this cable', 'Δθp', fmt(t4.mutual, 2), 'K', '2-1 2.2.3.1']);

  const lossRows: Row[] = [
    ['Conductor loss I²R', 'Wc', sig(r.losses.Wc, 4), 'W/m', '1.4'],
    ['Screen loss λ1·Wc', 'Ws', sig(r.losses.Ws, 4), 'W/m', '1.4'],
    ['Dielectric loss', 'Wd', sig(r.losses.Wd, 4), 'W/m', '2.2'],
    ['Total heat per cable', 'W', sig(r.losses.W, 4), 'W/m', ''],
  ];
  const tempRows: Row[] = [
    ['Conductor', 'θc', fmt(r.temperatures.conductor, 1), '°C', ''],
    ['Metallic screen / sheath', 'θs', fmt(r.temperatures.sheath, 1), '°C', ''],
    ['Cable surface', 'θe', fmt(r.temperatures.surface, 1), '°C', ''],
  ];
  if (r.temperatures.ductInner !== undefined)
    tempRows.push(['Duct inner surface', 'θd', fmt(r.temperatures.ductInner, 1), '°C', '']);
  tempRows.push([inst.type === 'air' ? 'Ambient air' : 'Ambient soil', 'θa', fmt(inst.ambient_C, 1), '°C', '']);

  const over = temp && temp.ok && temp.conductor > cable.maxTemp_C + 1e-6;

  return (
    <div className="results">
      <section className="card summary" aria-live="polite">
        <div className="summary-main">
          <p className="eyebrow">{r.system ? 'Main circuit C1 · permissible current per phase' : 'Permissible current per phase'}</p>
          <p className="hero-figure">
            {amps(r.I)}
            <span className="hero-unit">A</span>
          </p>
          <p className="summary-sub">
            {r.governingCase} · conductor at {fmt(r.temperatures.conductor, 1)} °C · 100 % load factor
          </p>
          <ul className="chips" aria-label="Installation">
            {chips.map((ch) => (
              <li key={ch} className="chip">
                {ch}
              </li>
            ))}
          </ul>
        </div>
        <div className="summary-side">
          {r.cases.length > 1 && (
            <table className="cases">
              <caption>Soil cases</caption>
              <tbody>
                {r.cases.map((cs) => (
                  <tr key={cs.label} className={cs.label === r.governingCase ? 'is-governing' : ''}>
                    <th scope="row">{cs.label}</th>
                    <td>{amps(cs.I)} A</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="load-check">
            <NumField
              id="load-current"
              label={r.system ? 'Check a main-circuit current' : 'Check a load current'}
              unit="A"
              value={loadI}
              onChange={(v) => setLoad(v)}
              hint={r.system ? 'Other circuits carry their rating or their set load.' : undefined}
            />
            {temp && temp.ok && (
              <p className={`load-result ${over ? 'is-over' : 'is-ok'}`}>
                <span className={`pill ${over ? 'pill-bad' : 'pill-ok'}`}>{over ? 'Over limit' : 'Within limit'}</span>
                <span>
                  Conductor <strong>{fmt(temp.conductor, 1)} °C</strong> · {fmt((loadI / r.I) * 100, 0)} % of rating
                </span>
              </p>
            )}
            {temp && !temp.ok && <p className="load-result is-over">{temp.errors[0]}</p>}
          </div>
        </div>
      </section>

      {r.system && (
        <section className="card" aria-labelledby="circuits-title">
          <header className="card-head">
            <div>
              <h2 id="circuits-title">All circuits</h2>
              <p className="card-sub">
                {r.system.mode === 'equal-current'
                  ? 'Rated circuits carry the same current, limited by the hottest one.'
                  : 'Each rated circuit is loaded to its own temperature limit.'}{' '}
                Fixed circuits carry their set load.
              </p>
            </div>
          </header>
          <div className="table-scroll">
            <table className="data-table circuits-table">
              <thead>
                <tr>
                  <th scope="col">Circuit</th>
                  <th scope="col">Cable</th>
                  <th scope="col">Load</th>
                  <th scope="col" className="num">
                    Current
                  </th>
                  <th scope="col" className="num">
                    Hottest conductor
                  </th>
                  <th scope="col" className="num">
                    Heat per cable
                  </th>
                  <th scope="col" className="num">
                    From other circuits
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {r.system.circuits.map((c) => {
                  const atLimit = Math.abs(c.hottestTemp - c.maxTemp) < 0.05;
                  const overLimit = !atLimit && c.hottestTemp > c.maxTemp;
                  return (
                    <tr key={c.name}>
                      <th scope="row">{c.name}</th>
                      <td className="text">{c.cableName.replace(/^Example: /, '')}</td>
                      <td className="text">{c.load === 'rated' ? 'Rated' : 'Fixed'}</td>
                      <td className="num">{amps(c.I)} A</td>
                      <td className="num">
                        {fmt(c.hottestTemp, 1)} °C <span className="muted">/ {fmt(c.maxTemp, 0)}</span>
                      </td>
                      <td className="num">{fmt(c.W, 1)} W/m</td>
                      <td className="num">+{fmt(c.mutualRise, 1)} K</td>
                      <td className="text">
                        <span className={`pill ${overLimit ? 'pill-bad' : atLimit ? 'pill-note' : 'pill-ok'}`}>
                          {overLimit ? 'Over limit' : atLimit ? 'At limit' : 'Within limit'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(r.warnings.length > 0 || r.notes.length > 0) && (
        <section className="card issues" aria-label="Warnings and assumptions">
          <ul className="issue-list">
            {r.warnings.map((w) => (
              <li key={w} className="issue issue-warn">
                <span className="pill pill-warn">Check</span>
                {w}
              </li>
            ))}
            {r.notes.map((nte) => (
              <li key={nte} className="issue issue-note">
                <span className="pill pill-note">Assumed</span>
                {nte}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card drawings" aria-label="Drawings">
        <div className="drawing-cell">
          <h2 className="drawing-title">Cable</h2>
          <CableSection cable={cable} result={r} />
        </div>
        <div className="drawing-cell drawing-wide">
          <h2 className="drawing-title">Installation</h2>
          <InstallationView cable={cable} inst={inst} result={r} />
        </div>
      </section>

      <SweepChart cable={cable} inst={inst} result={r} />

      <section className="card calc" aria-labelledby="calc-title">
        <header className="card-head">
          <div>
            <h2 id="calc-title">Calculation sheet</h2>
            <p className="card-sub">
              Clauses refer to IEC 60287-1-1:2006+A1:2014 (losses, rating) and IEC 60287-2-1 (marked 2-1, thermal
              resistances). Converged in {r.iterations} iterations.
            </p>
          </div>
        </header>
        <div className="calc-grid">
          <CalcTable title="Conductor" rows={conductorRows} />
          <CalcTable title="Dielectric" rows={dielectricRows} />
          <section className="calc-block">
            <h3>Screen / sheath losses</h3>
            <div className="table-scroll">
              <table className="calc-table">
                <thead>
                  <tr>
                    <th scope="col">Quantity</th>
                    <th scope="col">Symbol</th>
                    <th scope="col" className="num">
                      Value
                    </th>
                    <th scope="col">Unit</th>
                    <th scope="col">IEC 60287</th>
                  </tr>
                </thead>
                <tbody>
                  {sheathRows.map(([q, s, v, u, ref]) => (
                    <tr key={q}>
                      <th scope="row">{q}</th>
                      <td className="sym">{s}</td>
                      <td className="num">{v}</td>
                      <td className="unit">{u}</td>
                      <td className="ref">{ref}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-scroll">
              <table className="calc-table lambda-table">
                <thead>
                  <tr>
                    <th scope="col">Cable</th>
                    <th scope="col" className="num">
                      λ1′ circulating
                    </th>
                    <th scope="col" className="num">
                      λ1″ eddy
                    </th>
                    <th scope="col" className="num">
                      λ1
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sheathCols.map((sc, i) => (
                    <tr key={sc.label} className={i === r.sheath.governing ? 'is-governing' : ''}>
                      <th scope="row">{sc.label}</th>
                      <td className="num">{sig(sc.lambda1p, 4)}</td>
                      <td className="num">{sig(sc.lambda1pp, 4)}</td>
                      <td className="num">{sig(sc.lambda1, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="calc-note">Highlighted cable has the largest loss factor; its λ1 = {sig(r.sheath.lambda1, 4)} is used.</p>
          </section>
          <CalcTable title="Thermal resistances" rows={thermalRows} note={t4.method} />
          <CalcTable title="Losses at the rated current" rows={lossRows} />
          <CalcTable title="Temperatures at the rated current" rows={tempRows} />
        </div>
      </section>
    </div>
  );
}
