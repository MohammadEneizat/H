import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  calculateRating,
  DUCTS,
  migrateTrench,
  type CableSpec,
  type CircuitSpec,
  type InstallationSpec,
} from './engine';
import { DEFAULT_INSTALLATION, EXAMPLE_CABLES } from './engine/presets';
import { CableForm } from './ui/CableForm';
import { CircuitsForm } from './ui/CircuitsForm';
import { InstallationForm } from './ui/InstallationForm';
import { Results } from './ui/Results';
import { amps } from './ui/format';
import { safeName, saveFile, saveMessage } from './ui/save';

type Tab = 'cable' | 'installation' | 'circuits' | 'library';

const STORE_KEY = 'ampacity-workbench.v1';
const framed = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function normalizeCable(c: Partial<CableSpec> | undefined): CableSpec {
  const base = clone(EXAMPLE_CABLES[0]);
  if (!c || typeof c !== 'object') return base;
  return {
    ...base,
    ...c,
    conductor: { ...base.conductor, ...(c.conductor ?? {}) },
    insulation: { ...base.insulation, ...(c.insulation ?? {}) },
    screen: { ...base.screen, ...(c.screen ?? {}) },
    jacket: { ...base.jacket, ...(c.jacket ?? {}) },
  };
}

function normalizeCircuit(c: Partial<CircuitSpec>, i: number): CircuitSpec {
  return {
    id: typeof c.id === 'string' ? c.id : `c${i}-${Math.random().toString(36).slice(2, 8)}`,
    name: typeof c.name === 'string' ? c.name : `C${i + 2}`,
    cable: c.cable ? normalizeCable(c.cable) : null,
    x_m: typeof c.x_m === 'number' ? c.x_m : 0.5 * (i + 1),
    depth_m: typeof c.depth_m === 'number' ? c.depth_m : DEFAULT_INSTALLATION.depth_m,
    formation: c.formation === 'flat' ? 'flat' : 'trefoil',
    touching: c.touching ?? true,
    spacing_mm: typeof c.spacing_mm === 'number' ? c.spacing_mm : 100,
    transposed: !!c.transposed,
    bonding: c.bonding === 'single' || c.bonding === 'cross' ? c.bonding : 'both',
    crossBondLambda1: c.crossBondLambda1 ?? null,
    load: c.load === 'fixed' ? 'fixed' : 'rated',
    current_A: typeof c.current_A === 'number' ? c.current_A : 0,
    ducted: typeof c.ducted === 'boolean' ? c.ducted : undefined,
    duct: c.duct && typeof c.duct === 'object' ? c.duct : undefined,
    rotated: !!c.rotated,
    conduit: typeof c.conduit === 'string' ? c.conduit : undefined,
  };
}

function normalizeInst(i: Partial<InstallationSpec> | undefined): InstallationSpec {
  const base = clone(DEFAULT_INSTALLATION);
  if (!i || typeof i !== 'object') return base;
  return {
    ...base,
    ...i,
    duct: { ...base.duct, ...(i.duct ?? {}) },
    bank: { ...base.bank, ...(i.bank ?? {}) },
    air: { ...base.air, ...(i.air ?? {}) },
    ratingMode: i.ratingMode === 'equal-current' ? 'equal-current' : 'own-limit',
    circuits: Array.isArray(i.circuits) ? i.circuits.map(normalizeCircuit) : [],
    trench: i.trench && typeof i.trench === 'object' ? migrateTrench(i.trench, i.soilRho ?? base.soilRho) : undefined,
    heatSources: Array.isArray(i.heatSources)
      ? i.heatSources
          .filter((h) => h && typeof h === 'object')
          .map((h, k) => ({
            id: typeof h.id === 'string' ? h.id : `h${k}`,
            name: typeof h.name === 'string' ? h.name : `Heat source ${k + 1}`,
            x_m: Number(h.x_m) || 0,
            depth_m: Number(h.depth_m) || 1,
            diameter_mm: Number(h.diameter_mm) || 200,
            W: Number(h.W) || 0,
          }))
      : [],
    rotated: !!i.rotated,
    conduits: Array.isArray(i.conduits)
      ? i.conduits
          .filter((k) => k && typeof k === 'object' && typeof k.id === 'string')
          .map((k, n) => ({
            id: k.id,
            name: typeof k.name === 'string' ? k.name : `Conduit ${n + 1}`,
            x_m: Number(k.x_m) || 0,
            depth_m: Number(k.depth_m) || 1,
            material: k.material in DUCTS ? k.material : 'PE',
            innerD_mm: Number(k.innerD_mm) || 141,
            outerD_mm: Number(k.outerD_mm) || 160,
          }))
      : [],
    mainConduit: typeof i.mainConduit === 'string' ? i.mainConduit : undefined,
  };
}

