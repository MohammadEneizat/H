// Temperature field in the ground around buried circuits, by superposition of line
// sources and their images above the surface (Kennelly; the basis of IEC 60287-2-1 2.2.3).
// It is the same model the rating uses, so it shows where the heat goes. It does not
// model a dried-out zone.

export interface FieldSource {
  /** Centre (mm); y is depth below ground, positive down */
  x: number;
  y: number;
  /** Heat dissipated (W/m) */
  W: number;
  /** Radius of the cable or duct (mm); the field is not evaluated inside it */
  r: number;
}

export interface FieldModel {
  thetaA: number;
  rhoSoil: number;
  /** Concrete duct bank: rectangle centre and size (mm), concrete resistivity, correction per W/m */
  bank?: { x: number; y: number; w: number; h: number; rhoC: number; unit: number };
  sources: FieldSource[];
}

/** Temperature (°C) at (x, y) in mm; NaN above ground or inside a cable or duct. */
export function fieldTemperature(f: FieldModel, x: number, y: number): number {
  if (y < 0) return NaN;
  const b = f.bank;
  const inBank = !!b && Math.abs(x - b.x) <= b.w / 2 && Math.abs(y - b.y) <= b.h / 2;
  const rho = inBank ? b!.rhoC : f.rhoSoil;
  let sum = 0;
  let total = 0;
  for (const s of f.sources) {
    const dx = x - s.x;
    const d = Math.hypot(dx, y - s.y);
    if (d < s.r) return NaN;
    sum += s.W * Math.log(Math.hypot(dx, y + s.y) / d);
    total += s.W;
  }
  return f.thetaA + (rho / (2 * Math.PI)) * sum + (inBank ? b!.unit * total : 0);
}
