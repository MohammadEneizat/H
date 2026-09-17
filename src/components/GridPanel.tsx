import { useStudy } from '../state/store';
import { areaLabel, Callout, Card, CheckField, fmt, Grid, LengthField, NumberField, Ref, SelectField, Stat } from './ui';
import {
  CONDUCTOR_MATERIALS,
  CONDUCTOR_SIZES,
  COPPER_SIZES,
  FLAT_SIZES,
  flatStripEquivalentDiameter,
  getMaterial,
  gridGeometry,
} from '../engine';
import { GridPlan } from './GridPlan';

export function GridPanel() {
  const { study, patch, result } = useStudy();
  const g = study.grid;
  const a = study.auxiliary;
  const geom = gridGeometry(g);
  // Area alone is ambiguous once flat sections are in the catalogue (40 x 4 mm galvanised steel and
  // 40 x 4 mm copper tape share 160 mm²), so match on section, diameter and material together.
  const selectedSize = CONDUCTOR_SIZES.find(
    (s) =>
      Math.abs(s.areaMm2 - g.conductorAreaMm2) < 0.5 &&
      Math.abs(s.diameterM - g.conductorDiameterM) < 1e-4 &&
      s.materialId === g.materialId,
  );

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
            value={selectedSize?.id ?? 'custom'}
            onChange={(id) => {
              const s = CONDUCTOR_SIZES.find((x) => x.id === id);
              if (s) {
                setGrid({
                  conductorAreaMm2: s.areaMm2,
                  conductorDiameterM: s.diameterM,
                  materialId: s.materialId,
                });
              }
            }}
            options={[
              ...COPPER_SIZES.map((s) => ({ value: s.id, label: `Round — ${s.label} (${s.areaMm2} mm²)` })),
              ...FLAT_SIZES.map((s) => ({
                value: s.id,
                label: `Flat ${s.materialId === 'zn-steel-rod' ? 'galv. steel' : 'copper'} — ${s.label} (${s.areaMm2} mm²)`,
              })),
              { value: 'custom', label: 'Custom (set area and diameter below)' },
            ]}
            hint="Choosing a section also selects the material it is normally supplied in."
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
            label={selectedSize?.shape === 'flat' ? 'Equivalent diameter d' : 'Conductor diameter d'}
            value={g.conductorDiameterM * 1000}
            unit="mm"
            onChange={(v) => setGrid({ conductorDiameterM: v / 1000 })}
            hint={
              selectedSize?.shape === 'flat'
                ? `(w + t)/2 for a ${selectedSize.label} strip`
                : 'Overall diameter of the stranded conductor.'
            }
          />
          <div />
        </Grid>

        <div className="stat-row">
          <Stat label="Enclosed area A" value={areaLabel(geom.area, study.units)} />
          <Stat label="Buried conductor Lc" value={fmt(geom.conductorLength, 0)} unit="m" />
          <Stat label="Grid runs" value={`${geom.linesY} × ${geom.linesX}`} note="parallel to Y × parallel to X" />
          <Stat label="Perimeter Lp" value={fmt(geom.perimeter, 0)} unit="m" />
        </div>

        {selectedSize?.shape === 'flat' && <FlatStripNote size={selectedSize} />}

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


/**
 * Explains what substituting a flat strip actually changes. The two effects pull in opposite
 * directions, which is the part that is easy to get wrong when swapping copper for steel.
 */
function FlatStripNote({ size }: { size: (typeof CONDUCTOR_SIZES)[number] }) {
  const material = getMaterial(size.materialId);
  const copper = getMaterial('cu-annealed');
  const dEq = flatStripEquivalentDiameter(size.widthMm ?? 0, size.thicknessMm ?? 0);
  const reference = COPPER_SIZES.find((c) => c.id === '2/0')!;
  const resistivityRatio = material.resistivityOhmM / copper.resistivityOhmM;

  return (
    <Callout kind="info" title={`${size.label} flat section — ${material.name.toLowerCase()}`}>
      <p>
        The IEEE Std 80 equations take the diameter of a round conductor, so the strip enters as an
        equivalent diameter of <b>{fmt(dEq, 1)} mm</b> — (w + t)/2, which in the thin-strip limit is the
        exact classical result. That is {fmt(dEq / (reference.diameterM * 1000), 1)}× the diameter of 2/0
        copper, and a larger d <b>lowers</b> Km and therefore the mesh voltage.
      </p>
      {material.id !== 'cu-annealed' && (
        <p>
          Working the other way, this material's resistivity is <b>{fmt(resistivityRatio, 1)}×</b> that of
          copper, so the longitudinal I·R drop along the run back to the main grid rises in proportion —
          the effect <Ref>IEEE Std 2778-2020, 4.3 and 5.4.1</Ref> singles out. Check the touch voltage
          including that drop on the Results tab, not the mesh voltage alone.
        </p>
      )}
      {material.id === 'zn-steel-rod' && (
        <p>
          Thermal sizing uses Tm = {material.Tm} °C, the melting point of the zinc coating rather than of
          the steel. That preserves the galvanising, and is the conservative basis for a buried conductor
          whose corrosion protection matters. Pairing galvanised steel strip with galvanised steel array
          posts also avoids the dissimilar-metal junction that <Ref>IEEE Std 2778-2020, 4.3</Ref> flags as
          a galvanic corrosion concern where grounding conductor meets equipment frames.
        </p>
      )}
    </Callout>
  );
}
