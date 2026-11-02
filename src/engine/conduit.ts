// Where cables lie inside a shared conduit, for drawing. The thermal model does not depend on it:
// IEC 60287-2-1 treats the cables in one duct as a group of equivalent diameter.
import type { Point } from './thermal';

export interface ConduitMember {
  /** Cable diameter (mm) */
  De: number;
  /** 3: one three-core cable; 1: three single-core cables in a touching trefoil */
  cores: 1 | 3;
}

/** Radius of the circle around a member: one cable, or a touching trefoil of three. */
export function memberRadius(m: ConduitMember): number {
  return m.cores === 3 ? m.De / 2 : (m.De / 2) * (1 + 2 / Math.sqrt(3));
}

/**
 * Cable centres (mm) for each member of a conduit centred at (cx, cy) with inner diameter Di:
 * the members rest side by side along the bottom of the conduit, centred on its lowest point.
 */
export function arrangeInConduit(cx: number, cy: number, Di: number, members: ConduitMember[]): Point[][] {
  const R = Di / 2;
  const radii = members.map(memberRadius);
  const rho = radii.map((r) => Math.max(0, R - r));
  // Angle of each member's centre, measured from straight down, members touching in a row
  const ang: number[] = [0];
  for (let i = 1; i < members.length; i++) {
    const a = rho[i - 1];
    const b = rho[i];
    const d = radii[i - 1] + radii[i];
    let delta: number;
    if (a <= 0 || b <= 0) delta = Math.PI / 4;
    else {
      const c = (a * a + b * b - d * d) / (2 * a * b);
      delta = c <= -1 ? Math.PI : Math.acos(Math.min(1, c));
    }
    ang.push(ang[i - 1] + delta);
  }
  const mid = (ang[0] + ang[ang.length - 1]) / 2;
  return members.map((m, i) => {
    const a = ang[i] - mid;
    const gx = cx + rho[i] * Math.sin(a);
    const gy = cy + rho[i] * Math.cos(a);
    if (m.cores === 3) return [{ x: gx, y: gy }];
    // Touching trefoil, point up, resting on its two lower cables
    const k = m.De / Math.sqrt(3);
    return [
      { x: gx - m.De / 2, y: gy + k / 2 },
      { x: gx, y: gy - k },
      { x: gx + m.De / 2, y: gy + k / 2 },
    ];
  });
}
