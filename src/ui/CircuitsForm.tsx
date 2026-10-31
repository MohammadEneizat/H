import React from 'react';
import { deriveGeometry, type CableSpec, type CircuitSpec, type InstallationSpec } from '../engine';
import { EXAMPLE_CABLES } from '../engine/presets';
import { NumField, Section, SelectField, Segmented, TextField, Toggle } from './fields';
import { fmt } from './format';

interface Props {
  inst: InstallationSpec;
  cable: CableSpec;
  library: CableSpec[];
  onChange: (i: InstallationSpec) => void;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const newId = () => Math.random().toString(36).slice(2, 10);

export function CircuitsForm({ inst, cable, library, onChange }: Props) {
  const set = (patch: Partial<InstallationSpec>) => onChange({ ...inst, ...patch });
  const setCircuit = (id: string, patch: Partial<CircuitSpec>) =>
    set({ circuits: inst.circuits.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const num = (v: number | null) => (v === null ? NaN : v);
  const inDucts = inst.type === 'ducts' || inst.type === 'ductbank';

  if (inst.type === 'air') {
    return (
      <div className="form">
        <Section title="Several circuits">
          <p className="empty-note field-wide">
            Several circuits are calculated for buried installations: direct buried, ducts and duct banks. Change the
            installation method to add circuits.
          </p>
        </Section>
      </div>
    );
  }

  /** Half the horizontal width of a circuit (m). */
  const halfWidth = (c: { cable: CableSpec | null; formation: string; touching: boolean; spacing_mm: number }) => {
    const D = inDucts ? inst.duct.outerD_mm : deriveGeometry(c.cable ?? cable).geometry.De || 50;
    const s = c.touching ? D : c.spacing_mm;
    return ((c.formation === 'flat' ? s : s / 2) + D / 2) / 1000;
  };
  const addCircuit = (from?: CircuitSpec) => {
    const base: CircuitSpec = from
      ? { ...clone(from), id: newId(), name: `C${inst.circuits.length + 2}` }
      : {
          id: newId(),
          name: `C${inst.circuits.length + 2}`,
          cable: null,
          x_m: 0,
          depth_m: inst.depth_m,
          formation: inst.formation,
          touching: inst.touching,
          spacing_mm: inst.spacing_mm,
          transposed: inst.transposed,
          bonding: inst.bonding,
          crossBondLambda1: null,
          load: 'rated',
          current_A: 300,
        };
    const clearance = inst.type === 'direct' ? 0.3 : 0.15;
    const right = Math.max(
      halfWidth({ cable: null, formation: inst.formation, touching: inst.touching, spacing_mm: inst.spacing_mm }),
      ...inst.circuits.map((c) => c.x_m + halfWidth(c)),
    );
    base.x_m = Number((right + clearance + halfWidth(base)).toFixed(3));
    set({ circuits: [...inst.circuits, base] });
  };

  const cableOptions = (c: CircuitSpec) => [
    { value: 'main', label: 'Same cable as C1' },
    ...(c.cable ? [{ value: 'own', label: `${c.cable.name.replace(/^Example: /, '')} (copy)` }] : []),
    ...library.map((l, i) => ({ value: `lib:${i}`, label: `Library: ${l.name}` })),
    ...EXAMPLE_CABLES.map((e, i) => ({ value: `ex:${i}`, label: e.name })),
  ];

  return (
    <div className="form">
      <Section title="Main circuit C1">
        <p className="empty-note field-wide">
          C1 is the circuit set up in the Cable and Installation tabs, centred at 0 m and {fmt(inst.depth_m, 2)} m deep:
          {' '}
          {cable.name.replace(/^Example: /, '')}, {inst.formation}
          {inst.touching ? ', touching' : `, ${fmt(inst.spacing_mm, 0)} mm apart`}. Its rating is the main result.
        </p>
      </Section>

      <Section title="Rating with several circuits">
        <Segmented
          id="rating-mode"
          label="Rated circuits"
          value={inst.ratingMode}
          options={[
            { value: 'own-limit', label: 'Each to its own limit' },
            { value: 'equal-current', label: 'All the same current' },
          ]}
          onChange={(ratingMode) => set({ ratingMode })}
        />
        <p className="field-hint field-wide">
          {inst.ratingMode === 'own-limit'
            ? 'Every rated circuit is loaded until its hottest conductor reaches its own maximum temperature.'
            : 'All rated circuits carry one current, set by the circuit that reaches its limit first.'}
        </p>
        {inst.type === 'ductbank' && inst.circuits.length > 0 && (
          <>
            <NumField
              id="bank-cx"
              label="Bank centre, horizontal"
              unit="m"
              optional
              value={inst.bank.centreX_m}
              onChange={(v) => set({ bank: { ...inst.bank, centreX_m: v } })}
              placeholder="0"
            />
            <NumField
              id="bank-cd"
              label="Bank centre, depth"
              unit="m"
              optional
              value={inst.bank.centreDepth_m}
              onChange={(v) => set({ bank: { ...inst.bank, centreDepth_m: v } })}
              placeholder={`${inst.depth_m}`}
            />
          </>
        )}
      </Section>

      {inst.circuits.map((c) => (
        <Section
          key={c.id}
          title={`Circuit ${c.name}`}
          aside={
            <span className="lib-actions">
              <button type="button" className="btn btn-quiet" onClick={() => addCircuit(c)}>
                Duplicate
              </button>
              <button
                type="button"
                className="btn btn-quiet btn-danger"
                onClick={() => set({ circuits: inst.circuits.filter((x) => x.id !== c.id) })}
              >
                Remove
              </button>
            </span>
          }
        >
          <TextField id={`c-${c.id}-name`} label="Name" value={c.name} onChange={(name) => setCircuit(c.id, { name })} />
          <div className="field-wide">
            <SelectField
              id={`c-${c.id}-cable`}
              label="Cable"
              value={c.cable ? 'own' : 'main'}
              options={cableOptions(c)}
              onChange={(v) => {
                if (v === 'main') setCircuit(c.id, { cable: null });
                else if (v.startsWith('lib:')) setCircuit(c.id, { cable: clone(library[Number(v.slice(4))]) });
                else if (v.startsWith('ex:')) setCircuit(c.id, { cable: clone(EXAMPLE_CABLES[Number(v.slice(3))]) });
              }}
            />
          </div>
          <NumField
            id={`c-${c.id}-x`}
            label="Horizontal position"
            unit="m"
            value={c.x_m}
            onChange={(v) => setCircuit(c.id, { x_m: num(v) })}
            hint="Centre to centre from C1"
          />
          <NumField
            id={`c-${c.id}-depth`}
            label="Depth to centre"
            unit="m"
            value={c.depth_m}
            onChange={(v) => setCircuit(c.id, { depth_m: num(v) })}
          />
          <Segmented
            id={`c-${c.id}-formation`}
            label="Formation"
            value={c.formation}
            options={[
              { value: 'trefoil', label: 'Trefoil' },
              { value: 'flat', label: 'Flat' },
            ]}
            onChange={(formation) => setCircuit(c.id, { formation })}
          />
          <Toggle
            id={`c-${c.id}-touching`}
            label={inDucts ? 'Ducts touching' : 'Cables touching'}
            checked={c.touching}
            onChange={(touching) => setCircuit(c.id, { touching })}
          />
          {!c.touching && (
            <NumField
              id={`c-${c.id}-spacing`}
              label="Axial spacing"
              unit="mm"
              value={c.spacing_mm}
              onChange={(v) => setCircuit(c.id, { spacing_mm: num(v) })}
            />
          )}
          {c.formation === 'flat' && (
            <Toggle
              id={`c-${c.id}-transposed`}
              label="Cables regularly transposed"
              checked={c.transposed}
              onChange={(transposed) => setCircuit(c.id, { transposed })}
            />
          )}
          <Segmented
            id={`c-${c.id}-bonding`}
            label="Screen bonding"
            value={c.bonding}
            options={[
              { value: 'both', label: 'Both ends' },
              { value: 'single', label: 'Single point' },
              { value: 'cross', label: 'Cross-bonded' },
            ]}
            onChange={(bonding) => setCircuit(c.id, { bonding })}
          />
          <Segmented
            id={`c-${c.id}-load`}
            label="Load"
            value={c.load}
            options={[
              { value: 'rated', label: 'Rated with C1' },
              { value: 'fixed', label: 'Fixed current' },
            ]}
            onChange={(load) => setCircuit(c.id, { load })}
          />
          {c.load === 'fixed' && (
            <NumField
              id={`c-${c.id}-current`}
              label="Load current"
              unit="A"
              value={c.current_A}
              onChange={(v) => setCircuit(c.id, { current_A: num(v) })}
            />
          )}
        </Section>
      ))}

      <div className="btn-row">
        <button type="button" className="btn" onClick={() => addCircuit()}>
          Add circuit
        </button>
      </div>
      {inst.circuits.length === 0 && (
        <p className="empty-note">
          Add the other circuits that share the trench, ducts or duct bank. Each one heats the others, which lowers
          the rating of C1.
        </p>
      )}
    </div>
  );
}
