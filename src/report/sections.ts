// Tables shared by the results page and the PDF report.
import {
  AIR_CONSTANTS,
  DUCTS,
  INSULATIONS,
  JACKETS,
  METALS,
  defaultSkinProximity,
  type CableSpec,
  type InstallationSpec,
  type RatingResult,
} from '../engine';
import { fmt, sig } from '../ui/format';

export type Row = [quantity: string, symbol: string, value: string, unit: string, ref?: string];
export interface CalcSection {
  title: string;
  rows: Row[];
  note?: string;
}

export const typeLabel = { direct: 'Direct buried', ducts: 'In ducts', ductbank: 'Duct bank', air: 'Free air' } as const;
export const bondLabel = { both: 'Both ends bonded', single: 'Single-point bonded', cross: 'Cross-bonded' } as const;

export function summaryChips(inst: InstallationSpec, r: RatingResult): string[] {
  return [
    typeLabel[inst.type],
    inst.type === 'air'
      ? AIR_CONSTANTS[inst.air.arrangement].label
      : `${inst.formation === 'trefoil' ? 'Trefoil' : 'Flat'}, ${inst.touching ? 'touching' : `${fmt(inst.spacing_mm, 0)} mm`}`,
    bondLabel[inst.bonding],
    ...(r.system ? [`${r.system.circuits.length} circuits`] : []),
    inst.type === 'air'
      ? `${fmt(inst.ambient_C, 0)} °C air`
      : `${fmt(inst.depth_m, 2)} m · ${fmt(inst.soilRho, 2)} K·m/W · ${fmt(inst.ambient_C, 0)} °C`,
  ];
}