interface Stored {
  cable: CableSpec;
  inst: InstallationSpec;
  library: CableSpec[];
}

function loadStored(): Stored {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return {
        cable: normalizeCable(s.cable),
        inst: normalizeInst(s.inst),
        library: Array.isArray(s.library) ? s.library.map(normalizeCable) : [],
      };
    }
  } catch {
    /* storage unavailable */
  }
  return { cable: clone(EXAMPLE_CABLES[0]), inst: clone(DEFAULT_INSTALLATION), library: [] };
}

export function App() {
  const initial = useMemo(loadStored, []);
  const [cable, setCable] = useState<CableSpec>(initial.cable);
  const [inst, setInstRaw] = useState<InstallationSpec>(initial.inst);
  // Undo history for the installation; quick successive edits (a drag) count as one step
  const instRef = useRef(inst);
  instRef.current = inst;
  const hist = useRef<{ past: InstallationSpec[]; future: InstallationSpec[]; last: number }>({ past: [], future: [], last: 0 });
  const setInst = useCallback((next: InstallationSpec) => {
    const cur = instRef.current;
    if (next === cur) return;
    const h = hist.current;
    const now = Date.now();
    if (now - h.last > 600) {
      h.past.push(cur);
      if (h.past.length > 150) h.past.shift();
    }
    h.last = now;
    h.future = [];
    setInstRaw(next);
  }, []);
  const undo = useCallback(() => {
    const h = hist.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(instRef.current);
    h.last = 0;
    setInstRaw(prev);
  }, []);
  const redo = useCallback(() => {
    const h = hist.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(instRef.current);
    h.last = 0;
    setInstRaw(next);
  }, []);
  const [library, setLibrary] = useState<CableSpec[]>(initial.library);
  const [tab, setTab] = useState<Tab>('cable');
  const [message, setMessage] = useState<string>('');
  const [paste, setPaste] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ cable, inst, library }));
    } catch {
      /* storage unavailable */
    }
  }, [cable, inst, library]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(''), 3500);
    return () => clearTimeout(t);
  }, [message]);

  const result = useMemo(() => calculateRating(cable, inst), [cable, inst]);
  const projectJson = () =>
    JSON.stringify({ format: 'ampacity-workbench', version: 3, cable, inst }, null, 2);

  const importJson = (text: string) => {
    try {
      const data = JSON.parse(text);
      if (data.cable) setCable(normalizeCable(data.cable));
      if (data.inst) setInst(normalizeInst(data.inst));
      if (Array.isArray(data.library)) setLibrary(data.library.map(normalizeCable));
      if (!data.cable && !data.inst && !Array.isArray(data.library)) throw new Error('no project');
      setMessage('Project imported');
      setPaste('');
    } catch {
      setMessage('That text is not a project file. Paste the JSON exported from this app.');
    }
  };

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(projectJson());
      setMessage('Project JSON copied');
    } catch {
      setPaste(projectJson());
      setMessage('Copy is blocked here. The JSON is in the box below; select it and copy.');
    }
  };

  const downloadJson = async () => {
    const blob = new Blob([projectJson()], { type: 'application/json' });
    setMessage(saveMessage(await saveFile(`${safeName(cable.name)}.json`, blob), 'Project file'));
  };

  const saveToLibrary = () => {
    setLibrary((lib) => [...lib.filter((c) => c.name !== cable.name), clone(cable)]);
    setMessage(`Saved “${cable.name}” to the library`);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32">
              <circle cx="16" cy="16" r="15" fill="var(--m-jacket)" />
              <circle cx="16" cy="16" r="11.5" fill="none" stroke="var(--m-cu)" strokeWidth="1.6" strokeDasharray="1.6 1.4" />
              <circle cx="16" cy="16" r="9.5" fill="var(--m-xlpe)" />
              <circle cx="16" cy="16" r="5" fill="var(--m-cu)" />
            </svg>
          </span>
          <div>
            <h1>Ampacity Workbench</h1>
            <p className="brand-sub">IEC 60287 current rating of single-core cable circuits</p>
          </div>
        </div>
        <div className="topbar-result" aria-hidden={!result.ok}>
          <span className="topbar-k">{cable.name}</span>
          <span className="topbar-v">{result.ok ? `${amps(result.I)} A` : 'incomplete'}</span>
        </div>
      </header>

      <a className="mobile-bar" href={inst.type === 'trench' ? '#cross-section' : '#results'}>
        <span className="mobile-bar-k">Permissible current</span>
        <span className="mobile-bar-v">{result.ok ? `${amps(result.I)} A` : 'Incomplete'}</span>
        <span className="mobile-bar-go">{inst.type === 'trench' ? 'See drawing' : 'See results'}</span>
      </a>

      <div className="workspace">
        <aside className="inputs" aria-label="Inputs">
          <div className="tabs" role="tablist" aria-label="Input sections">
            {(
              [
                ['cable', 'Cable'],
                ['installation', 'Installation'],
                ['circuits', inst.circuits.length ? `Circuits (${inst.circuits.length + 1})` : 'Circuits'],
                ['library', 'Library'],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                id={`tab-${k}`}
                aria-selected={tab === k}
                aria-controls={`panel-${k}`}
                className={`tab${tab === k ? ' is-on' : ''}`}
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="tab-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === 'cable' && <CableForm cable={cable} onChange={setCable} />}
            {tab === 'installation' && <InstallationForm inst={inst} cable={cable} onChange={setInst} />}
            {tab === 'circuits' && <CircuitsForm inst={inst} cable={cable} library={library} onChange={setInst} />}
            {tab === 'library' && (
              <div className="form library">
                <section className="form-section">
                  <header className="form-section-head">
                    <h3>Your cables</h3>
                    <button type="button" className="btn" onClick={saveToLibrary}>
                      Save current cable
                    </button>
                  </header>
                  {library.length === 0 ? (
                    <p className="empty-note">
                      No saved cables yet. Enter a datasheet in the Cable tab, then save it here to reuse it.
                    </p>
                  ) : (
                    <ul className="lib-list">
                      {library.map((c) => (
                        <li key={c.name} className="lib-item">
                          <span className="lib-name">{c.name}</span>
                          <span className="lib-actions">
                            <button
                              type="button"
                              className="btn btn-quiet"
                              onClick={() => {
                                setCable(clone(c));
                                setTab('cable');
                                setMessage(`Loaded “${c.name}”`);
                              }}
                            >
                              Load
                            </button>
                            <button
                              type="button"
                              className="btn btn-quiet btn-danger"
                              onClick={() => setLibrary((lib) => lib.filter((x) => x !== c))}
                            >
                              Remove
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="form-section">
                  <header className="form-section-head">
                    <h3>Example cables</h3>
                  </header>
                  <p className="empty-note">Typical dimensions, not a manufacturer’s datasheet.</p>
                  <ul className="lib-list">
                    {EXAMPLE_CABLES.map((c) => (
                      <li key={c.name} className="lib-item">
                        <span className="lib-name">{c.name.replace(/^Example: /, '')}</span>
                        <span className="lib-actions">
                          <button
                            type="button"
                            className="btn btn-quiet"
                            onClick={() => {
                              setCable(clone(c));
                              setTab('cable');
                              setMessage('Example loaded');
                            }}
                          >
                            Load
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="form-section">
                  <header className="form-section-head">
                    <h3>Project file</h3>
                  </header>
                  <p className="empty-note">The cable and installation, as JSON.</p>
                  <div className="btn-row">
                    <button type="button" className="btn" onClick={copyJson}>
                      Copy JSON
                    </button>
                    <button type="button" className="btn" onClick={downloadJson}>
                      Download JSON
                    </button>
                    <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                      Open file…
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="application/json,.json"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) f.text().then(importJson);
                        e.target.value = '';
                      }}
                    />
                  </div>
                  <label htmlFor="paste-json" className="field-label">
                    Paste project JSON
                  </label>
                  <textarea
                    id="paste-json"
                    className="paste"
                    rows={5}
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                    placeholder='{"cable": …, "inst": …}'
                  />
                  <div className="btn-row">
                    <button type="button" className="btn" disabled={!paste.trim()} onClick={() => importJson(paste)}>
                      Import pasted JSON
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      onClick={() => {
                        setCable(clone(EXAMPLE_CABLES[0]));
                        setInst(clone(DEFAULT_INSTALLATION));
                        setMessage('Reset to the example');
                      }}
                    >
                      Reset to example
                    </button>
                    {!framed && (
                      <button type="button" className="btn btn-quiet" onClick={() => window.print()}>
                        Print report
                      </button>
                    )}
                  </div>
                </section>
              </div>
            )}
          </div>
        </aside>

        <main className="output" id="results" aria-label="Results">
          <Results
            cable={cable}
            inst={inst}
            result={result}
            onInstChange={setInst}
            undo={undo}
            redo={redo}
            canUndo={hist.current.past.length > 0}
            canRedo={hist.current.future.length > 0}
          />
          <footer className="foot">
            Steady-state rating to IEC 60287-1-1 and IEC 60287-2-1 for circuits of three single-core cables without
            armour, with heating between circuits by superposition. Check the result against your copy of the standard and the manufacturer’s data before relying on
            it.
          </footer>
        </main>
      </div>

      <div className="toast" role="status" aria-live="polite" hidden={!message}>
        {message}
      </div>
    </div>
  );
}
