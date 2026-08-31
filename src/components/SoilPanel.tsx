import { useMemo, useState } from 'react';
import { useStudy } from '../state/store';
import { Badge, Callout, Card, fmt, Grid, NumberField, Ref, SelectField, TextField } from './ui';
import {
  combineTraverseModels,
  fitTwoLayer,
  nextId,
  twoLayerApparentResistivity,
  wennerApparentResistivity,
  type Traverse,
  type TraverseKind,
} from '../engine';

export function SoilPanel() {
  const { study, patch } = useStudy();
  const traverses = study.traverses;

  const addTraverse = (kind: TraverseKind) => {
    const t: Traverse = {
      id: nextId('trav'),
      name: kind === 'short' ? `Short traverse ${traverses.filter((x) => x.kind === 'short').length + 1}` : `Long traverse ${traverses.filter((x) => x.kind === 'long').length + 1}`,
      kind,
      points:
        kind === 'short'
          ? [0.5, 1, 1.5, 2, 3, 5, 8, 12, 20, 30].map((s) => ({ spacing: s, resistance: 0 }))
          : [10, 20, 40, 60, 90, 120, 180, 240, 300].map((s) => ({ spacing: s, resistance: 0 })),
    };
    patch({ traverses: [...traverses, t] });
  };

  const update = (id: string, next: Partial<Traverse>) =>
    patch({ traverses: traverses.map((t) => (t.id === id ? { ...t, ...next } : t)) });

  const remove = (id: string) => patch({ traverses: traverses.filter((t) => t.id !== id) });

  return (
    <>
      <Card title="Soil resistivity testing" subtitle={<><Ref>IEEE Std 2778-2020, 5.1</Ref></>}>
        <Callout kind="ref">
          Because of the size of an SPP the soil "generally cannot be considered consistent across larger sites."
          The guide asks for a combination of many short traverses — small spacings up to at least 30 m, on a grid with
          centres about 500 m apart — and a few very long traverses, reaching around 300 m of spacing, to characterise
          the deep layer that dominates overall grounding impedance. Enter each traverse below; the app inverts a
          two-layer earth model from the measurements.
        </Callout>
        <div className="row-actions">
          <button className="btn" onClick={() => addTraverse('short')}>
            + Short traverse
          </button>
          <button className="btn" onClick={() => addTraverse('long')}>
            + Long traverse
          </button>
        </div>
        {traverses.length === 0 && (
          <p className="empty">
            No traverses entered. You can also skip this and type layer resistivities directly on each region.
          </p>
        )}
      </Card>

      {traverses.map((t) => (
        <TraverseCard key={t.id} traverse={t} onChange={(n) => update(t.id, n)} onRemove={() => remove(t.id)} />
      ))}

      {traverses.length > 0 && <CombineCard />}
    </>
  );
}

