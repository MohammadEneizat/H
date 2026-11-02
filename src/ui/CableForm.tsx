import React from 'react';
import {
  INSULATIONS,
  JACKETS,
  METALS,
  defaultSkinProximity,
  deriveGeometry,
  type CableSpec,
  type InsulationKey,
  type JacketKey,
  type MetalKey,
} from '../engine';
import { NumField, Overrides, Section, SelectField, Segmented, TextField } from './fields';
import { fmt } from './format';

interface Props {
  cable: CableSpec;
  onChange: (c: CableSpec) => void;
}

const insulationOptions = (Object.keys(INSULATIONS) as InsulationKey[]).map((k) => ({
  value: k,
  label: INSULATIONS[k].label,
}));
const jacketOptions = (Object.keys(JACKETS) as JacketKey[]).map((k) => ({ value: k, label: JACKETS[k].label }));
const metalOptions = (Object.keys(METALS) as MetalKey[]).map((k) => ({ value: k, label: METALS[k].label }));

export function CableForm({ cable, onChange }: Props) {
  const c = cable;
  const set = (patch: Partial<CableSpec>) => onChange({ ...c, ...patch });
  const setCond = (patch: Partial<CableSpec['conductor']>) => set({ conductor: { ...c.conductor, ...patch } });
  const setIns = (patch: Partial<CableSpec['insulation']>) => set({ insulation: { ...c.insulation, ...patch } });
  const setScr = (patch: Partial<CableSpec['screen']>) => set({ screen: { ...c.screen, ...patch } });
  const setJac = (patch: Partial<CableSpec['jacket']>) => set({ jacket: { ...c.jacket, ...patch } });
  const three = c.cores === 3;
  const tc = c.threeCore ?? { shape: 'sector' as const, innerCovering_mm: null, r1_mm: null, fillerRho: null };
  const setTc = (patch: Partial<NonNullable<CableSpec['threeCore']>>) => set({ threeCore: { ...tc, ...patch } });
  const noScreen = !three && c.screen.form === 'none';

  const ins = INSULATIONS[c.insulation.material];
  const dflt = defaultSkinProximity(c.conductor.material, c.conductor.construction, ins.system, c.conductor.millikenWires);
  const { geometry: g } = deriveGeometry(c);
  const num = (v: number | null) => (v === null ? NaN : v);

  return (
    <div className="form">
      <Section title="Cable">
        <TextField id="cable-name" label="Name" value={c.name} onChange={(name) => set({ name })} />
        <Segmented
          id="cable-cores"
          label="Cable type"
          value={three ? '3' : '1'}
          options={[
            { value: '1', label: 'Single-core' },
            { value: '3', label: 'Three-core' },
          ]}
          onChange={(v) => set(v === '3' ? { cores: 3, threeCore: tc } : { cores: 1 })}
        />
        {three && (
          <p className="field-hint field-wide">
            Three-core cables are rated without a metallic screen or armour, as for NYY, NAYY, N2XY and NA2XY. One
            three-core cable makes one circuit.
          </p>
        )}
        <NumField id="u0" label="Rated voltage U0" unit="kV" value={c.U0_kV} onChange={(v) => set({ U0_kV: num(v) })} />
        <NumField
          id="tmax"
          label="Max. conductor temperature"
          unit="°C"
          value={c.maxTemp_C}
          onChange={(v) => set({ maxTemp_C: num(v) })}
        />
      </Section>

      <Section title="Conductor">
        <Segmented
          id="cond-mat"
          label="Material"
          value={c.conductor.material}
          options={[
            { value: 'Cu', label: 'Copper' },
            { value: 'Al', label: 'Aluminium' },
          ]}
          onChange={(material) => setCond({ material })}
        />
        <SelectField
          id="cond-type"
          label="Construction"
          value={c.conductor.construction}
          options={[
            { value: 'stranded', label: three ? 'Stranded (RM, SM)' : 'Round stranded' },
            { value: 'solid', label: three ? 'Solid (RE, SE)' : 'Round solid' },
            { value: 'milliken', label: 'Milliken (segmental)' },
          ]}
          onChange={(construction) => setCond({ construction })}
        />
        {three && (
          <Segmented
            id="cond-shape"
            label="Conductor shape"
            value={tc.shape}
            options={[
              { value: 'sector', label: 'Sector-shaped (SE, SM)' },
              { value: 'round', label: 'Round (RE, RM)' },
            ]}
            onChange={(shape) => setTc({ shape })}
          />
        )}
        {c.conductor.construction === 'milliken' && c.conductor.material === 'Cu' && ins.system === 'extruded' && (
          <SelectField
            id="cond-wires"
            label="Milliken wires"
            value={c.conductor.millikenWires}
            options={[
              { value: 'insulated', label: 'Insulated (enamelled) wires' },
              { value: 'bare-uni', label: 'Bare, uni-directional' },
              { value: 'bare-bi', label: 'Bare, bi-directional' },
            ]}
            onChange={(millikenWires) => setCond({ millikenWires })}
          />
        )}
        <NumField
          id="cond-area"
          label="Cross-section"
          unit="mm²"
          value={c.conductor.area_mm2}
          onChange={(v) => setCond({ area_mm2: num(v) })}
        />
        <NumField
          id="cond-d"
          label={three && tc.shape === 'sector' ? 'Equivalent round diameter dx' : 'Conductor diameter'}
          unit="mm"
          value={c.conductor.diameter_mm}
          onChange={(v) => setCond({ diameter_mm: num(v) })}
          hint={
            three && tc.shape === 'sector'
              ? 'Diameter of a round conductor with the same area and compaction (IEC 60287-2-1 4.1.2.2.6).'
              : undefined
          }
        />
        <NumField
          id="cond-r20"
          label="DC resistance at 20 °C"
          unit="Ω/km"
          value={c.conductor.R20_ohm_km}
          onChange={(v) => setCond({ R20_ohm_km: num(v) })}
          hint="Maximum value from the datasheet (IEC 60228)."
        />
        <Overrides label="Datasheet AC resistance and ks, kp">
          <NumField
            id="cond-rac"
            label={`AC resistance at ${c.maxTemp_C} °C`}
            unit="Ω/km"
            optional
            value={c.conductor.Rac_ohm_km}
            onChange={(v) => setCond({ Rac_ohm_km: v })}
            placeholder="calculated"
            hint="Leave empty to calculate skin and proximity effects."
          />
          <NumField
            id="cond-ks"
            label="Skin effect ks"
            optional
            value={c.conductor.ks}
            onChange={(v) => setCond({ ks: v })}
            placeholder={`${dflt.ks} (Table 2)`}
          />
          <NumField
            id="cond-kp"
            label="Proximity effect kp"
            optional
            value={c.conductor.kp}
            onChange={(v) => setCond({ kp: v })}
            placeholder={`${dflt.kp} (Table 2)`}
          />
        </Overrides>
      </Section>

      <Section title="Insulation">
        <SelectField
          id="ins-mat"
          label="Material"
          value={c.insulation.material}
          options={insulationOptions}
          onChange={(material) => set({ insulation: { ...c.insulation, material }, maxTemp_C: INSULATIONS[material].maxTemp_C })}
        />
        <NumField
          id="cs-t"
          label="Conductor screen"
          unit="mm"
          value={c.conductorScreen_mm}
          onChange={(v) => set({ conductorScreen_mm: num(v) })}
        />
        <NumField
          id="ins-t"
          label="Insulation thickness"
          unit="mm"
          value={c.insulation.thickness_mm}
          onChange={(v) => setIns({ thickness_mm: num(v) })}
        />
        <NumField
          id="is-t"
          label="Insulation screen"
          unit="mm"
          value={c.insulationScreen_mm}
          onChange={(v) => set({ insulationScreen_mm: num(v) })}
        />
        {!three && !noScreen && (
          <NumField
            id="bed-t"
            label="Tapes under metallic screen"
            unit="mm"
            value={c.bedding_mm}
            onChange={(v) => set({ bedding_mm: num(v) })}
            hint="Swelling or bedding tapes. Counted as insulation in T1."
          />
        )}
        <Overrides>
          <NumField
            id="ins-rho"
            label="Thermal resistivity ρT"
            unit="K·m/W"
            optional
            value={c.insulation.rhoT}
            onChange={(v) => setIns({ rhoT: v })}
            placeholder={`${ins.rhoT}`}
          />
          <NumField
            id="ins-eps"
            label="Permittivity εr"
            optional
            value={c.insulation.epsR}
            onChange={(v) => setIns({ epsR: v })}
            placeholder={`${ins.epsR}`}
          />
          <NumField
            id="ins-tan"
            label="Loss factor tan δ"
            optional
            value={c.insulation.tanDelta}
            onChange={(v) => setIns({ tanDelta: v })}
            placeholder={`${ins.tanDelta}`}
          />
        </Overrides>
      </Section>

{three ? (
      <Section title="Cores and inner covering">
        <NumField
          id="tc-cover"
          label="Inner covering (filler)"
          unit="mm"
          optional
          value={tc.innerCovering_mm}
          onChange={(v) => setTc({ innerCovering_mm: v })}
          placeholder={Number.isFinite(g.threeCore?.innerCovering ?? NaN) ? `${fmt(g.threeCore!.innerCovering, 1)} ${c.overallDiameter_mm ? 'from ⌀' : ''}`.trim() : undefined}
          hint="Extruded filler over the laid-up cores. Left empty, it is worked out from the datasheet overall diameter."
        />
        <NumField
          id="tc-r1"
          label="Circle around the conductors r1"
          unit="mm"
          optional
          value={tc.r1_mm}
          onChange={(v) => setTc({ r1_mm: v })}
          placeholder={Number.isFinite(g.threeCore?.r1 ?? NaN) ? `${fmt(g.threeCore!.r1, 1)} calculated` : undefined}
          hint="Radius of the circle touching the outside of the three conductors."
        />
        {tc.shape === 'round' && (
          <NumField
            id="tc-filler"
            label="Filler resistivity ρf"
            unit="K·m/W"
            optional
            value={tc.fillerRho}
            onChange={(v) => setTc({ fillerRho: v })}
            placeholder="10"
            hint="IEC 60287-2-1 4.1.2.2.4 suggests 6 to 13 K·m/W for extruded cables."
          />
        )}
      </Section>

) : (
      <Section title="Metallic screen or sheath">
        <Segmented
          id="scr-form"
          label="Type"
          value={c.screen.form}
          options={[
            { value: 'wires', label: 'Wire screen' },
            { value: 'smooth', label: 'Smooth sheath' },
            { value: 'corrugated', label: 'Corrugated' },
            { value: 'none', label: 'None' },
          ]}
          onChange={(form) => setScr({ form })}
        />
        {noScreen ? (
          <p className="field-hint field-wide">No metallic screen or sheath (for example NA2XY, N2XY): no screen losses.</p>
        ) : (
          <>
        <SelectField
          id="scr-mat"
          label="Material"
          value={c.screen.material}
          options={metalOptions}
          onChange={(material) => setScr({ material })}
        />
        <NumField
          id="scr-t"
          label={c.screen.form === 'wires' ? 'Wire diameter' : 'Sheath thickness'}
          unit="mm"
          value={c.screen.thickness_mm}
          onChange={(v) => setScr({ thickness_mm: num(v) })}
        />
        {c.screen.form === 'wires' && (
          <NumField
            id="scr-n"
            label="Number of wires"
            optional
            value={c.screen.wireCount}
            onChange={(v) => setScr({ wireCount: v })}
          />
        )}
        {c.screen.form === 'corrugated' && (
          <NumField
            id="scr-doc"
            label="Diameter over crests Doc"
            unit="mm"
            value={c.screen.corrugationOD_mm}
            onChange={(v) => setScr({ corrugationOD_mm: v })}
          />
        )}
        <NumField
          id="scr-a"
          label="Cross-section"
          unit="mm²"
          optional={c.screen.form !== 'wires'}
          value={c.screen.area_mm2}
          onChange={(v) => setScr({ area_mm2: v })}
          placeholder={c.screen.form === 'smooth' ? 'π·d·t' : undefined}
        />
        <NumField
          id="scr-r"
          label="DC resistance at 20 °C"
          unit="Ω/km"
          optional
          value={c.screen.R20_ohm_km}
          onChange={(v) => setScr({ R20_ohm_km: v })}
          placeholder="from area"
          hint="Use the datasheet value if given; it replaces the area-based resistance."
        />
          </>
        )}
      </Section>

)}
      <Section title="Oversheath">
        <SelectField
          id="jac-mat"
          label="Material"
          value={c.jacket.material}
          options={jacketOptions}
          onChange={(material) => setJac({ material })}
        />
        <NumField
          id="jac-t"
          label="Thickness"
          unit="mm"
          value={c.jacket.thickness_mm}
          onChange={(v) => setJac({ thickness_mm: num(v) })}
        />
        <NumField
          id="jac-rho"
          label="Thermal resistivity ρT"
          unit="K·m/W"
          optional={c.jacket.material !== 'custom'}
          value={c.jacket.rhoT}
          onChange={(v) => setJac({ rhoT: v })}
          placeholder={`${JACKETS[c.jacket.material].rhoT}`}
        />
        <NumField
          id="de"
          label="Overall diameter (datasheet)"
          unit="mm"
          optional
          value={c.overallDiameter_mm}
          onChange={(v) => set({ overallDiameter_mm: v })}
          placeholder={Number.isFinite(g.DeBuilt) ? `${fmt(g.DeBuilt, 1)} built up` : undefined}
          hint="Used for the external thermal resistance when entered."
        />
      </Section>

      <Section title="Built-up diameters">
        <table className="mini-table field-wide">
          <tbody>
            {(three && g.threeCore
              ? [
                  ['Circle around conductors 2·r1', 2 * g.threeCore.r1],
                  ['Over the laid-up cores', g.threeCore.layD],
                  ['Under oversheath da', g.threeCore.da],
                  ['Overall De', g.De],
                ]
              : noScreen
                ? [
                    ['Over conductor screen', g.dcScreen],
                    ['Over insulation', g.Di],
                    ['Under oversheath', g.Da],
                    ['Overall De', g.De],
                  ]
                : [
                    ['Over conductor screen', g.dcScreen],
                    ['Over insulation', g.Di],
                    ['Under metallic screen', g.Dunder],
                    ['Mean screen diameter d', g.dMean],
                    ['Over metallic screen Ds', g.Ds],
                    ['Overall De', g.De],
                  ]
            ).map(([k, v]) => (
              <tr key={k as string}>
                <th scope="row">{k}</th>
                <td>{fmt(v as number, 1)} mm</td>
              </tr>
            ))}
            {!three && !noScreen && (
              <tr>
                <th scope="row">Screen cross-section</th>
                <td>{fmt(g.As, 1)} mm²</td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
