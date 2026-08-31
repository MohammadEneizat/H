import { useStudy } from '../state/store';
import { Badge, Callout, Card, fmt, Ref, Stat } from './ui';
import type { Check, RegionResult } from '../engine';

export function ResultsPanel() {
  const { result } = useStudy();
  const governing = result.regions.find((r) => r.regionId === result.governingRegionId);

  return (
    <>
      <Card title="Compliance summary" subtitle="Worst case across every region and check.">
        <div className={`verdict-banner tone-${result.overall}`}>
          <div>
            <div className="verdict-title">
              {result.overall === 'pass'
                ? 'Design is compliant'
                : result.overall === 'marginal'
                  ? 'Design is marginal'
                  : 'Design exceeds tolerable limits'}
            </div>
            <div className="verdict-sub">
              {governing ? (
                <>
                  Governed by <b>{governing.regionName}</b> — touch margin{' '}
                  {fmt(governing.touchWithDropCheck.margin, 2)}×, step margin {fmt(governing.stepCheck.margin, 2)}×
                </>
              ) : (
                'No regions defined.'
              )}
            </div>
          </div>
          <Badge verdict={result.overall} />
        </div>

        {result.warnings.map((w, i) => (
          <Callout kind="warn" key={i}>
            {w}
          </Callout>
        ))}
      </Card>

      <Card title="Grid geometry and factors" subtitle={<><Ref>IEEE Std 80-2013, Equations (81)–(94)</Ref></>}>
        <div className="stat-row">
          <Stat label="Effective conductors n" value={fmt(result.factors.n, 2)} />
          <Stat label="Mesh factor Km" value={fmt(result.factors.km, 4)} />
          <Stat label="Step factor Ks" value={fmt(result.factors.ks, 4)} />
          <Stat label="Irregularity Ki" value={fmt(result.factors.ki, 3)} />
        </div>
        <table className="data-table compact">
          <tbody>
            <tr>
              <th>na</th><td className="num">{fmt(result.factors.na, 3)}</td>
              <th>nb</th><td className="num">{fmt(result.factors.nb, 3)}</td>
              <th>nc</th><td className="num">{fmt(result.factors.nc, 3)}</td>
              <th>nd</th><td className="num">{fmt(result.factors.nd, 3)}</td>
            </tr>
            <tr>
              <th>Kii</th><td className="num">{fmt(result.factors.kii, 4)}</td>
              <th>Kh</th><td className="num">{fmt(result.factors.kh, 4)}</td>
              <th>LM</th><td className="num">{fmt(result.factors.lm, 0)} m</td>
              <th>LS</th><td className="num">{fmt(result.factors.ls, 0)} m</td>
            </tr>
          </tbody>
        </table>
      </Card>

      {result.regions.map((r) => (
        <RegionResultCard key={r.regionId} r={r} governing={r.regionId === result.governingRegionId} />
      ))}

      {result.fence && (
        <Card title="Perimeter fence" subtitle={<><Ref>IEEE Std 2778-2020, 4.4</Ref></>}>
          <div className="stat-row">
            <Stat label="Assumed fence touch voltage" value={fmt(result.fence.touchVoltage, 0)} unit="V" />
            <Stat label="Tolerable touch (50 kg, no footwear credit)" value={fmt(result.fence.limit, 0)} unit="V" />
            <Stat
              label="Margin"
              value={`${fmt(result.fence.margin, 2)}×`}
              tone={result.fence.verdict}
            />
          </div>
          <p className="note">{result.fence.note}</p>
          <Callout kind="info">
            The 50 kg criterion and no footwear credit apply here because a person at the fence line may be a member of
            the public rather than qualified plant personnel. Where limits are exceeded, the guide's remedy is localised
            fence grounding or crushed rock "placed in those specific areas" rather than treating the whole perimeter.
          </Callout>
        </Card>
      )}

      <Card title="Method limitations" subtitle="Read before issuing these numbers.">
        <Callout kind="warn" title="These results are a screening calculation, not a final design">
          <p>
            <Ref>IEEE Std 2778-2020, 5.4.1</Ref> is explicit that "the use of software is required for analysis of a
            utility-scale SPP." The IEEE Std 80 closed-form equations implemented here represent the grounding system as
            a solid disk of uniform potential, and at the grid spacings an SPP actually uses, "the resistance of the
            conductor from one portion of the plant to another can greatly exceed the resistance to remote earth."
          </p>
          <p>
            The app addresses that in three ways: it reports the longitudinal I·R drop separately and adds it to the
            touch voltage, it credits auxiliary array grounding through the equivalent-rod method of 5.4.2, and it
            flags every input that falls outside the range the closed forms were derived for. It does not replace a
            finite-element model of the plant, and the guide's requirement for one stands.
          </p>
        </Callout>
      </Card>
    </>
  );
}

