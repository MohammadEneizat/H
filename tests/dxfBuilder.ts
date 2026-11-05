// Writes small ASCII DXF drawings for the tests and the sample file.
const g = (code: number, v: string | number) => `${code}\n${v}\n`;

export const line = (x1: number, y1: number, x2: number, y2: number, layer = 'TRENCH') =>
  g(0, 'LINE') + g(8, layer) + g(10, x1) + g(20, y1) + g(11, x2) + g(21, y2);
export const circle = (x: number, y: number, r: number, layer = 'CABLES') => g(0, 'CIRCLE') + g(8, layer) + g(10, x) + g(20, y) + g(40, r);
export const text = (x: number, y: number, t: string, h = 30, layer = 'TEXT') => g(0, 'TEXT') + g(8, layer) + g(10, x) + g(20, y) + g(40, h) + g(1, t);
export const lwpoly = (pts: [number, number, number?][], closed: boolean, layer = 'TRENCH') =>
  g(0, 'LWPOLYLINE') + g(8, layer) + g(90, pts.length) + g(70, closed ? 1 : 0) + pts.map(([x, y, b]) => g(10, x) + g(20, y) + (b ? g(42, b) : '')).join('');
export const insert = (name: string, x: number, y: number, rot = 0, layer = 'CABLES') => g(0, 'INSERT') + g(8, layer) + g(2, name) + g(10, x) + g(20, y) + g(50, rot);

export function dxf(entities: string, blocks: Record<string, string> = {}, insunits = 4): string {
  const header = g(0, 'SECTION') + g(2, 'HEADER') + g(9, '$ACADVER') + g(1, 'AC1015') + g(9, '$INSUNITS') + g(70, insunits) + g(0, 'ENDSEC');
  const blk =
    g(0, 'SECTION') +
    g(2, 'BLOCKS') +
    Object.entries(blocks)
      .map(([name, body]) => g(0, 'BLOCK') + g(8, '0') + g(2, name) + g(70, 0) + g(10, 0) + g(20, 0) + body + g(0, 'ENDBLK'))
      .join('') +
    g(0, 'ENDSEC');
  return header + blk + g(0, 'SECTION') + g(2, 'ENTITIES') + entities + g(0, 'ENDSEC') + g(0, 'EOF');
}

/** A PV DC trench: 0.8 m wide, 1.0 m deep, sand bedding 0.4 m, four DC pairs of 1×240 mm², a spare DN160 conduit. */
export function pvTrench(): string {
  const od = 27.8 / 2;
  const cd = 20.4 / 2;
  const cable = (x: number, y: number) => circle(x, y, od) + circle(x, y, cd);
  const pair = (x: number, y: number) => cable(x - od, y) + cable(x + od, y);
  const e =
    // ground, frame and trench (separate lines: the regions are found from where they meet)
    line(-1500, 0, 1500, 0, 'GROUND') +
    lwpoly(
      [
        [-1500, 0],
        [-1500, -2000],
        [1500, -2000],
        [1500, 0],
      ],
      false,
      'FRAME',
    ) +
    line(-400, 0, -400, -1000) +
    line(-400, -1000, 400, -1000) +
    line(400, -1000, 400, 0) +
    line(-400, -600, 400, -600) +
    text(-300, -930, 'SAND BEDDING') +
    text(-300, -250, 'BACKFILL, EXCAVATED SOIL 1.2 K.m/W') +
    text(-1400, -1500, 'NATIVE SOIL') +
    pair(-225, -800) +
    pair(-75, -800) +
    pair(75, -800) +
    insert('PV_PAIR', 225, -800) +
    circle(250, -300, 80, 'DUCTS') +
    circle(250, -300, 70.5, 'DUCTS') +
    // a dimension-like annotation line (dangling, ignored for regions)
    line(450, 0, 450, -800, 'DIM') +
    text(470, -400, '0.80 m', 25, 'DIM');
  return dxf(e, { PV_PAIR: pair(0, 0) });
}
