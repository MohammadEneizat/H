import { useStudy } from '../state/store';
import { fmt } from './ui';
import { gridGeometry } from '../engine';

/**
 * Plan view of the grid layout, in the spirit of Figures 2 and 3 of IEEE Std 2778-2020: the widely
 * spaced main grid in black, the PV array auxiliary grounding shaded, and the site fence in red.
 */
export function GridPlan() {
  const { study } = useStudy();
  const g = study.grid;
  const geom = gridGeometry(g);

  const pad = 28;
  const w = 640;
  const aspect = g.lengthY / Math.max(g.lengthX, 1e-6);
  const drawW = w - pad * 2;
  const drawH = Math.min(Math.max(drawW * aspect, 120), 420);
  const h = drawH + pad * 2;

  const sx = (x: number) => pad + (x / g.lengthX) * drawW;
  const sy = (y: number) => pad + (y / g.lengthY) * drawH;

  const xs: number[] = [];
  for (let i = 0; i < geom.linesY; i++) xs.push((i / (geom.linesY - 1)) * g.lengthX);
  const ys: number[] = [];
  for (let i = 0; i < geom.linesX; i++) ys.push((i / (geom.linesX - 1)) * g.lengthY);

  const fenceOffset = study.fence.enabled ? Math.min(study.fence.separation, g.lengthX / 6) : 0;
  const fx = (fenceOffset / g.lengthX) * drawW;
  const fy = (fenceOffset / g.lengthY) * drawH;

  return (
    <figure className="plan">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Grounding grid plan view">
        {/* Array blocks: shaded panels between grid lines, echoing Figure 3. */}
        {study.auxiliary.enabled &&
          xs.slice(0, -1).map((x, i) =>
            ys.slice(0, -1).map((y, j) => (
              <rect
                key={`${i}-${j}`}
                x={sx(x) + 4}
                y={sy(y) + 4}
                width={Math.max(sx(xs[i + 1]) - sx(x) - 8, 0)}
                height={Math.max(sy(ys[j + 1]) - sy(y) - 8, 0)}
                className="plan-block"
              />
            )),
          )}

        {/* Site fence. */}
        {study.fence.enabled && (
          <rect
            x={pad - fx}
            y={pad - fy}
            width={drawW + fx * 2}
            height={drawH + fy * 2}
            className="plan-fence"
          />
        )}

        {/* Main grid conductors. */}
        {xs.map((x, i) => (
          <line key={`v${i}`} x1={sx(x)} y1={sy(0)} x2={sx(x)} y2={sy(g.lengthY)} className="plan-grid" />
        ))}
        {ys.map((y, i) => (
          <line key={`h${i}`} x1={sx(0)} y1={sy(y)} x2={sx(g.lengthX)} y2={sy(y)} className="plan-grid" />
        ))}

        {/* Inverter / GSU loops at block corners, as in Figure 2. */}
        {xs.slice(0, -1).map((x, i) =>
          ys.slice(0, -1).map((y, j) => (
            <circle key={`c${i}-${j}`} cx={sx(x)} cy={sy(y)} r={4} className="plan-gsu" />
          )),
        )}

        {/* Dimension annotations. */}
        <text x={pad} y={14} className="plan-label">
          {fmt(g.lengthX, 0)} m
        </text>
        <text x={6} y={pad + drawH / 2} className="plan-label" transform={`rotate(-90 6 ${pad + drawH / 2})`}>
          {fmt(g.lengthY, 0)} m
        </text>
      </svg>
      <figcaption>
        Main grid at {fmt(g.spacing, 0)} m spacing ({geom.linesY} × {geom.linesX} runs, {fmt(geom.conductorLength, 0)} m
        of conductor). Shading marks the PV array blocks whose steel contributes auxiliary grounding; circles mark
        inverter/GSU tie points; the red line is the site fence.
      </figcaption>
    </figure>
  );
}
