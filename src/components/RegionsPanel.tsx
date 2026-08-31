import { useStudy } from '../state/store';
import { Badge, Callout, Card, CheckField, fmt, Grid, LengthField, NumberField, Ref, SelectField, TextField } from './ui';
import { SoilLayerEditor } from './SoilPanel';
import { makeRegion, SURFACE_MATERIALS, type Region } from '../engine';

export function RegionsPanel() {
  const { study, patch, result } = useStudy();

  const update = (id: string, next: Partial<Region>) =>
    patch({ regions: study.regions.map((r) => (r.id === id ? { ...r, ...next } : r)) });

  return (
    <>
      <Card
        title="Regional analysis"
        subtitle={<><Ref>IEEE Std 2778-2020, 5.2.4 and 5.4.2</Ref></>}
        actions={
          <button
            className="btn btn-primary"
            onClick={() => patch({ regions: [...study.regions, makeRegion(`Region ${study.regions.length + 1}`)] })}
          >
            + Region
          </button>
        }
      >
        <Callout kind="ref">
          A single worst-case fault does not characterise a plant of this size. The guide asks for analysis "at a
          reasonable sampling of line-to-ground fault locations throughout the SPP", noting that fault values "are often
          significantly lower far away from the main collector substation" and that where protection uses time
          overcurrent elements, clearing time varies with the current, so "selecting a single worst-case fault current
          may be difficult, and analyzing multiple faults is likely required." Each region below carries its own soil
          model, fault duty, and surfacing.
        </Callout>
      </Card>

      {study.regions.map((region) => {
        const r = result.regions.find((x) => x.regionId === region.id);
        const governing = result.governingRegionId === region.id;
        return (
          <Card
            key={region.id}
            title={region.name}
            subtitle={
              r ? (
                <>
                  ρ equivalent {fmt(r.rhoEquivalent, 1)} Ω·m · GPR {fmt(r.gpr, 0)} V · IG{' '}
                  {fmt(r.current.maxGridCurrent, 0)} A {governing && <b className="governing">· governing region</b>}
                </>
              ) : undefined
            }
            actions={
              <div className="card-actions">
                {r && <Badge verdict={r.touchWithDropCheck.verdict} />}
                <button
                  className="btn btn-ghost btn-danger"
                  disabled={study.regions.length <= 1}
                  onClick={() => patch({ regions: study.regions.filter((x) => x.id !== region.id) })}
                >
                  Remove
                </button>
              </div>
            }
          >
            <Grid cols={2}>
              <TextField label="Region name" value={region.name} onChange={(v) => update(region.id, { name: v })} />
              <CheckField
                label="Inside the plant (qualified personnel only)"
                checked={region.insidePlant}
                onChange={(v) => update(region.id, { insidePlant: v })}
                hint="Controls whether footwear credit may be applied here."
              />
            </Grid>

            <h4 className="sub-head">Fault data <Ref>IEEE Std 2778-2020, 5.2</Ref></h4>
            <Grid cols={3}>
              <NumberField
                label="Line-to-ground fault current 3I₀"
                value={region.faultCurrent}
                unit="A"
                onChange={(v) => update(region.id, { faultCurrent: v })}
              />
              <NumberField
                label="System X/R"
                value={region.xOverR}
                onChange={(v) => update(region.id, { xOverR: v })}
                hint={r ? `Df = ${fmt(r.current.decrementFactor, 3)}` : undefined}
              />
              <NumberField
                label="Split factor Sf"
                value={region.splitFactor}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => update(region.id, { splitFactor: Math.min(Math.max(v, 0), 1) })}
                hint={
                  region.splitFactor < 1 ? (
                    <span className="hint-warn">Must come from a detailed model, not IEEE Std 80 Annex C.</span>
                  ) : (
                    'Sf = 1.0 takes no split credit.'
                  )
                }
              />
              <NumberField
                label="Fault duration tf"
                value={region.faultDuration}
                unit="s"
                step={0.05}
                onChange={(v) => update(region.id, { faultDuration: v })}
                hint="Drives the decrement factor."
              />
              <NumberField
                label="Shock duration ts"
                value={region.shockDuration}
                unit="s"
                step={0.05}
                onChange={(v) => update(region.id, { shockDuration: v })}
                hint="Drives the tolerable voltages."
              />
              <LengthField
                label="Run length to main grid tie"
                meters={region.auxRunLength}
                units={study.units}
                onChange={(v) => update(region.id, { auxRunLength: v })}
                hint="For the I·R drop check of 4.3 / 5.4.1."
              />
              <NumberField
                label="Parallel paths on that run"
                value={region.auxRunPaths}
                min={1}
                step={1}
                onChange={(v) => update(region.id, { auxRunPaths: Math.max(1, Math.round(v)) })}
                hint={
                  r
                    ? `${fmt(r.auxRunFraction * 100, 0)}% of IG takes this path (${fmt(r.auxRunCurrent, 0)} A)`
                    : 'A row bonded at one end is 1; a closed loop is 2.'
                }
              />
            </Grid>

            <h4 className="sub-head">Local soil model <Ref>IEEE Std 2778-2020, 5.1.2</Ref></h4>
            <SoilLayerEditor layers={region.soil} onChange={(soil) => update(region.id, { soil })} />

            <h4 className="sub-head">Surfacing <Ref>IEEE Std 2778-2020, 5.3.4</Ref></h4>
            <Grid cols={3}>
              <SelectField
                label="Surfacing material"
                value={region.surface.materialId}
                onChange={(id) => {
                  const s = SURFACE_MATERIALS.find((x) => x.id === id)!;
                  update(region.id, {
                    surface: {
                      materialId: id,
                      rhoS: s.wet,
                      thickness: id === 'native' ? 0 : region.surface.thickness || 0.102,
                    },
                  });
                }}
                options={SURFACE_MATERIALS.map((s) => ({ value: s.id, label: s.name }))}
                hint="Crushed rock is often not required across an SPP; apply it only where needed."
              />
              <NumberField
                label="Surface resistivity ρs"
                value={region.surface.rhoS}
                unit="Ω·m"
                disabled={region.surface.materialId === 'native'}
                onChange={(v) => update(region.id, { surface: { ...region.surface, rhoS: v } })}
              />
              <NumberField
                label="Surface thickness hs"
                value={region.surface.thickness}
                unit="m"
                step={0.025}
                disabled={region.surface.materialId === 'native'}
                onChange={(v) => update(region.id, { surface: { ...region.surface, thickness: v } })}
                hint={r ? `Cs = ${fmt(r.tolerance.cs, 3)}` : undefined}
              />
            </Grid>

            {r && r.warnings.length > 0 && (
              <div className="warn-list">
                {r.warnings.map((w, i) => (
                  <Callout kind="warn" key={i}>
                    {w}
                  </Callout>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </>
  );
}