function CheckRow({ check }: { check: Check }) {
  return (
    <tr className={`check-${check.verdict}`}>
      <td>{check.label}</td>
      <td className="num">{fmt(check.value, 0)} V</td>
      <td className="num">{fmt(check.limit, 0)} V</td>
      <td className="num">{fmt(check.margin, 2)}×</td>
      <td><Badge verdict={check.verdict} /></td>
      <td className="ref-cell">{check.reference}</td>
    </tr>
  );
}

function RegionResultCard({ r, governing }: { r: RegionResult; governing: boolean }) {
  return (
    <Card
      title={r.regionName}
      subtitle={governing ? <b className="governing">Governing region</b> : undefined}
      actions={<Badge verdict={r.touchWithDropCheck.verdict} />}
    >
      <div className="stat-row">
        <Stat label="Equivalent soil ρ" value={fmt(r.rhoEquivalent, 1)} unit="Ω·m" />
        <Stat label="Ground resistance Rg" value={fmt(r.groundResistance, 3)} unit="Ω" note={`Grid alone ${fmt(r.gridOnlyResistance, 3)} Ω`} />
        <Stat label="Grid current IG" value={fmt(r.current.maxGridCurrent, 0)} unit="A" note={`Df = ${fmt(r.current.decrementFactor, 3)}`} />
        <Stat label="Ground potential rise" value={fmt(r.gpr, 0)} unit="V" />
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Check</th>
              <th>Computed</th>
              <th>Tolerable</th>
              <th>Margin</th>
              <th>Result</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            <CheckRow check={r.touchCheck} />
            <CheckRow check={r.stepCheck} />
            <CheckRow check={r.touchWithDropCheck} />
          </tbody>
        </table>
      </div>

      <table className="data-table compact">
        <tbody>
          <tr>
            <th>Surface derating Cs</th><td className="num">{fmt(r.tolerance.cs, 4)}</td>
            <th>Body current IB</th><td className="num">{fmt(r.tolerance.bodyCurrent * 1000, 1)} mA</td>
          </tr>
          <tr>
            <th>Foot resistance Rf</th><td className="num">{fmt(r.tolerance.footResistance, 0)} Ω</td>
            <th>Conductor run resistance</th><td className="num">{fmt(r.auxDropResistance, 4)} Ω</td>
          </tr>
          <tr>
            <th>Local electrode resistance</th><td className="num">{fmt(r.localElectrodeResistance, 3)} Ω</td>
            <th>Current taking the run</th><td className="num">{fmt(r.auxRunCurrent, 0)} A ({fmt(r.auxRunFraction * 100, 0)}%)</td>
          </tr>
          <tr>
            <th>Touch limit, credited</th><td className="num">{fmt(r.tolerance.touchLimit, 0)} V</td>
            <th>Touch limit, un-credited</th><td className="num">{fmt(r.tolerance.touchLimitBare, 0)} V</td>
          </tr>
          <tr>
            <th>Step limit, credited</th><td className="num">{fmt(r.tolerance.stepLimit, 0)} V</td>
            <th>Step limit, un-credited</th><td className="num">{fmt(r.tolerance.stepLimitBare, 0)} V</td>
          </tr>
        </tbody>
      </table>

      {r.auxDrop > 1 && (
        <p className="note">
          Of the {fmt(r.current.maxGridCurrent, 0)} A grid current, {fmt(r.auxRunFraction * 100, 0)}% (
          {fmt(r.auxRunCurrent, 0)} A) returns through the run rather than discharging into the local electrode of{' '}
          {fmt(r.localElectrodeResistance, 3)} Ω. Across the run's {fmt(r.auxDropResistance, 4)} Ω that adds{' '}
          <b>{fmt(r.auxDrop, 0)} V</b> to the mesh voltage of {fmt(r.meshVoltage, 0)} V, giving{' '}
          {fmt(r.touchWithDrop, 0)} V at the point of contact. This is the effect{' '}
          <Ref>IEEE Std 2778-2020, 5.4.1</Ref> identifies as the reason solid-disk hand calculations understate touch
          voltage on a plant of this size.
        </p>
      )}

      {r.warnings.map((w, i) => (
        <Callout kind="warn" key={i}>
          {w}
        </Callout>
      ))}
    </Card>
  );
}