function TraverseCard({
  traverse,
  onChange,
  onRemove,
}: {
  traverse: Traverse;
  onChange: (next: Partial<Traverse>) => void;
  onRemove: () => void;
}) {
  const fit = useMemo(() => fitTwoLayer(traverse.points), [traverse.points]);
  const hasData = traverse.points.some((p) => p.resistance > 0);

  const setPoint = (i: number, key: 'spacing' | 'resistance', v: number) => {
    const points = traverse.points.map((p, idx) => (idx === i ? { ...p, [key]: v } : p));
    onChange({ points });
  };

  return (
    <Card
      title={traverse.name}
      subtitle={`${traverse.kind === 'short' ? 'Short' : 'Long'} Wenner traverse — ${traverse.points.length} readings`}
      actions={
        <button className="btn btn-ghost btn-danger" onClick={onRemove}>
          Remove
        </button>
      }
    >
      <Grid cols={2}>
        <TextField label="Traverse name" value={traverse.name} onChange={(v) => onChange({ name: v })} />
        <SelectField<TraverseKind>
          label="Type"
          value={traverse.kind}
          onChange={(v) => onChange({ kind: v })}
          options={[
            { value: 'short', label: 'Short — resolves upper layers' },
            { value: 'long', label: 'Long — characterises the deep layer' },
          ]}
        />
      </Grid>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Spacing a (m)</th>
              <th>Measured R (Ω)</th>
              <th>Apparent ρa (Ω·m)</th>
              <th>Fitted ρa (Ω·m)</th>
              <th>Deviation</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {traverse.points.map((p, i) => {
              const rhoA = p.resistance > 0 ? wennerApparentResistivity(p.spacing, p.resistance) : 0;
              const model = fit ? twoLayerApparentResistivity(p.spacing, fit.rho1, fit.rho2, fit.h) : 0;
              const dev = rhoA > 0 && model > 0 ? ((model - rhoA) / rhoA) * 100 : null;
              return (
                <tr key={i}>
                  <td>
                    <input
                      type="number"
                      value={p.spacing}
                      step="any"
                      onChange={(e) => setPoint(i, 'spacing', parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={p.resistance}
                      step="any"
                      onChange={(e) => setPoint(i, 'resistance', parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  <td className="num">{rhoA > 0 ? fmt(rhoA, 1) : '—'}</td>
                  <td className="num">{model > 0 ? fmt(model, 1) : '—'}</td>
                  <td className={`num${dev !== null && Math.abs(dev) > 10 ? ' cell-warn' : ''}`}>
                    {dev !== null ? `${dev > 0 ? '+' : ''}${fmt(dev, 1)}%` : '—'}
                  </td>
                  <td>
                    <button
                      className="btn btn-icon"
                      title="Remove reading"
                      onClick={() => onChange({ points: traverse.points.filter((_, idx) => idx !== i) })}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="row-actions">
        <button
          className="btn"
          onClick={() =>
            onChange({
              points: [...traverse.points, { spacing: (traverse.points.at(-1)?.spacing ?? 1) * 1.5, resistance: 0 }],
            })
          }
        >
          + Reading
        </button>
      </div>

      {hasData && fit && (
        <div className="fit-result">
          <div>
            <strong>Two-layer inversion</strong>
            <span className={fit.rmsError < 0.05 ? 'fit-good' : 'fit-poor'}>
              RMS error {fmt(fit.rmsError * 100, 1)}%
            </span>
          </div>
          <div className="fit-values">
            <span>
              ρ₁ = <b>{fmt(fit.rho1, 1)}</b> Ω·m
            </span>
            <span>
              h = <b>{fmt(fit.h, 2)}</b> m
            </span>
            <span>
              ρ₂ = <b>{fmt(fit.rho2, 1)}</b> Ω·m
            </span>
          </div>
          {fit.rmsError > 0.1 && (
            <Callout kind="warn">
              A two-layer model does not fit these readings well. The site may need three layers, or the traverse may
              cross a lateral discontinuity. <Ref>IEEE Std 2778-2020, 5.1.1</Ref> also advises extending a traverse
              when apparent resistivity has not levelled out at the largest spacing.
            </Callout>
          )}
        </div>
      )}
      {hasData && !fit && <p className="empty">Enter at least three readings with a non-zero resistance to invert a model.</p>}
    </Card>
  );
}

/** Builds a combined local model from a chosen short and long traverse — 5.1.2 / Table 1. */
function CombineCard() {
  const { study, patch } = useStudy();
  const shorts = study.traverses.filter((t) => t.kind === 'short');
  const longs = study.traverses.filter((t) => t.kind === 'long');

  const [shortId, setShortId] = useState(shorts[0]?.id ?? '');
  const [longId, setLongId] = useState(longs[0]?.id ?? '');
  const [regionId, setRegionId] = useState(study.regions[0]?.id ?? '');

  const shortFit = useMemo(() => {
    const t = shorts.find((x) => x.id === shortId) ?? shorts[0];
    return t ? fitTwoLayer(t.points) : null;
  }, [shorts, shortId]);

  const longFit = useMemo(() => {
    const t = longs.find((x) => x.id === longId) ?? longs[0];
    return t ? fitTwoLayer(t.points) : null;
  }, [longs, longId]);

  const combined = shortFit && longFit ? combineTraverseModels(shortFit, longFit) : null;

  const apply = () => {
    if (!combined) return;
    patch({
      regions: study.regions.map((r) => (r.id === regionId ? { ...r, soil: combined } : r)),
    });
  };

  return (
    <Card
      title="Combine traverses into a local soil model"
      subtitle={<><Ref>IEEE Std 2778-2020, 5.1.2 and Table 1</Ref></>}
    >
      <Callout kind="ref">
        The upper layers are taken from the short traverse, which resolves them; the bottom layer comes from the nearby
        long traverse, which is the only measurement that reaches it. The bottom layer is placed at the same total depth
        the long traverse indicates — the approach the guide gives for the hardest choice in the method.
      </Callout>

      <Grid cols={3}>
        <SelectField
          label="Short traverse (local)"
          value={shortId || shorts[0]?.id || ''}
          onChange={setShortId}
          options={shorts.map((t) => ({ value: t.id, label: t.name }))}
        />
        <SelectField
          label="Long traverse (nearby)"
          value={longId || longs[0]?.id || ''}
          onChange={setLongId}
          options={longs.map((t) => ({ value: t.id, label: t.name }))}
        />
        <SelectField
          label="Apply to region"
          value={regionId || study.regions[0]?.id || ''}
          onChange={setRegionId}
          options={study.regions.map((r) => ({ value: r.id, label: r.name }))}
        />
      </Grid>

      {!shortFit || !longFit ? (
        <p className="empty">Both a short and a long traverse with valid readings are needed to combine.</p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Layer</th>
                  <th>Short traverse (local)</th>
                  <th>Long traverse (nearby)</th>
                  <th>Combined local model</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Top</td>
                  <td>{fmt(shortFit.rho1, 0)} Ω·m for {fmt(shortFit.h, 1)} m</td>
                  <td>{fmt(longFit.rho1, 0)} Ω·m for {fmt(longFit.h, 1)} m</td>
                  <td className="cell-strong">
                    {fmt(combined![0].rho, 0)} Ω·m for {fmt(combined![0].thickness, 1)} m
                  </td>
                </tr>
                <tr>
                  <td>Second (middle)</td>
                  <td>{fmt(shortFit.rho2, 0)} Ω·m (bottom measured with shorter traverse)</td>
                  <td>—</td>
                  <td className="cell-strong">
                    {fmt(combined![1].rho, 0)} Ω·m for {fmt(combined![1].thickness, 1)} m (cumulative depth{' '}
                    {fmt(combined![0].thickness + combined![1].thickness, 1)} m)
                  </td>
                </tr>
                <tr>
                  <td>Third (bottom)</td>
                  <td>—</td>
                  <td>{fmt(longFit.rho2, 0)} Ω·m</td>
                  <td className="cell-strong">{fmt(combined![2].rho, 0)} Ω·m</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="row-actions">
            <button className="btn btn-primary" onClick={apply}>
              Apply combined model to region
            </button>
            <Badge verdict={shortFit.rmsError < 0.1 && longFit.rmsError < 0.1 ? 'pass' : 'marginal'} />
          </div>
        </>
      )}
    </Card>
  );
}

/** Editor for a region's soil layers, reused by the regions panel. */
export function SoilLayerEditor({
  layers,
  onChange,
}: {
  layers: { rho: number; thickness: number }[];
  onChange: (layers: { rho: number; thickness: number }[]) => void;
}) {
  return (
    <div className="layer-editor">
      {layers.map((l, i) => {
        const isBottom = i === layers.length - 1;
        return (
          <div className="layer-row" key={i}>
            <span className="layer-tag">{isBottom ? 'Bottom' : i === 0 ? 'Top' : `Layer ${i + 1}`}</span>
            <NumberField
              label="Resistivity"
              value={l.rho}
              unit="Ω·m"
              min={0.1}
              onChange={(v) => onChange(layers.map((x, idx) => (idx === i ? { ...x, rho: v } : x)))}
            />
            <NumberField
              label={isBottom ? 'Thickness (semi-infinite)' : 'Thickness'}
              value={l.thickness}
              unit="m"
              min={0}
              disabled={isBottom}
              onChange={(v) => onChange(layers.map((x, idx) => (idx === i ? { ...x, thickness: v } : x)))}
            />
            <button
              className="btn btn-icon"
              title="Remove layer"
              disabled={layers.length <= 1}
              onClick={() => onChange(layers.filter((_, idx) => idx !== i))}
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        className="btn"
        onClick={() => onChange([...layers.slice(0, -1), { rho: 100, thickness: 5 }, layers[layers.length - 1]])}
      >
        + Layer
      </button>
    </div>
  );
}
