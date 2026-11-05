// Where cables lie inside a shared conduit, for drawing. The thermal model does not depend on it:
// IEC 60287-2-1 treats the cables in one duct as a group of equivalent diameter.
import type { Point } from './thermal';

export interface ConduitMember {
  /** Cable diameter (mm) */
  De: number;
  /** 3: one three-core cable; 1: single-core cables */
  cores: 1 | 3;
  /** Single-core cables of the circuit: 3 (three-phase trefoil) or 2 (DC pair); default 3 */
  cables?: number;
}

/** A disk resting in the conduit: one cable, or a touching trefoil of three single-core cables. */
interface Disk {
  r: number;
  member: number;
  trefoil: boolean;
  De: number;
}

/** Radius of the circle around a member: one cable, or a touching trefoil of three. */
export function memberRadius(m: ConduitMember): number {
  return m.cores === 3 || m.cables === 2 ? m.De / 2 : (m.De / 2) * (1 + 2 / Math.sqrt(3));
}

/**
 * Cable centres (mm) for each member of a conduit centred at (cx, cy) with inner diameter Di:
 * the members rest side by side along the bottom of the conduit, centred on its lowest point.
 */
export function arrangeInConduit(cx: number, cy: number, Di: number, members: ConduitMember[]): Point[][] {
  const R = Di / 2;
  // Each member is one disk (three-core cable, or a trefoil of three), or two disks (DC pair)
  const disks: Disk[] = [];
  members.forEach((m, i) => {
    if (m.cores !== 3 && m.cables === 2) {
      disks.push({ r: m.De / 2, member: i, trefoil: false, De: m.De });
      disks.push({ r: m.De / 2, member: i, trefoil: false, De: m.De });
    } else disks.push({ r: memberRadius(m), member: i, trefoil: m.cores !== 3, De: m.De });
  });
  const rho = disks.map((d) => Math.max(0, R - d.r));
  // Angle of each disk centre from straight down, disks touching in a row along the bottom
  const ang: number[] = [0];
  for (let i = 1; i < disks.length; i++) {
    const a = rho[i - 1];
    const b = rho[i];
    const d = disks[i - 1].r + disks[i].r;
    let delta: number;
    if (a <= 0 || b <= 0) delta = Math.PI / 4;
    else {
      const c = (a * a + b * b - d * d) / (2 * a * b);
      delta = c <= -1 ? Math.PI : Math.acos(Math.min(1, c));
    }
    ang.push(ang[i - 1] + delta);
  }
  const mid = (ang[0] + ang[ang.length - 1]) / 2;
  const out: Point[][] = members.map(() => []);
  disks.forEach((dk, i) => {
    const a = ang[i] - mid;
    const gx = cx + rho[i] * Math.sin(a);
    const gy = cy + rho[i] * Math.cos(a);
    if (!dk.trefoil) {
      out[dk.member].push({ x: gx, y: gy });
      return;
    }
    // Touching trefoil, point up, resting on its two lower cables
    const k = dk.De / Math.sqrt(3);
    out[dk.member].push({ x: gx - dk.De / 2, y: gy + k / 2 }, { x: gx, y: gy - k }, { x: gx + dk.De / 2, y: gy + k / 2 });
  });
  return out;
}
