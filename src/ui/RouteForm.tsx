import React from 'react';
import type { InstallationSpec, RouteSection, RouteSpec } from '../engine';
import { typeLabel } from '../report/sections';
import { NumField, Section, TextField } from './fields';

const uid = () => Math.random().toString(36).slice(2, 10);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

interface Props {
  route: RouteSpec;
  inst: InstallationSpec;
  ratings: Record<string, number>;
  onRoute: (r: RouteSpec) => void;
  /** Make a section the one being edited (loads its installation) */
  onEdit: (id: string | null) => void;
}

export function RouteForm({ route, inst, ratings, onRoute, onEdit }: Props) {
  const set = (sections: RouteSection[]) => onRoute({ ...route, sections });
  const patch = (id: string, p: Partial<RouteSection>) => set(route.sections.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const move = (i: number, d: number) => {
    const s = [...route.sections];
    const j = i + d;
    if (j < 0 || j >= s.length) return;
    [s[i], s[j]] = [s[j], s[i]];
    set(s);
  };
  const add = () => {
    const sec: RouteSection = {
      id: uid(),
      name: `Section ${route.sections.length + 1} · ${typeLabel[inst.type]}`,
      length_m: 100,
      inst: clone(inst),
    };
    // Stored as a snapshot; it is only changed when you choose Edit.
    onRoute({ ...route, sections: [...route.sections, sec] });
  };
  const total = route.sections.reduce((a, s) => a + (s.length_m || 0), 0);
  let chain = 0;

  return (
    <div className="form">
      <Section title="Cable route">
        <p className="empty-note field-wide">
          A route is a chain of sections, each with its own installation and length. The route rating is the lowest
          section rating. Adding a section stores a copy of the current installation. Choose Edit on a section to
          change it; while editing, every change goes into that section.
        </p>
        <div className="btn-row field-wide">
          <button type="button" className="btn" onClick={add}>
            Add current installation as a section
          </button>
          {route.activeId && (
            <button type="button" className="btn btn-quiet" onClick={() => onEdit(null)}>
              Stop editing sections
            </button>
          )}
        </div>
      </Section>
      {route.sections.length === 0 ? (
        <p className="empty-note">
          No sections yet. Set up the first stretch of the route (for example an open trench), add it, then set up and
          add the next one (a road crossing, a drilled crossing…).
        </p>
      ) : (
        <ol className="route-list">
          {route.sections.map((s, i) => {
            const from = chain;
            chain += s.length_m || 0;
            const active = s.id === route.activeId;
            return (
              <li key={s.id} className={`route-item${active ? ' is-active' : ''}`}>
                <div className="route-item-head">
                  <span className="route-chain">
                    {Math.round(from).toLocaleString('en-GB')}–{Math.round(chain).toLocaleString('en-GB')} m
                  </span>
                  {active && <span className="pill pill-note">Editing</span>}
                  <span className="route-rating">
                    {Number.isFinite(ratings[s.id]) ? `${Math.round(ratings[s.id]).toLocaleString('en-GB')} A` : '–'}
                  </span>
                </div>
                <div className="field-grid">
                  <TextField id={`rs-${s.id}-name`} label="Name" value={s.name} onChange={(name) => patch(s.id, { name })} />
                  <NumField
                    id={`rs-${s.id}-len`}
                    label="Length"
                    unit="m"
                    value={s.length_m}
                    onChange={(v) => patch(s.id, { length_m: v ?? 0 })}
                  />
                  <p className="field-hint route-type">{typeLabel[s.inst.type]}</p>
                </div>
                <div className="btn-row">
                  <button type="button" className="btn" onClick={() => onEdit(s.id)} disabled={active} aria-pressed={active}>
                    {active ? 'Editing' : 'Edit'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => {
                      const copy = { ...clone(s), id: uid(), name: `${s.name} (copy)` };
                      const sections = [...route.sections];
                      sections.splice(i + 1, 0, copy);
                      set(sections);
                    }}
                  >
                    Duplicate
                  </button>
                  <button type="button" className="btn btn-quiet" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${s.name} up`}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => move(i, 1)}
                    disabled={i === route.sections.length - 1}
                    aria-label={`Move ${s.name} down`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet btn-danger"
                    onClick={() =>
                      onRoute({
                        sections: route.sections.filter((x) => x.id !== s.id),
                        activeId: route.activeId === s.id ? null : route.activeId,
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {route.sections.length > 0 && (
        <p className="empty-note">Route length {Math.round(total).toLocaleString('en-GB')} m.</p>
      )}
    </div>
  );
}