/** The calculation sheet: every intermediate value with its clause. */
export function calcSections(inst: InstallationSpec, r: RatingResult): { sections: CalcSection[]; lambda: Row[] } {
  const c = r.conductor;
  const t4 = r.thermal.t4;
  const perKm = (v: number) => sig(v * 1000, 4);

  const conductor: Row[] = [
    ['DC resistance at 20 °C', 'R0', perKm(c.R0), 'Ω/km', '2.1.1'],
    [`DC resistance at ${fmt(r.temperatures.conductor, 1)} °C`, 'R′', perKm(c.Rdc), 'Ω/km', '2.1.1'],
    ['Skin effect coefficient', 'ks', sig(c.ks, 3), '', 'Table 2'],
    ['Skin effect argument', 'xs', sig(c.xs, 4), '', '2.1.2'],
    ['Skin effect factor', 'ys', sig(c.ys, 4), '', '2.1.2'],
    ['Proximity effect coefficient', 'kp', sig(c.kp, 3), '', 'Table 2'],
    ['Proximity effect argument', 'xp', sig(c.xp, 4), '', '2.1.4'],
    ['Proximity effect factor', 'yp', sig(c.yp, 4), '', '2.1.4'],
    [
      c.fromDatasheet ? 'AC resistance (datasheet)' : 'AC resistance R′(1 + ys + yp)',
      'R',
      perKm(c.R),
      'Ω/km',
      c.fromDatasheet ? 'datasheet' : '2.1',
    ],
  ];

  const dielectric: Row[] = [
    ['Capacitance', 'C', sig(r.dielectric.C * 1e9, 4), 'µF/km', '2.2'],
    [
      r.dielectric.included
        ? 'Dielectric loss ωCU0² tan δ'
        : `Dielectric loss (neglected below ${r.dielectric.threshold_kV} kV)`,
      'Wd',
      sig(r.dielectric.Wd, 4),
      'W/m',
      '2.2',
    ],
  ];

  const sheath: Row[] = [
    ['Screen resistance at 20 °C', 'Rs,20', perKm(r.sheath.Rs20), 'Ω/km', '2.3'],
    [`Screen resistance at ${fmt(r.temperatures.sheath, 1)} °C`, 'Rs', perKm(r.sheath.Rs), 'Ω/km', '2.3'],
    ['Screen reactance', inst.formation === 'flat' && inst.transposed ? 'X1' : 'X', perKm(r.sheath.X), 'Ω/km', '2.3.1'],
    ['Eddy current parameter', 'm', sig(r.sheath.m, 4), '', '2.3.6'],
  ];
  if (r.sheath.Ft !== null) sheath.push(['Eddy loss reduction (Milliken)', 'Ft', sig(r.sheath.Ft, 4), '', '2.3.1']);
  sheath.push(['Loss factor used (largest cable)', 'λ1', sig(r.sheath.lambda1, 4), '', '2.3']);

  const thermal: Row[] = [
    ['Insulation (conductor to screen)', 'T1', sig(r.thermal.T1, 4), 'K·m/W', '2-1 2.1.1'],
    ['Bedding (no armour)', 'T2', '0', 'K·m/W', '2-1 2.1.2'],
    ['Oversheath', 'T3', sig(r.thermal.T3, 4), 'K·m/W', '2-1 2.1.3'],
  ];
  if (t4.T4p !== undefined) {
    thermal.push(['Air space in duct', 'T4′', sig(t4.T4p, 4), 'K·m/W', '2-1 2.2.7.1']);
    thermal.push(['Duct wall', 'T4″', sig(t4.T4pp, 4), 'K·m/W', '2-1 2.2.7.2']);
    thermal.push(['Duct to ambient incl. own circuit', 'T4‴', sig(t4.T4ppp, 4), 'K·m/W', '2-1 2.2.7.3']);
    if (t4.bankCorrection !== undefined)
      thermal.push(['of which duct bank correction', '', sig(t4.bankCorrection, 4), 'K·m/W', '2-1 2.2.7.3']);
    thermal.push(['Mean temperature in duct', 'θm', fmt(t4.thetaM, 1), '°C', '2-1 2.2.7.1']);
  }
  if (t4.h !== undefined) {
    thermal.push(['Heat dissipation coefficient', 'h', sig(t4.h, 4), 'W/m²K^5/4', '2-1 2.2.1']);
    thermal.push(['Surface temperature rise', 'Δθs', fmt(t4.dThetaS, 2), 'K', '2-1 2.2.1']);
  }
  thermal.push([
    inst.type === 'air' ? 'External, free air' : 'External thermal resistance',
    inst.type === 'air' ? 'T4*' : 'T4',
    sig(t4.T4, 4),
    'K·m/W',
    inst.type === 'air' ? '2-1 2.2.1' : '2-1 2.2.3',
  ]);
  if (r.system && t4.mutual !== undefined)
    thermal.push(['Rise from other circuits at this cable', 'Δθp', fmt(t4.mutual, 2), 'K', '2-1 2.2.3.1']);

  const losses: Row[] = [
    ['Conductor loss I²R', 'Wc', sig(r.losses.Wc, 4), 'W/m', '1.4'],
    ['Screen loss λ1·Wc', 'Ws', sig(r.losses.Ws, 4), 'W/m', '1.4'],
    ['Dielectric loss', 'Wd', sig(r.losses.Wd, 4), 'W/m', '2.2'],
    ['Total heat per cable', 'W', sig(r.losses.W, 4), 'W/m', ''],
  ];
  const temps: Row[] = [
    ['Conductor', 'θc', fmt(r.temperatures.conductor, 1), '°C', ''],
    ['Metallic screen / sheath', 'θs', fmt(r.temperatures.sheath, 1), '°C', ''],
    ['Cable surface', 'θe', fmt(r.temperatures.surface, 1), '°C', ''],
  ];
  if (r.temperatures.ductInner !== undefined)
    temps.push(['Duct inner surface', 'θd', fmt(r.temperatures.ductInner, 1), '°C', '']);
  temps.push([inst.type === 'air' ? 'Ambient air' : 'Ambient soil', 'θa', fmt(inst.ambient_C, 1), '°C', '']);

  const lambda: Row[] = r.sheath.cables.map((sc) => [sc.label, '', sig(sc.lambda1p, 4), sig(sc.lambda1pp, 4), sig(sc.lambda1, 4)]);

  return {
    sections: [
      { title: 'Conductor', rows: conductor },
      { title: 'Dielectric', rows: dielectric },
      { title: 'Screen / sheath losses', rows: sheath },
      { title: 'Thermal resistances', rows: thermal, note: t4.method },
      { title: 'Losses at the rated current', rows: losses },
      { title: 'Temperatures at the rated current', rows: temps },
    ],
    lambda,
  };
}

