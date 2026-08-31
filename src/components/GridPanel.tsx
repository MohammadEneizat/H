import { useStudy } from '../state/store';
import { areaLabel, Callout, Card, CheckField, fmt, Grid, LengthField, NumberField, Ref, SelectField, Stat } from './ui';
import { COPPER_SIZES, CONDUCTOR_MATERIALS, gridGeometry } from '../engine';
import { GridPlan } from './GridPlan';

export function GridPanel() {
  const { study, patch, result } = useStudy();
  const g = study.grid;
  const a = study.auxiliary;
  const geom = gridGeometry(g);

  const setGrid = (p: Partial<typeof g>) => patch({ grid: { ...g, ...p } });
  const setAux = (p: Partial<typeof a>) => patch({ auxiliary: { ...a, ...p } });

  return (
    <>
      <Card
        title="Main below-grade grid"
        subtitle={<><Ref>IEEE Std 2778-2020, 5.3.1</Ref> — spacing sized to surround each block of generation</>}
      >
        <Callout kind="ref">
          A common SPP design is "an interconnected grounding system with very large grid spacing (in excess of 100 m
          (350 ft))", chosen to surround each 1 MW to 4 MW block. This is an order of magnitude looser than the 5 m to
          15 m of a substation, and it is why the closed-form equations below are a screening tool rather than a final
          design basis.
        </Callout>

        <Grid cols={3}>
          <LengthField label="Grid extent, X" meters={g.lengthX} units={study.units} onChange={(v) => setGrid({ lengthX: v })} />
          <LengthField label="Grid extent, Y" meters={g.lengthY} units={study.units} onChange={(v) => setGrid({ lengthY: v })} />
          <LengthField
            label="Conductor spacing D"
            meters={g.spacing}
            units={study.units}
            onChange={(v) => setGrid({ spacing: v })}
            hint={g.spacing > 100 ? <span className="hint-warn">Beyond the range of IEEE Std 80 closed forms.</span> : undefined}
          />
          <LengthField label="Burial depth h" meters={g.depth} units={study.units} onChange={(v) => setGrid({ depth: v })} />
          <SelectField
            label="Conductor size"
            value={COPPER_SIZES.find((s) => Math.abs(s.areaMm2 - g.conductorAreaMm2) < 0.5)?.id ?? 'custom'}
            onChange={(id) => {
              const s = COPPER_SIZES.find((x) => x.id === id);
              if (s) setGrid({ conductorAreaMm2: s.areaMm2, conductorDiameterM: s.diameterM });
            }}
            options={[
              ...COPPER_SIZES.map((s) => ({ value: s.id, label: `${s.awg} — ${s.areaMm2} mm²` })),
              { value: 'custom', label: 'Custom (set area and diameter below)' },
            ]}
          />
          <SelectField
            label="Conductor material"
            value={g.materialId}
            onChange={(v) => setGrid({ materialId: v })}
            options={CONDUCTOR_MATERIALS.map((m) => ({ value: m.id, label: m.name }))}
          />
          <NumberField
            label="Conductor area"
            value={g.conductorAreaMm2}
            unit="mm²"
            onChange={(v) => setGrid({ conductorAreaMm2: v })}
          />
          <NumberField
            label="Conductor diameter d"
            value={g.conductorDiameterM * 1000}
            unit="mm"
            onChange={(v) => setGrid({ conductorDiameterM: v / 1000 })}
          />
          <div />
        </Grid>

        <div className="stat-row">
          <Stat label="Enclosed area A" value={areaLabel(geom.area, study.units)} />
          <Stat label="Buried conductor Lc" value={fmt(geom.conductorLength, 0)} unit="m" />
          <Stat label="Grid runs" value={`${geom.linesY} × ${geom.linesX}`} note="parallel to Y × parallel to X" />
          <Stat label="Perimeter Lp" value={fmt(geom.perimeter, 0)} unit="m" />
        </div>

        <GridPlan />
      </Card>

      <Card title="Driven ground rods" subtitle={<><Ref>IEEE Std 2778-2020, 5.3.3</Ref></>}>
        <Callout kind="ref">
          Rods "generally provide little benefit in an extremely large grounding system except to provide some local
          reduction of touch voltages (including locations such as fence corners or gates), or where a shallow high
          resistivity layer exists" that rods can penetrate. The guide notes that examining the soil structure can avoid
          "hundreds or thousands of unnecessary ground rods", and warns that concentrating rods can even raise voltages
          nearby by drawing more fault current into that area.
        </Callout>
        <Grid cols={4}>
          <NumberField label="Rod count" value={g.rodCount} min={0} step={1} onChange={(v) => setGrid({ rodCount: Math.max(0, Math.round(v)) })} />
          <LengthField label="Rod length" meters={g.rodLength} units={study.units} onChange={(v) => setGrid({ rodLength: v })} />
          <NumberField
            label="Rod diameter"
            value={g.rodDiameterM * 1000}
            unit="mm"
            onChange={(v) => setGrid({ rodDiameterM: v / 1000 })}
          />
          <CheckField
            label="Rods in corners and along perimeter"
            checked={g.rodsOnPerimeter}
            onChange={(v) => setGrid({ rodsOnPerimeter: v })}
            hint="Sets Kii = 1 and the enhanced LM of IEEE Std 80 Eq (86)."
          />
        </Grid>
      </Card>

      <Card
        title="Auxiliary grounding — PV array steel"
        subtitle={<><Ref>IEEE Std 2778-2020, 4.3 and 5.4.2</Ref></>}
      >
        <Callout kind="ref">
          Driven array posts in solid contact with native soil act as short ground rods and materially reduce the
          required copper. Sensitivity studies cited in 5.4.2 found that ignoring auxiliary grounding "would have
          resulted in grid spacing about three times as dense on several large-scale projects, using nine times the
          grounding material for a compliant design." The credit is only real if the path is electrically continuous
          across every joint, and posts that are coated, set in gravel backfill, or otherwise not in solid contact with
          native soil must be discounted.
        </Callout>

        <Grid cols={3}>
          <CheckField
            label="Credit auxiliary array grounding"
            checked={a.enabled}
            onChange={(v) => setAux({ enabled: v })}
          />
          <NumberField
            label="Posts in the region of analysis"
            value={a.postCount}
            min={0}
            step={1}
            onChange={(v) => setAux({ postCount: Math.max(0, Math.round(v)) })}
          />
          <NumberField
            label="Fraction in solid soil contact"
            value={a.contactFraction}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => setAux({ contactFraction: Math.min(Math.max(v, 0), 1) })}
            hint="Discount coated posts and gravel backfill."
          />
          <LengthField label="Embedded post length" meters={a.postLength} units={study.units} onChange={(v) => setAux({ postLength: v })} />
          <NumberField
            label="Equivalent post diameter"
            value={a.postDiameterM * 1000}
            unit="mm"
            onChange={(v) => setAux({ postDiameterM: v / 1000 })}
          />
          <LengthField label="Post spacing" meters={a.postSpacing} units={study.units} onChange={(v) => setAux({ postSpacing: v })} />
        </Grid>

        {result.auxiliary && (
          <>
            <div className="stat-row">
              <Stat label="Posts credited" value={fmt(result.auxiliary.effectiveCount, 0)} />
              <Stat label="One post alone" value={fmt(result.auxiliary.singleRodResistance, 2)} unit="Ω" />
              <Stat label="Post network" value={fmt(result.auxiliary.assemblyResistance, 3)} unit="Ω" />
              <Stat
                label="Equivalent rod length"
                value={fmt(result.auxiliary.equivalentRodLength, 1)}
                unit="m"
                note="Hybrid model substitute for the block"
              />
            </div>
            <p className="note">
              Mutual coupling makes the network {fmt(result.auxiliary.couplingFactor, 1)}× the resistance that{' '}
              {fmt(result.auxiliary.effectiveCount, 0)} independent posts would present. IEEE Std 2778-2020, 5.4.2 warns
              this term "can be a significant contributor to the overall resistance of an equivalent" and must not be
              omitted. The equivalent rod length is what you would substitute for this block in a full-plant model.
            </p>
          </>
        )}
      </Card>
    </>
  );
}
