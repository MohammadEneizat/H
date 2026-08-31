import { useRef, useState } from 'react';
import { StoreProvider, useStudy } from './state/store';
import { ProjectPanel } from './components/ProjectPanel';
import { SoilPanel } from './components/SoilPanel';
import { GridPanel } from './components/GridPanel';
import { RegionsPanel } from './components/RegionsPanel';
import { ConductorPanel } from './components/ConductorPanel';
import { ResultsPanel } from './components/ResultsPanel';
import { ReportPanel } from './components/ReportPanel';
import { Badge, fmt } from './components/ui';
import type { StudyInput } from './engine';

type TabId = 'project' | 'soil' | 'grid' | 'regions' | 'conductor' | 'results' | 'report';

const TABS: { id: TabId; label: string; hint: string }[] = [
  { id: 'project', label: 'Project', hint: 'Identification and analysis basis' },
  { id: 'soil', label: 'Soil', hint: 'Resistivity traverses and models' },
  { id: 'grid', label: 'Grid', hint: 'Layout, rods and array steel' },
  { id: 'regions', label: 'Regions', hint: 'Fault data per location' },
  { id: 'conductor', label: 'Conductor', hint: 'Thermal sizing' },
  { id: 'results', label: 'Results', hint: 'Compliance checks' },
  { id: 'report', label: 'Report', hint: 'Calculation record' },
];

function Shell() {
  const [tab, setTab] = useState<TabId>('project');
  const { study, result, replace } = useStudy();
  const fileRef = useRef<HTMLInputElement>(null);

  const onImport = (file: File) => {
    file
      .text()
      .then((text) => replace(JSON.parse(text) as StudyInput))
      .catch(() => alert('That file could not be read as a saved study.'));
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ⏚
          </span>
          <div>
            <h1>SPP Grounding Calculator</h1>
            <p>Personnel protection for utility-scale solar — IEEE Std 2778-2020 / IEEE Std 80-2013</p>
          </div>
        </div>
        <div className="topbar-right">
          <div className="topbar-summary">
            <span>
              Rg <b>{fmt(result.regions[0]?.groundResistance ?? 0, 3)} Ω</b>
            </span>
            <span>
              GPR <b>{fmt(Math.max(...result.regions.map((r) => r.gpr), 0), 0)} V</b>
            </span>
            <Badge verdict={result.overall} />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = '';
            }}
          />
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            Open study
          </button>
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="tab-label">{t.label}</span>
            <span className="tab-hint">{t.hint}</span>
          </button>
        ))}
      </nav>

      <main className="content">
        {tab === 'project' && <ProjectPanel />}
        {tab === 'soil' && <SoilPanel />}
        {tab === 'grid' && <GridPanel />}
        {tab === 'regions' && <RegionsPanel />}
        {tab === 'conductor' && <ConductorPanel />}
        {tab === 'results' && <ResultsPanel />}
        {tab === 'report' && <ReportPanel />}
      </main>

      <footer className="appfoot">
        <p>
          {study.regions.length} region{study.regions.length === 1 ? '' : 's'} · {study.traverses.length} traverse
          {study.traverses.length === 1 ? '' : 's'} · study saved in this browser
        </p>
        <p>
          A screening and optimisation tool. IEEE Std 2778-2020, 5.4.1 requires finite-element software for the final
          design of a utility-scale plant.
        </p>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