const v = (x: number | null | undefined, d: number, unit = '') =>
  typeof x === 'number' && Number.isFinite(x) ? `${fmt(x, d)}${unit ? ` ${unit}` : ''}` : '–';
const opt = (x: number | null | undefined, std: string, d: number, unit = '') =>
  typeof x === 'number' && Number.isFinite(x) ? `${v(x, d, unit)} (entered)` : `${std}${unit ? ` ${unit}` : ''} (standard)`;

/** Inputs as label / value pairs, with standard values marked. */
export function inputSections(cable: CableSpec, inst: InstallationSpec): { title: string; rows: [string, string][] }[] {
  const ins = INSULATIONS[cable.insulation.material];
  const jac = JACKETS[cable.jacket.material];
  const kk = defaultSkinProximity(cable.conductor.material, cable.conductor.construction, ins.system, cable.conductor.millikenWires);
  const s = cable.screen;
  const cableRows: [string, string][] = [
    ['Cable', cable.name],
    ['Rated voltage U0', v(cable.U0_kV, 1, 'kV')],
    ['Maximum conductor temperature', v(cable.maxTemp_C, 0, '°C')],
    [
      'Conductor',
      `${METALS[cable.conductor.material].label}, ${cable.conductor.construction === 'milliken' ? `Milliken (${cable.conductor.millikenWires.replace('-', ' ')} wires)` : cable.conductor.construction === 'solid' ? 'round solid' : 'round stranded'}, ${v(cable.conductor.area_mm2, 0, 'mm²')}`,
    ],
    ['Conductor diameter', v(cable.conductor.diameter_mm, 1, 'mm')],
    ['DC resistance at 20 °C', v(cable.conductor.R20_ohm_km, 4, 'Ω/km')],
    ['AC resistance at max. temperature', cable.conductor.Rac_ohm_km ? v(cable.conductor.Rac_ohm_km, 4, 'Ω/km') + ' (datasheet)' : 'calculated'],
    ['ks / kp', `${opt(cable.conductor.ks, String(kk.ks), 3)} / ${opt(cable.conductor.kp, String(kk.kp), 3)}`],
    ['Conductor screen', v(cable.conductorScreen_mm, 1, 'mm')],
    ['Insulation', `${ins.label}, ${v(cable.insulation.thickness_mm, 1, 'mm')}`],
    ['Insulation ρT', opt(cable.insulation.rhoT, String(ins.rhoT), 2, 'K·m/W')],
    ['Insulation εr / tan δ', `${opt(cable.insulation.epsR, String(ins.epsR), 2)} / ${opt(cable.insulation.tanDelta, String(ins.tanDelta), 4)}`],
    ['Insulation screen', v(cable.insulationScreen_mm, 1, 'mm')],
    ['Tapes under metallic screen', v(cable.bedding_mm, 1, 'mm')],
    [
      'Metallic screen / sheath',
      `${s.form === 'wires' ? 'Wire screen' : s.form === 'smooth' ? 'Smooth sheath' : 'Corrugated sheath'}, ${METALS[s.material].label}, ${v(s.thickness_mm, 2, 'mm')}${s.wireCount ? `, ${s.wireCount} wires` : ''}`,
    ],
    ['Screen cross-section', s.area_mm2 ? v(s.area_mm2, 1, 'mm²') : 'from geometry or resistance'],
    ['Screen resistance at 20 °C', s.R20_ohm_km ? v(s.R20_ohm_km, 4, 'Ω/km') : 'from area'],
    ...(s.form === 'corrugated' ? ([['Diameter over crests Doc', v(s.corrugationOD_mm, 1, 'mm')]] as [string, string][]) : []),
    ['Oversheath', `${jac.label}, ${v(cable.jacket.thickness_mm, 1, 'mm')}`],
    ['Oversheath ρT', opt(cable.jacket.rhoT, String(jac.rhoT), 2, 'K·m/W')],
    ['Overall diameter (datasheet)', cable.overallDiameter_mm ? v(cable.overallDiameter_mm, 1, 'mm') : 'not entered'],
  ];

  const instRows: [string, string][] = [
    ['Method', typeLabel[inst.type]],
    ['Frequency', `${inst.frequency_Hz} Hz`],
    [inst.type === 'air' ? 'Air temperature' : 'Ground temperature', v(inst.ambient_C, 1, '°C')],
  ];
  if (inst.type === 'air') {
    instRows.push(['Arrangement', AIR_CONSTANTS[inst.air.arrangement].label]);
    instRows.push(['Solar radiation', inst.air.solar ? `${v(inst.air.H, 0, 'W/m²')}, σ ${opt(inst.air.absorption, String(jac.solarAbsorption), 2)}` : 'shaded']);
  } else {
    instRows.push(['Formation', `${inst.formation === 'trefoil' ? 'Trefoil' : 'Flat'}, ${inst.touching ? 'touching' : `axial spacing ${v(inst.spacing_mm, 0, 'mm')}`}${inst.formation === 'flat' ? (inst.transposed ? ', transposed' : ', not transposed') : ''}`]);
    instRows.push([inst.type === 'ductbank' ? 'Depth to circuit centre' : 'Depth to circuit centre', v(inst.depth_m, 2, 'm')]);
    instRows.push(['Soil thermal resistivity', v(inst.soilRho, 2, 'K·m/W')]);
    if (inst.type === 'direct' && inst.soilModel !== 'moist')
      instRows.push([
        'Soil drying',
        inst.soilModel === 'two-zone'
          ? `Two-zone, θx ${v(inst.criticalTemp_C, 0, '°C')}, ρ dry ${v(inst.dryRho, 2, 'K·m/W')}`
          : `Avoid drying, θx ${v(inst.criticalTemp_C, 0, '°C')}`,
      ]);
    if (inst.type !== 'direct') {
      const d = DUCTS[inst.duct.material];
      instRows.push(['Ducts', `${d.label}, ⌀ ${v(inst.duct.innerD_mm, 0)} / ${v(inst.duct.outerD_mm, 0, 'mm')}`]);
      instRows.push(['Duct constants U, V, Y', `${inst.duct.U ?? d.U}, ${inst.duct.V ?? d.V}, ${inst.duct.Y ?? d.Y}`]);
    }
    if (inst.type === 'ductbank')
      instRows.push(['Duct bank', `${v(inst.bank.width_m, 2)} × ${v(inst.bank.height_m, 2, 'm')}, concrete ${v(inst.bank.concreteRho, 2, 'K·m/W')}`]);
  }
  instRows.push(['Screen bonding', bondLabel[inst.bonding] + (inst.bonding === 'cross' ? `, λ1′ ${opt(inst.crossBondLambda1, inst.type === 'direct' || inst.type === 'air' ? '0.03' : '0.05', 3)}` : '')]);
  instRows.push(['Dielectric losses', inst.forceDielectric ? 'always included' : 'per IEC 60287-1-1 Table 3 threshold']);

  const out = [
    { title: 'Cable', rows: cableRows },
    { title: 'Installation', rows: instRows },
  ];
  if (inst.type !== 'air' && inst.circuits.length) {
    out.push({
      title: 'Other circuits',
      rows: inst.circuits.map((c) => [
        c.name,
        `${(c.cable?.name ?? 'Same cable as C1').replace(/^Example: /, '')}; x ${v(c.x_m, 2, 'm')}, depth ${v(c.depth_m, 2, 'm')}; ${c.formation}${c.touching ? ' touching' : `, ${v(c.spacing_mm, 0, 'mm')}`}; ${bondLabel[c.bonding].toLowerCase()}; ${c.load === 'fixed' ? `fixed ${v(c.current_A, 0, 'A')}` : 'rated'}`,
      ]),
    });
  }
  return out;
}
