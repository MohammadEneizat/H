import { useStudy } from '../state/store';
import { Callout, Card, CheckField, Grid, NumberField, Ref, SelectField, TextField } from './ui';
import type { BodyWeight, UnitSystem } from '../engine';
import { FOOTWEAR_PRESETS } from '../engine';

export function ProjectPanel() {
  const { study, patch, reset } = useStudy();
  const m = study.meta;

  return (
    <>
      <Card
        title="Project"
        subtitle="Identification carried through to the calculation report."
        actions={
          <button className="btn btn-ghost" onClick={reset}>
            Reset to defaults
          </button>
        }
      >
        <Grid cols={2}>
          <TextField label="Project name" value={m.name} onChange={(v) => patch({ meta: { ...m, name: v } })} />
          <TextField label="Client" value={m.client} onChange={(v) => patch({ meta: { ...m, client: v } })} />
          <TextField label="Location" value={m.location} onChange={(v) => patch({ meta: { ...m, location: v } })} />
          <TextField
            label="Engineer of record"
            value={m.engineer}
            onChange={(v) => patch({ meta: { ...m, engineer: v } })}
          />
          <TextField label="Date" type="date" value={m.date} onChange={(v) => patch({ meta: { ...m, date: v } })} />
          <NumberField
            label="Plant capacity"
            value={m.plantCapacityMW}
            unit="MW"
            onChange={(v) => patch({ meta: { ...m, plantCapacityMW: v } })}
            hint={
              m.plantCapacityMW < 5 ? (
                <span className="hint-warn">
                  Below 5 MW this guide does not apply — see <Ref>IEEE Std 2778-2020, 1.1</Ref>.
                </span>
              ) : undefined
            }
          />
        </Grid>
        <label className="field">
          <span className="field-label">Notes</span>
          <textarea
            rows={3}
            value={m.notes}
            onChange={(e) => patch({ meta: { ...m, notes: e.target.value } })}
            placeholder="Design basis, assumptions, deviations…"
          />
        </label>
      </Card>

      <Card title="Analysis basis" subtitle="Applies to every region of the plant.">
        <Grid cols={3}>
          <SelectField<UnitSystem>
            label="Units"
            value={study.units}
            onChange={(v) => patch({ units: v })}
            options={[
              { value: 'SI', label: 'Metric (m)' },
              { value: 'US', label: 'US customary (ft)' },
            ]}
          />
          <SelectField
            label="Body criterion"
            value={String(study.bodyWeight)}
            onChange={(v) => patch({ bodyWeight: Number(v) as BodyWeight })}
            options={[
              { value: '50', label: '50 kg body' },
              { value: '70', label: '70 kg body' },
            ]}
            hint={<>Sets k in IB = k/√ts — <Ref>IEEE Std 80-2013 Eq (10)–(12)</Ref>.</>}
          />
          <SelectField
            label="Equivalent soil reduction"
            value={study.equivalentSoilMethod}
            onChange={(v) => patch({ equivalentSoilMethod: v as typeof study.equivalentSoilMethod })}
            options={[
              { value: 'apparent', label: 'Apparent resistivity at depth' },
              { value: 'arithmetic', label: 'Thickness-weighted mean' },
              { value: 'harmonic', label: 'Conductance-weighted mean' },
            ]}
            hint="How a layered model collapses to the single ρ the closed-form equations need."
          />
        </Grid>
        <Grid cols={2}>
          <NumberField
            label="Depth of investigation"
            value={study.influenceDepth}
            unit="m"
            onChange={(v) => patch({ influenceDepth: v })}
            hint="Depth over which the soil model is averaged. Leave 0 to use √A."
          />
          <div />
        </Grid>
      </Card>

      <Card
        title="Footwear and glove credit"
        subtitle={
          <>
            Permitted inside the plant only — <Ref>IEEE Std 2778-2020, 5.4.4</Ref>
          </>
        }
      >
        <Callout kind="ref">
          The guide states that inside an SPP, which "should be only accessible to qualified personnel," it may be
          practical to credit shoe resistance, with "common values used … in the range of 1000 Ω to 2000 Ω (and may be
          greater in many instances), adding significant margin to compliance limits." The credit is applied by
          increasing the foot impedance in the IEEE Std 80 limit determination. It is withheld automatically for any
          region marked as outside the plant, and at the fence line.
        </Callout>
        <Grid cols={3}>
          <SelectField
            label="Footwear preset"
            value={
              FOOTWEAR_PRESETS.find((p) => p.ohms === study.footwearResistance)?.id ??
              (study.footwearResistance > 0 ? 'ehv-rated' : 'none')
            }
            onChange={(id) => {
              const preset = FOOTWEAR_PRESETS.find((p) => p.id === id);
              if (preset && preset.id !== 'ehv-rated') patch({ footwearResistance: preset.ohms });
            }}
            options={FOOTWEAR_PRESETS.map((p) => ({ value: p.id, label: p.name }))}
          />
          <NumberField
            label="Footwear resistance per foot"
            value={study.footwearResistance}
            unit="Ω"
            min={0}
            onChange={(v) => patch({ footwearResistance: Math.max(v, 0) })}
          />
          <NumberField
            label="Glove resistance (touch only)"
            value={study.gloveResistance}
            unit="Ω"
            min={0}
            onChange={(v) => patch({ gloveResistance: Math.max(v, 0) })}
            hint="Rated gloves, in series with the body for hand contact."
          />
        </Grid>
        {study.footwearResistance > 0 && (
          <Callout kind="warn" title="Credit taken">
            Compliance now depends on personal protective equipment. This is defensible only where the owner mandates
            and enforces it; the report states both the credited and the un-credited limits so a reviewer can see the
            dependency. Consider whether workers kneel or contact equipment in non-standard postures, which
            <Ref> IEEE Std 2778-2020, 5.4.4</Ref> raises explicitly.
          </Callout>
        )}
      </Card>

      <Card title="Perimeter fence" subtitle={<>Touch and transfer voltage — <Ref>IEEE Std 2778-2020, 4.4</Ref></>}>
        <Grid cols={2}>
          <CheckField
            label="Include fence analysis"
            checked={study.fence.enabled}
            onChange={(v) => patch({ fence: { ...study.fence, enabled: v } })}
          />
          <CheckField
            label="Fence bonded to the SPP grounding system"
            checked={study.fence.bonded}
            onChange={(v) => patch({ fence: { ...study.fence, bonded: v } })}
            hint="Bonding transfers fault voltage onto the fence."
          />
        </Grid>
        <Grid cols={2}>
          <NumberField
            label="Fence-to-plant separation"
            value={study.fence.separation}
            unit="m"
            onChange={(v) => patch({ fence: { ...study.fence, separation: v } })}
            hint="6 m or more is common where a perimeter road runs inside the fence."
          />
          <NumberField
            label="Fence potential as fraction of GPR"
            value={study.fence.potentialFraction}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => patch({ fence: { ...study.fence, potentialFraction: v } })}
            hint="Take from the detailed model where one exists."
          />
        </Grid>
      </Card>
    </>
  );
}
