import React, { useMemo, useState } from 'react';
import { calculateTemperature, numericOptions, type CableSpec, type InstallationSpec, type RatingResult } from '../engine';
import { buildPdfReport } from '../report/pdf';
import { calcSections, summaryChips, type Row } from '../report/sections';
import { CableSection, InstallationView } from './Drawing';
import { NumField } from './fields';
import { amps, fmt } from './format';
import { SweepChart } from './SweepChart';
import { safeName, saveFile, saveMessage } from './save';
import { PALETTES, useThemeMode } from './theme';
import { TrenchEditor } from './TrenchEditor';
import { useNumeric } from './useNumeric';

interface Props {
  cable: CableSpec;
  inst: InstallationSpec;
  result: RatingResult;
  onInstChange: (i: InstallationSpec) => void;
  undo?: () => void;
  redo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}


function CalcTable({ title, rows, note }: { title: string; rows: Row[]; note?: string }) {
  return (
    <section className="calc-block">
      <CalcTableInner title={title} rows={rows} />
      {note && <p className="calc-note">{note}</p>}
    </section>
  );
}

function CalcTableInner({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <>
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
    </>
  );
}

export function Results({ cable, inst, result: r, onInstChange, undo, redo, canUndo, canRedo }: Props) {
  const pal = PALETTES[useThemeMode()];
  const num = useNumeric(cable, inst, r);
  const trench = inst.type === 'trench';
  const numOk = trench && num.fresh && !!num.data?.result.ok;
  const numTempAtIec = useMemo(
    () =>
      numOk && r.ok ? calculateTemperature(cable, inst, r.I, numericOptions(inst, num.data!.numeric)) : null,
    [numOk, num.data, cable, inst, r],
  );
  const [report, setReport] = useState<{ busy: boolean; msg: string }>({ busy: false, msg: '' });
  const makeReport = async () => {
    setReport({ busy: true, msg: 'Preparing the PDF…' });
    try {
      const blob = await buildPdfReport({ cable, inst, result: r, numeric: numOk ? num.data : null });
      const outcome = await saveFile(`${safeName(cable.name)}_IEC60287_rating.pdf`, blob);
      setReport({ busy: false, msg: saveMessage(outcome, 'PDF report') });
    } catch (e) {
      setReport({ busy: false, msg: e instanceof Error ? e.message : 'The report could not be created.' });
    }
  };
  const [load, setLoad] = useState<number | null>(null);
  const loadI = load ?? (r.ok ? Math.round(r.I * 0.8) : 0);
  const temp = useMemo(() => (r.ok ? calculateTemperature(cable, inst, loadI) : null), [cable, inst, loadI, r.ok]);

  const chips = summaryChips(inst, r);

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
          {trench && <p className="summary-sub">Fix the inputs listed above; the trench editor appears once the rating can be calculated.</p>}
        </section>
      </div>
    );
  }

  const { sections, lambda } = calcSections(inst, r);

  const over = temp && temp.ok && temp.conductor > cable.maxTemp_C + 1e-6;

  return (
    <div className="results">
      <section className="card summary" aria-live="polite">
        <div className="summary-main">
          <p className="eyebrow">
            {r.system && r.system.circuits.length > 1 ? 'Main circuit C1 · permissible current per phase' : 'Permissible current per phase'}
          </p>
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
          <div className="report-row">
            <button type="button" className="btn btn-primary" onClick={makeReport} disabled={report.busy}>
              {report.busy ? 'Preparing PDF…' : 'Download PDF report'}
            </button>
            <span className="report-msg" role="status" aria-live="polite">
              {report.busy ? '' : report.msg}
            </span>
          </div>
        </div>
        <div className="summary-side">
          {trench && (
            <table className="cases">
              <caption>Rating by method</caption>
              <tbody>
                <tr className="is-governing">
                  <th scope="row">IEC 60287 (backfill method)</th>
                  <td>{amps(r.I)} A</td>
                </tr>
                <tr>
                  <th scope="row">Numerical 2D ground model</th>
                  <td>
                    {numOk
                      ? `${amps(num.data!.result.I)} A`
                      : num.status === 'error'
                        ? 'failed'
                        : 'updating…'}
                  </td>
                </tr>
                {numOk && (
                  <tr>
                    <th scope="row">Difference</th>
                    <td>
                      {num.data!.result.I >= r.I ? '+' : '−'}
                      {fmt(Math.abs((num.data!.result.I / r.I - 1) * 100), 1)} %
                    </td>
                  </tr>
                )}
                {numTempAtIec?.ok && (
                  <tr>
                    <th scope="row">Conductor at the IEC rating, numerical</th>
                    <td>{fmt(numTempAtIec.conductor, 1)} °C</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {r.cases.length > 1 && !trench && (
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

      {r.system && r.system.circuits.length > 1 && (
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

      {trench && <TrenchEditor
          cable={cable}
          inst={inst}
          iec={r}
          num={num}
          pal={pal}
          onChange={onInstChange}
          undo={undo}
          redo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
        />}

      <section className={`card drawings${trench ? ' drawings-cable-only' : ''}`} aria-label="Drawings">
        <div className="drawing-cell">
          <h2 className="drawing-title">Cable</h2>
          <CableSection cable={cable} result={r} pal={pal} />
        </div>
        {!trench && (
          <div className="drawing-cell drawing-wide">
            <h2 className="drawing-title">Installation</h2>
            <InstallationView cable={cable} inst={inst} result={r} pal={pal} />
          </div>
        )}
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
          {numOk && (
            <CalcTable
              title="Numerical 2D ground model"
              rows={[
                ['Grid cells', '', num.data!.numeric.nx * num.data!.numeric.ny + '', '', 'TR 62095'],
                ['Solver iterations (all cables)', '', num.data!.numeric.iterations + '', '', ''],
                ['External thermal resistance, hottest cable', 'T4', fmt(num.data!.result.thermal.t4.T4, 4), 'K·m/W', ''],
                ['External thermal resistance, IEC', 'T4', fmt(r.thermal.t4.T4, 4), 'K·m/W', '2-1 2.2'],
                ['Rating, numerical', 'I', amps(num.data!.result.I), 'A', ''],
                ['Rating, IEC', 'I', amps(r.I), 'A', '1-1 1.4'],
              ]}
              note="Finite-volume model of the ground with every layer, fill zone and tile; ground surface and far boundaries at ambient. Cable losses, internal thermal resistances and the duct air gap follow IEC 60287."
            />
          )}
          {sections.map((sec) =>
            sec.title.startsWith('Screen') ? (
              <section className="calc-block" key={sec.title}>
                <CalcTableInner title={sec.title} rows={sec.rows} />
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
                      {lambda.map(([label, , a, b, c], i) => (
                        <tr key={label} className={i === r.sheath.governing ? 'is-governing' : ''}>
                          <th scope="row">{label}</th>
                          <td className="num">{a}</td>
                          <td className="num">{b}</td>
                          <td className="num">{c}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="calc-note">The highlighted cable has the largest loss factor; its λ1 is used.</p>
              </section>
            ) : (
              <CalcTable key={sec.title} title={sec.title} rows={sec.rows} note={sec.note} />
            ),
          )}
        </div>
      </section>
    </div>
  );
}
