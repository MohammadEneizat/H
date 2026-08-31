import { useStudy } from '../state/store';
import { Callout, Card, fmt, Grid, NumberField, Ref, SelectField, Stat } from './ui';
import { CONDUCTOR_MATERIALS, COPPER_SIZES, getMaterial, sizeConductor } from '../engine';

export function ConductorPanel() {
  const { study, patch, result } = useStudy();
  const s = study.sizing;
  const setSizing = (p: Partial<typeof s>) => patch({ sizing: { ...s, ...p } });
  const material = getMaterial(s.materialId);

  const required = result.sizing;
  const selected = study.grid.conductorAreaMm2;
  const adequate = selected >= required.areaMm2;

  // Smallest catalogue size that satisfies the thermal requirement.
  const recommended = COPPER_SIZES.find((x) => x.areaMm2 >= required.areaMm2);

  return (
    <>
      <Card title="Ground conductor sizing" subtitle={<><Ref>IEEE Std 80-2013, Equation (37)</Ref></>}>
        <Callout kind="ref">
          The conductor must carry the maximum asymmetrical fault current for the full clearing time without exceeding
          the fusing temperature of the material or, more often, the temperature limit of its joints. Sizing here is
          driven by the highest grid current of any region in the study. Mechanical robustness and corrosion allowance
          usually govern in practice — 2/0 AWG copper is the common minimum for a directly buried grid.
        </Callout>

        <Grid cols={4}>
          <SelectField
            label="Material"
            value={s.materialId}
            onChange={(v) => {
              const m = CONDUCTOR_MATERIALS.find((x) => x.id === v)!;
              setSizing({ materialId: v, maxTemp: Math.min(s.maxTemp, m.Tm) });
            }}
            options={CONDUCTOR_MATERIALS.map((m) => ({ value: m.id, label: m.name }))}
          />
          <NumberField label="Ambient temperature Ta" value={s.ambientTemp} unit="°C" onChange={(v) => setSizing({ ambientTemp: v })} />
          <NumberField
            label="Maximum temperature Tm"
            value={s.maxTemp}
            unit="°C"
            onChange={(v) => setSizing({ maxTemp: v })}
            hint={`Fusing point of this material is ${material.Tm} °C. Use 250 °C for brazed joints, 450 °C for bolted.`}
          />
          <NumberField label="Duration tc" value={s.duration} unit="s" step={0.05} onChange={(v) => setSizing({ duration: v })} />
        </Grid>

        <div className="stat-row">
          <Stat label="Governing current" value={fmt(result.sizingGoverningCurrent, 0)} unit="A" note="Highest IG across regions" />
          <Stat label="Required area" value={fmt(required.areaMm2, 1)} unit="mm²" />
          <Stat label="Required area" value={fmt(required.areaKcmil, 1)} unit="kcmil" />
          <Stat
            label="Selected conductor"
            value={fmt(selected, 1)}
            unit="mm²"
            tone={adequate ? 'pass' : 'fail'}
            note={adequate ? 'Thermally adequate' : 'Below the thermal requirement'}
          />
        </div>

        {!adequate && recommended && (
          <Callout kind="warn" title="Increase the conductor size">
            The grid conductor selected on the Grid tab ({fmt(selected, 1)} mm²) is below the {fmt(required.areaMm2, 1)}{' '}
            mm² required for {fmt(result.sizingGoverningCurrent, 0)} A over {s.duration} s. The smallest catalogue size
            that satisfies it is <b>{recommended.awg}</b> ({recommended.areaMm2} mm²).
          </Callout>
        )}

        <table className="data-table compact">
          <tbody>
            <tr>
              <th>Thermal capacity TCAP</th>
              <td className="num">{material.TCAP} J/(cm³·°C)</td>
              <th>Resistivity at 20 °C, ρr</th>
              <td className="num">{material.rhoR} µΩ·cm</td>
            </tr>
            <tr>
              <th>Thermal coefficient αr</th>
              <td className="num">{material.alphaR} /°C</td>
              <th>K₀ = 1/α₀ − 20</th>
              <td className="num">{material.K0} °C</td>
            </tr>
            <tr>
              <th>Conductivity</th>
              <td className="num">{material.conductivityPct}% IACS</td>
              <th>Temperature used</th>
              <td className="num">{required.maxTemp} °C</td>
            </tr>
          </tbody>
        </table>
      </Card>

      <Card title="Sizing across candidate materials" subtitle="Same duty, at each material's own temperature limit.">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Conductivity</th>
                <th>Tm (°C)</th>
                <th>Required area (mm²)</th>
                <th>Required (kcmil)</th>
                <th>Relative to copper</th>
              </tr>
            </thead>
            <tbody>
              {CONDUCTOR_MATERIALS.map((m) => {
                const r = sizeConductor(result.sizingGoverningCurrent, s.duration, m.id, s.ambientTemp);
                const cu = sizeConductor(result.sizingGoverningCurrent, s.duration, 'cu-annealed', s.ambientTemp);
                return (
                  <tr key={m.id} className={m.id === s.materialId ? 'row-active' : undefined}>
                    <td>{m.name}</td>
                    <td className="num">{m.conductivityPct}%</td>
                    <td className="num">{m.Tm}</td>
                    <td className="num">{fmt(r.areaMm2, 1)}</td>
                    <td className="num">{fmt(r.areaKcmil, 1)}</td>
                    <td className="num">{fmt(r.areaMm2 / cu.areaMm2, 2)}×</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
