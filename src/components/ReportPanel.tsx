import { useStudy } from '../state/store';
import { areaLabel, Card, fmt } from './ui';

/**
 * Print-ready calculation record. Every clause citation the calculation depends on is stated, so the
 * document stands on its own for a reviewer. IEEE Std 2778-2020, 5.5 notes that where post-
 * construction impedance testing is impractical — which it usually is on a large plant, needing test
 * leads five times the site's maximum dimension — "documenting the details of the soil testing,
 * analysis, and results might provide reassurance of an adequate design."
 */
export function ReportPanel() {
  const { study, result } = useStudy();
  const m = study.meta;
  const governing = result.regions.find((r) => r.regionId === result.governingRegionId);

  return (
    <>
      <Card
        title="Calculation record"
        subtitle="Print or save to PDF for the design file."
        actions={
          <div className="card-actions">
            <button className="btn" onClick={() => exportJson(study)}>
              Export study (JSON)
            </button>
            <button className="btn btn-primary" onClick={() => window.print()}>
              Print / save as PDF
            </button>
          </div>
        }
      >
        <p className="note">
          IEEE Std 2778-2020, 5.5 observes that ground impedance testing "is simply not practical in most instances" on
          a large PV plant, because the test lead must run about five times the plant's maximum dimension. Where testing
          cannot be performed, documenting the soil investigation, the analysis and its results is what demonstrates an
          adequate design.
        </p>
      </Card>

      <div className="report" id="report">
        <header className="report-head">
          <div>
            <h1>{m.name || 'SPP grounding study'}</h1>
            <p className="report-standard">
              Grounding design for personnel protection — IEEE Std 2778-2020, with tolerable voltages and grid
              performance per IEEE Std 80-2013
            </p>
          </div>
          <dl className="report-meta">
            {m.client && (<><dt>Client</dt><dd>{m.client}</dd></>)}
            {m.location && (<><dt>Location</dt><dd>{m.location}</dd></>)}
            {m.engineer && (<><dt>Engineer</dt><dd>{m.engineer}</dd></>)}
            <dt>Date</dt><dd>{m.date}</dd>
            <dt>Capacity</dt><dd>{fmt(m.plantCapacityMW, 0)} MW</dd>
          </dl>
        </header>

        <section>
          <h2>1. Basis of analysis</h2>
          <p>
            The plant is a utility-scale ground-mount photovoltaic facility, within the scope of IEEE Std 2778-2020
            (5 MW or greater). Tolerable touch and step voltages follow IEEE Std 80-2013 Equations (29) through (33) for
            a {study.bodyWeight} kg body. Grid performance follows IEEE Std 80-2013 Equations (52), (80) and (92).
            {study.footwearResistance > 0 && (
              <>
                {' '}Footwear resistance of {fmt(study.footwearResistance, 0)} Ω per foot is credited inside the plant
                under IEEE Std 2778-2020, 5.4.4; it is withheld at the fence line and in any region marked as outside
                the plant.
              </>
            )}
          </p>
          <table className="report-table">
            <tbody>
              <tr><th>Grid extent</th><td>{fmt(study.grid.lengthX, 0)} m × {fmt(study.grid.lengthY, 0)} m</td>
                  <th>Enclosed area</th><td>{areaLabel(result.geometry.area, study.units)}</td></tr>
              <tr><th>Conductor spacing D</th><td>{fmt(study.grid.spacing, 0)} m</td>
                  <th>Burial depth h</th><td>{fmt(study.grid.depth, 2)} m</td></tr>
              <tr><th>Buried conductor Lc</th><td>{fmt(result.geometry.conductorLength, 0)} m</td>
                  <th>Ground rods</th><td>{study.grid.rodCount > 0 ? `${study.grid.rodCount} × ${fmt(study.grid.rodLength, 1)} m` : 'None'}</td></tr>
              <tr><th>Conductor</th><td>{fmt(study.grid.conductorAreaMm2, 1)} mm², d = {fmt(study.grid.conductorDiameterM * 1000, 1)} mm</td>
                  <th>Auxiliary array steel</th><td>{study.auxiliary.enabled ? `${result.auxiliary?.effectiveCount ?? 0} posts credited` : 'Not credited'}</td></tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2>2. Conductor sizing</h2>
          <p>
            Per IEEE Std 80-2013 Equation (37), a governing current of {fmt(result.sizingGoverningCurrent, 0)} A for{' '}
            {study.sizing.duration} s in {result.sizing.materialName.toLowerCase()} at an ambient of{' '}
            {study.sizing.ambientTemp} °C and a maximum temperature of {result.sizing.maxTemp} °C requires{' '}
            <b>{fmt(result.sizing.areaMm2, 1)} mm²</b> ({fmt(result.sizing.areaKcmil, 1)} kcmil). The selected conductor
            is {fmt(study.grid.conductorAreaMm2, 1)} mm², which is{' '}
            {study.grid.conductorAreaMm2 >= result.sizing.areaMm2 ? 'adequate' : 'inadequate'}.
          </p>
        </section>

        <section>
          <h2>3. Regional results</h2>
          <table className="report-table">
            <thead>
              <tr>
                <th>Region</th>
                <th>ρ eq (Ω·m)</th>
                <th>IG (A)</th>
                <th>Rg (Ω)</th>
                <th>GPR (V)</th>
                <th>Touch incl. drop (V)</th>
                <th>Touch limit (V)</th>
                <th>Es (V)</th>
                <th>Step limit (V)</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {result.regions.map((r) => (
                <tr key={r.regionId} className={r.regionId === result.governingRegionId ? 'row-active' : undefined}>
                  <td>{r.regionName}</td>
                  <td className="num">{fmt(r.rhoEquivalent, 0)}</td>
                  <td className="num">{fmt(r.current.maxGridCurrent, 0)}</td>
                  <td className="num">{fmt(r.groundResistance, 3)}</td>
                  <td className="num">{fmt(r.gpr, 0)}</td>
                  <td className="num">{fmt(r.touchWithDrop, 0)}</td>
                  <td className="num">{fmt(r.tolerance.touchLimit, 0)}</td>
                  <td className="num">{fmt(r.stepVoltage, 0)}</td>
                  <td className="num">{fmt(r.tolerance.stepLimit, 0)}</td>
                  <td>{r.touchWithDropCheck.verdict === 'pass' ? 'Compliant' : r.touchWithDropCheck.verdict === 'marginal' ? 'Marginal' : 'Exceeds'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Touch voltage is reported including the longitudinal I·R drop along the run back to the main grid tie, per
            IEEE Std 2778-2020, 4.3 and 5.4.1.
            {governing && (
              <> The design is governed by <b>{governing.regionName}</b>, at a touch margin of{' '}
                {fmt(governing.touchWithDropCheck.margin, 2)}×.</>
            )}
          </p>
        </section>

        {result.fence && (
          <section>
            <h2>4. Perimeter fence</h2>
            <p>
              {result.fence.note} The assumed fence touch voltage of {fmt(result.fence.touchVoltage, 0)} V is compared
              against a tolerable {fmt(result.fence.limit, 0)} V, computed for a 50 kg body with no footwear credit
              because a person at the fence line may not be qualified plant personnel. Margin{' '}
              {fmt(result.fence.margin, 2)}×.
            </p>
          </section>
        )}

        <section>
          <h2>{result.fence ? '5' : '4'}. Limitations</h2>
          <p>
            IEEE Std 2778-2020, 5.4.1 requires software analysis for a utility-scale plant. The closed-form equations of
            IEEE Std 80 used here assume a grounding system that behaves as a solid disk with no significant internal
            impedance, an assumption that weakens at the grid spacings an SPP uses. These results are a screening and
            optimisation calculation; a finite-element model is required to confirm the final design, and the split
            factor, if credited, must come from that model rather than the Annex C curves of IEEE Std 80.
          </p>
          {(result.warnings.length > 0 || result.regions.some((r) => r.warnings.length > 0)) && (
            <>
              <h3>Qualifications raised by this analysis</h3>
              <ul>
                {result.warnings.map((w, i) => <li key={`g${i}`}>{w}</li>)}
                {result.regions.flatMap((r) =>
                  r.warnings.map((w, i) => <li key={`${r.regionId}-${i}`}>{r.regionName}: {w}</li>),
                )}
              </ul>
            </>
          )}
        </section>

        {m.notes && (
          <section>
            <h2>Notes</h2>
            <p className="preserve">{m.notes}</p>
          </section>
        )}

        <footer className="report-foot">
          <p>
            Prepared with the SPP Grounding Calculator. This document records a calculation; it does not constitute a
            professional engineering certification. Review by a qualified engineer is required before construction.
          </p>
        </footer>
      </div>
    </>
  );
}

function exportJson(study: unknown) {
  const blob = new Blob([JSON.stringify(study, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'spp-grounding-study.json';
  a.click();
  URL.revokeObjectURL(url);
}
