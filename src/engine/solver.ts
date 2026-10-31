// Steady-state current rating of one three-phase circuit of single-core cables
// — IEC 60287-1-1 1.4 (clause 4 in the 2023 edition).
import { deriveGeometry } from './geometry';
import { conductorAC, capacitance, dielectricLoss, sheathLossFactors } from './losses';
import {
  AIR_CONSTANTS,
  DUCTS,
  INSULATIONS,
  JACKETS,
  METALS,
  defaultSkinProximity,
} from './materials';
import {
  airH,
  circuitPositions,
  ductAirT4,
  ductBankCorrection,
  ductBankRadius,
  ductWallT4,
  groupT4,
  thermalT1,
  thermalT3,
  thermalT3Corrugated,
  type Point,
} from './thermal';
import type {
  CableGeometry,
  CableSpec,
  ConductorResult,
  InstallationSpec,
  RatingResult,
  SheathResult,
  T4Breakdown,
  TemperatureResult,
} from './types';

const pick = (v: number | null | undefined, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Number of load-carrying conductors in the cable (single-core cables). */
const n = 1;
/** Armour loss factor (no armour on the cables handled here). */
const lambda2 = 0;
/** Bedding between sheath and armour (no armour). */
const T2 = 0;

type SoilCase = 'moist' | 'two-zone';

/** Everything that does not depend on the current, plus functions for the parts that do. */
interface Model {
  cable: CableSpec;
  inst: InstallationSpec;
  errors: string[];
  warnings: string[];
  notes: string[];
  geometry: CableGeometry;
  omega: number;
  thetaMax: number;
  thetaA: number;
  s: number;
  touching: boolean;
  positions: Point[];
  ks: number;
  kp: number;
  R0: number;
  alphaC: number;
  conductorAt: (theta: number) => ConductorResult;
  C: number;
  Wd: number;
  wdIncluded: boolean;
  wdThreshold: number;
  T1: number;
  T3: number;
  Rs20: number;
  sheathAt: (thetaS: number, R: number) => SheathResult;
  /** Constant part of T4 (everything except the duct air gap or free-air term) */
  ext: {
    kind: 'direct' | 'ducts' | 'air';
    T4fixed: number;
    T4pp?: number;
    T4ppp?: number;
    bankCorrection?: number;
    method: string;
    hottest: number;
    U?: number;
    V?: number;
    Y?: number;
    h?: number;
    De_m?: number;
    sigma?: number;
    H?: number;
  };
  v: number;
  dThetaX: number;
}

function buildModel(cable: CableSpec, inst: InstallationSpec): Model {
  const { geometry: g, errors, warnings } = deriveGeometry(cable);
  const notes: string[] = [];

  const ins = INSULATIONS[cable.insulation.material];
  const jacket = JACKETS[cable.jacket.material];
  const metal = METALS[cable.screen.material];
  const condMetal = METALS[cable.conductor.material];
  const rhoIns = pick(cable.insulation.rhoT, ins.rhoT);
  const epsR = pick(cable.insulation.epsR, ins.epsR);
  const tanD = pick(cable.insulation.tanDelta, ins.tanDelta);
  const rhoJacket = pick(cable.jacket.rhoT, jacket.rhoT);

  const thetaMax = cable.maxTemp_C;
  const thetaA = inst.ambient_C;
  if (!Number.isFinite(thetaMax)) errors.push('Enter the maximum conductor temperature.');
  if (!Number.isFinite(thetaA)) errors.push('Enter the ambient temperature.');
  if (thetaMax <= thetaA) errors.push('The maximum conductor temperature must be above the ambient temperature.');
  if (!pos(inst.frequency_Hz)) errors.push('Enter the system frequency.');
  if (!pos(cable.conductor.R20_ohm_km)) errors.push('Enter the conductor DC resistance at 20 °C.');
  if (!(cable.U0_kV >= 0)) errors.push('Enter the rated voltage U0.');
  if (!pos(rhoIns) || !pos(rhoJacket)) errors.push('Thermal resistivities must be positive.');

  const omega = 2 * Math.PI * inst.frequency_Hz;
  const De = g.De;

  // --- Spacing and positions -------------------------------------------------
  let s: number;
  let touching = inst.touching;
  let formation = inst.formation;
  let objectD = De; // diameter of the object whose external resistance is computed
  if (inst.type === 'ducts' || inst.type === 'ductbank') {
    objectD = inst.duct.outerD_mm;
    s = touching ? objectD : inst.spacing_mm;
  } else if (inst.type === 'air') {
    const a = AIR_CONSTANTS[inst.air.arrangement];
    formation = a.formation;
    touching = a.spacingFactor === 1;
    s = a.spacingFactor ? a.spacingFactor * De : inst.spacing_mm;
  } else {
    s = touching ? De : inst.spacing_mm;
  }
  if (!pos(s)) errors.push('Enter the axial spacing between cables.');
  else if (s < objectD * 0.9999)
    errors.push(
      `The axial spacing (${s.toFixed(1)} mm) is smaller than the ${inst.type === 'ducts' || inst.type === 'ductbank' ? 'duct' : 'cable'} diameter (${objectD.toFixed(1)} mm).`,
    );
  if (!touching && pos(s) && Math.abs(s - objectD) < 1e-6 * objectD) touching = true;

  const depth = inst.depth_m * 1000;
  const positions = circuitPositions(formation, s, inst.type === 'air' ? 0 : depth);

  // --- Conductor ---------------------------------------------------------------
  const dflt = defaultSkinProximity(
    cable.conductor.material,
    cable.conductor.construction,
    ins.system,
    cable.conductor.millikenWires,
  );
  const ks = pick(cable.conductor.ks, dflt.ks);
  const kp = pick(cable.conductor.kp, dflt.kp);
  const R0 = cable.conductor.R20_ohm_km / 1000;
  const alphaC = condMetal.alpha20;
  const Rac = cable.conductor.Rac_ohm_km;
  const conductorAt = (theta: number): ConductorResult => {
    const ac = conductorAC({ R0, alpha20: alphaC, theta, f: inst.frequency_Hz, ks, kp, dc: g.dc, s });
    if (pos(Rac)) {
      const R = (Rac / 1000) * ((1 + alphaC * (theta - 20)) / (1 + alphaC * (thetaMax - 20)));
      return { R0, ks, kp, ...ac, R, fromDatasheet: true };
    }
    return { R0, ks, kp, ...ac, fromDatasheet: false };
  };
  if (pos(Rac)) notes.push('Conductor AC resistance taken from the datasheet value at maximum temperature.');

  // --- Dielectric losses ------------------------------------------------------------
  const C = capacitance(epsR, g.Di, g.dcScreen);
  const wdIncluded = inst.forceDielectric || cable.U0_kV >= ins.wdThreshold_kV;
  const Wd = wdIncluded ? dielectricLoss(omega, C, cable.U0_kV * 1000, tanD) : 0;
  if (!wdIncluded)
    notes.push(
      `Dielectric losses neglected: U0 = ${cable.U0_kV} kV is below the IEC 60287-1-1 Table 3 threshold of ${ins.wdThreshold_kV} kV for this insulation.`,
    );

  // --- Thermal resistances of the cable ----------------------------------------
  const T1 = thermalT1(rhoIns, g.t1, g.dc);
  const T3 =
    cable.screen.form === 'corrugated' && g.Doc && g.Dit
      ? thermalT3Corrugated(rhoJacket, g.t3, g.Doc, g.Dit)
      : thermalT3(rhoJacket, g.t3, g.Da);

  // --- Sheath losses -------------------------------------------------------------------
  const Rs20 = pos(cable.screen.R20_ohm_km) ? cable.screen.R20_ohm_km / 1000 : metal.rho20 / (g.As * 1e-6);
  const crossDefault = inst.type === 'direct' ? 0.03 : inst.type === 'air' ? 0.03 : 0.05;
  const crossBondLambda1 = pick(inst.crossBondLambda1, crossDefault);
  if (inst.bonding === 'cross' && !Number.isFinite(inst.crossBondLambda1 as number))
    notes.push(
      `Cross-bonding: circulating-current loss factor λ1' = ${crossDefault} assumed for unequal minor sections (enter the value for your design if known).`,
    );
  const sheathAt = (thetaS: number, R: number): SheathResult => {
    const k = 1 + metal.alpha20 * (thetaS - 20);
    const Rs = Rs20 * k;
    const rhoS = metal.rho20 * k;
    const out = sheathLossFactors({
      R,
      Rs,
      rhoS,
      d: g.dMean,
      Ds: g.Ds,
      ts: g.ts,
      s,
      omega,
      formation,
      transposed: inst.transposed,
      bonding: inst.bonding,
      milliken: cable.conductor.construction === 'milliken',
      crossBondLambda1,
    });
    let governing = 0;
    out.cables.forEach((c, i) => {
      if (c.lambda1 > out.cables[governing].lambda1) governing = i;
    });
    return { Rs20, Rs, rhoS, ...out, lambda1: out.cables[governing].lambda1, governing };
  };
  if (formation === 'flat')
    notes.push(
      'Flat formation: the largest loss factor of the three cables is combined with T4 of the hottest position (conservative).',
    );

  // --- External thermal resistance ------------------------------------------------
  let ext: Model['ext'];
  if (inst.type === 'air') {
    const a = AIR_CONSTANTS[inst.air.arrangement];
    const De_m = De / 1000;
    const h = airH(a.Z, a.E, a.g, De_m);
    const sigma = pick(inst.air.absorption, jacket.solarAbsorption);
    ext = {
      kind: 'air',
      T4fixed: 0,
      method: `Free air, ${a.label.toLowerCase()}: h = Z/(De*)^g + E with Z = ${a.Z}, E = ${a.E}, g = ${a.g}`,
      hottest: 1,
      h,
      De_m,
      sigma: inst.air.solar ? sigma : 0,
      H: inst.air.solar ? inst.air.H : 0,
    };
    if (inst.air.solar)
      notes.push(`Solar radiation included: H = ${inst.air.H} W/m², absorption coefficient σ = ${sigma}.`);
    notes.push('Free air: clearance from walls and other cables assumed as in IEC 60287-2-1 for the chosen arrangement.');
  } else {
    if (!pos(inst.depth_m)) errors.push('Enter the depth of laying.');
    if (!pos(inst.soilRho)) errors.push('Enter the soil thermal resistivity.');
    const top = Math.min(...positions.map((p) => p.y)) - objectD / 2;
    if (inst.type !== 'ductbank' && pos(inst.depth_m) && top <= 0)
      errors.push('The cables are not fully below the ground surface. Increase the depth.');

    if (inst.type === 'direct') {
      const gT = groupT4(inst.soilRho, De, positions, formation, touching, depth);
      ext = { kind: 'direct', T4fixed: gT.T4, method: gT.method, hottest: gT.hottest };
    } else {
      const duct = DUCTS[inst.duct.material];
      const Dd = inst.duct.innerD_mm;
      const Do = inst.duct.outerD_mm;
      if (!pos(Dd) || !pos(Do)) errors.push('Enter the duct inner and outer diameters.');
      else if (Do <= Dd) errors.push('The duct outer diameter must be larger than the inner diameter.');
      if (pos(Dd) && Dd <= De) errors.push('The duct inner diameter must be larger than the cable diameter.');
      if (De < 25 || De > 100)
        warnings.push(
          `T4' (air in duct) formula of IEC 60287-2-1 is given for cable diameters of 25 mm to 100 mm; this cable is ${De.toFixed(1)} mm.`,
        );
      const rhoDuct = pick(inst.duct.rho, duct.rho);
      const T4pp = ductWallT4(rhoDuct, Do, Dd);
      let T4ppp: number;
      let bankCorrection: number | undefined;
      let method: string;
      let hottest: number;
      if (inst.type === 'ducts') {
        const gT = groupT4(inst.soilRho, Do, positions, formation, touching, depth);
        T4ppp = gT.T4;
        method = `Ducts in soil — ${gT.method}`;
        hottest = gT.hottest;
      } else {
        const W = inst.bank.width_m * 1000;
        const Hb = inst.bank.height_m * 1000;
        const rhoC = inst.bank.concreteRho;
        if (!pos(W) || !pos(Hb)) errors.push('Enter the duct bank width and height.');
        if (!pos(rhoC)) errors.push('Enter the concrete thermal resistivity.');
        if (pos(inst.depth_m) && depth - Hb / 2 <= 0) errors.push('The duct bank must be fully below ground. Increase the depth.');
        const inside = positions.every(
          (p) => Math.abs(p.x) + Do / 2 <= W / 2 + 1e-9 && Math.abs(p.y - depth) + Do / 2 <= Hb / 2 + 1e-9,
        );
        if (!inside) errors.push('The ducts do not fit inside the duct bank. Enlarge the bank or reduce the spacing.');
        if (Math.max(W, Hb) / Math.min(W, Hb) >= 3)
          warnings.push('The duct bank equivalent-radius formula is given for a side ratio below 3.');
        const gT = groupT4(rhoC, Do, positions, formation, touching, depth);
        const rb = ductBankRadius(W, Hb);
        if (depth / rb <= 1) errors.push('The duct bank is too shallow for its size.');
        bankCorrection = ductBankCorrection(3, inst.soilRho, rhoC, depth, rb);
        T4ppp = gT.T4 + bankCorrection;
        method = `Duct bank — ${gT.method}, with ρ of concrete, plus N/2π·(ρe − ρc)·ln(u + √(u² − 1)), u = LG/rb, rb = ${rb.toFixed(0)} mm`;
        hottest = gT.hottest;
      }
      ext = {
        kind: 'ducts',
        T4fixed: T4pp + T4ppp,
        T4pp,
        T4ppp,
        bankCorrection,
        method,
        hottest,
        U: pick(inst.duct.U, duct.U),
        V: pick(inst.duct.V, duct.V),
        Y: pick(inst.duct.Y, duct.Y),
      };
    }
  }

  // --- Soil drying ---------------------------------------------------------------------------
  const v = inst.dryRho / inst.soilRho;
  const dThetaX = inst.criticalTemp_C - thetaA;
  if (inst.type === 'direct' && inst.soilModel !== 'moist') {
    if (!(dThetaX > 0)) errors.push('The critical soil temperature θx must be above the ambient temperature.');
    if (inst.soilModel === 'two-zone' && !(v >= 1))
      errors.push('The dry soil resistivity must be at least the moist soil resistivity.');
  }

  return {
    cable,
    inst,
    errors,
    warnings,
    notes,
    geometry: g,
    omega,
    thetaMax,
    thetaA,
    s,
    touching,
    positions,
    ks,
    kp,
    R0,
    alphaC,
    conductorAt,
    C,
    Wd,
    wdIncluded,
    wdThreshold: ins.wdThreshold_kV,
    T1,
    T3,
    Rs20,
    sheathAt,
    ext,
    v,
    dThetaX,
  };
}

/** Free-air surface temperature rise by the IEC 60287-2-1 2.2.1 iteration. */
function airSurfaceRise(m: Model, dTheta: number, lambda1: number) {
  const { h = 0, De_m = 0, sigma = 0, H = 0 } = m.ext;
  const L = 1 + lambda1 + lambda2;
  const KA = ((Math.PI * De_m * h) / L) * (m.T1 / n + T2 * (1 + lambda1) + m.T3 * L);
  const dThetaD = m.Wd * ((1 / L - 0.5) * m.T1 - (n * lambda2 * T2) / L);
  const dThetaDS = (sigma * H * KA) / (Math.PI * h);
  const rhs = dTheta + dThetaD + dThetaDS;
  let z = 2;
  for (let i = 0; i < 500; i++) {
    const next = (rhs / (1 + KA * z)) ** 0.25;
    if (Math.abs(next - z) < 1e-12) {
      z = next;
      break;
    }
    z = next;
  }
  const T4 = 1 / (Math.PI * De_m * h * z);
  return { dThetaS: z ** 4, T4 };
}

/** I = {[Δθ − Wd(½T1 + n(T2 + T3 + vT4)) + extra] / [R(T1 + n(1+λ1)T2 + n(1+λ1+λ2)(T3 + vT4))]}^½ */
function ratingEquation(
  dTheta: number,
  R: number,
  Wd: number,
  T1: number,
  T3: number,
  T4: number,
  lambda1: number,
  v = 1,
  extra = 0,
): number {
  const num = dTheta - Wd * (0.5 * T1 + n * (T2 + T3 + v * T4)) + extra;
  const den = R * (T1 + n * (1 + lambda1) * T2 + n * (1 + lambda1 + lambda2) * (T3 + v * T4));
  return num > 0 ? Math.sqrt(num / den) : NaN;
}

interface RatingState {
  I: number;
  R: number;
  conductor: ConductorResult;
  sheath: SheathResult;
  t4: T4Breakdown;
  thetaS: number;
  iterations: number;
}

function rateCase(m: Model, soil: SoilCase): RatingState | string {
  const dTheta = m.thetaMax - m.thetaA;
  const conductor = m.conductorAt(m.thetaMax);
  const R = conductor.R;
  let thetaS = m.thetaMax - 0.1 * dTheta;
  let thetaM = m.thetaA + 0.5 * dTheta;
  let I = NaN;
  let sheath = m.sheathAt(thetaS, R);
  let t4: T4Breakdown = { T4: NaN, method: m.ext.method, hottest: m.ext.hottest };
  let it = 0;
  for (it = 1; it <= 300; it++) {
    sheath = m.sheathAt(thetaS, R);
    const l1 = sheath.lambda1;
    if (m.ext.kind === 'air') {
      const air = airSurfaceRise(m, dTheta, l1);
      const extra = -(m.ext.sigma ?? 0) * (m.ext.De_m ?? 0) * (m.ext.H ?? 0) * air.T4;
      I = ratingEquation(dTheta, R, m.Wd, m.T1, m.T3, air.T4, l1, 1, extra);
      t4 = { T4: air.T4, h: m.ext.h, dThetaS: air.dThetaS, method: m.ext.method, hottest: m.ext.hottest };
    } else if (m.ext.kind === 'ducts') {
      const T4p = ductAirT4(m.ext.U!, m.ext.V!, m.ext.Y!, thetaM, m.geometry.De);
      const T4 = T4p + m.ext.T4fixed;
      I = ratingEquation(dTheta, R, m.Wd, m.T1, m.T3, T4, l1);
      t4 = {
        T4,
        T4p,
        T4pp: m.ext.T4pp,
        T4ppp: m.ext.T4ppp,
        bankCorrection: m.ext.bankCorrection,
        thetaM,
        method: m.ext.method,
        hottest: m.ext.hottest,
      };
    } else {
      const T4 = m.ext.T4fixed;
      I =
        soil === 'two-zone'
          ? ratingEquation(dTheta, R, m.Wd, m.T1, m.T3, T4, l1, m.v, (m.v - 1) * m.dThetaX)
          : ratingEquation(dTheta, R, m.Wd, m.T1, m.T3, T4, l1);
      t4 = { T4, method: m.ext.method, hottest: m.ext.hottest };
    }
    if (!Number.isFinite(I))
      return 'No current can be carried: the dielectric losses and ambient temperature already use up the permissible temperature rise.';
    const Wc = I * I * R;
    const W = Wc * (1 + l1) + m.Wd;
    const nextThetaS = m.thetaMax - (Wc + 0.5 * m.Wd) * m.T1;
    let nextThetaM = thetaM;
    if (m.ext.kind === 'ducts' && t4.T4p !== undefined) {
      const surface = nextThetaS - n * W * m.T3;
      nextThetaM = surface - 0.5 * n * W * t4.T4p;
    }
    const done = Math.abs(nextThetaS - thetaS) < 1e-9 && Math.abs(nextThetaM - thetaM) < 1e-9;
    thetaS = nextThetaS;
    thetaM = nextThetaM;
    if (done) break;
  }
  sheath = m.sheathAt(thetaS, R);
  return { I, R, conductor, sheath, t4, thetaS, iterations: it };
}

/** Conductor temperature for a given current, with all properties at their actual temperatures. */
function temperatureAt(m: Model, I: number, soil: SoilCase) {
  let thetaC = m.thetaMax;
  let thetaM = m.thetaA + 10;
  let out = { thetaC, thetaS: thetaC, surface: thetaC, R: 0, lambda1: 0, W: 0, iterations: 0, extRiseMoist: 0 };
  for (let it = 1; it <= 500; it++) {
    const R = m.conductorAt(thetaC).R;
    const Wc = I * I * R;
    const thetaSRel = (Wc + 0.5 * m.Wd) * m.T1;
    const thetaS = thetaC - thetaSRel;
    const l1 = m.sheathAt(thetaS, R).lambda1;
    const W = Wc * (1 + l1) + m.Wd;
    const internal = thetaSRel + n * (Wc * (1 + l1) + m.Wd) * T2 + n * W * m.T3;
    let ext: number;
    let extMoist: number;
    if (m.ext.kind === 'air') {
      const { h = 0, De_m = 0, sigma = 0, H = 0 } = m.ext;
      ext = ((n * W + sigma * De_m * H) / (Math.PI * De_m * h)) ** 0.8;
      extMoist = ext;
    } else if (m.ext.kind === 'ducts') {
      let T4p = 0;
      for (let k = 0; k < 100; k++) {
        T4p = ductAirT4(m.ext.U!, m.ext.V!, m.ext.Y!, thetaM, m.geometry.De);
        const surface = m.thetaA + n * W * (T4p + m.ext.T4fixed);
        const next = surface - 0.5 * n * W * T4p;
        if (Math.abs(next - thetaM) < 1e-10) break;
        thetaM = next;
      }
      ext = n * W * (T4p + m.ext.T4fixed);
      extMoist = ext;
    } else {
      extMoist = n * W * m.ext.T4fixed;
      ext =
        soil === 'two-zone' && extMoist > m.dThetaX ? m.dThetaX + m.v * (extMoist - m.dThetaX) : extMoist;
    }
    const next = m.thetaA + internal + ext;
    out = {
      thetaC: next,
      thetaS,
      surface: m.thetaA + ext,
      R,
      lambda1: l1,
      W,
      iterations: it,
      extRiseMoist: extMoist,
    };
    if (Math.abs(next - thetaC) < 1e-9) break;
    thetaC = next;
    if (!Number.isFinite(thetaC) || thetaC > 1e4) break;
  }
  return out;
}

/** Permissible continuous current of the circuit (100 % load factor). */
export function calculateRating(cable: CableSpec, inst: InstallationSpec): RatingResult {
  const m = buildModel(cable, inst);
  const base = {
    errors: m.errors,
    warnings: [...m.warnings],
    notes: [...m.notes],
    geometry: m.geometry,
    spacing_mm: m.s,
    positions: m.positions,
  };
  const fail = (msg?: string): RatingResult => ({
    ...base,
    ok: false,
    errors: msg ? [...m.errors, msg] : m.errors,
    I: NaN,
    governingCase: '',
    cases: [],
    conductor: m.conductorAt(m.thetaMax),
    dielectric: { C: m.C, Wd: m.Wd, included: m.wdIncluded, threshold_kV: m.wdThreshold },
    sheath: m.sheathAt(m.thetaMax, m.conductorAt(m.thetaMax).R),
    thermal: { T1: m.T1, T2, T3: m.T3, t4: { T4: NaN, method: '', hottest: 0 } },
    losses: { Wc: NaN, Ws: NaN, Wd: m.Wd, W: NaN },
    temperatures: { conductor: NaN, sheath: NaN, surface: NaN },
    iterations: 0,
  });
  if (m.errors.length) return fail();

  const moist = rateCase(m, 'moist');
  if (typeof moist === 'string') return fail(moist);
  let chosen = moist;
  let chosenKind: 'moist' | 'two-zone' | 'avoid' = 'moist';
  let governingCase = 'Moist soil (IEC 60287-1-1 1.4.1.1)';
  if (inst.type === 'air') governingCase = inst.air.solar ? 'Free air with solar radiation (1.4.4)' : 'Free air (1.4.1.1)';
  if (inst.type === 'ducts') governingCase = 'Ducts in soil (1.4.1.1)';
  if (inst.type === 'ductbank') governingCase = 'Duct bank (1.4.1.1)';
  const cases = [{ label: governingCase, I: moist.I }];

  if (inst.type === 'direct' && inst.soilModel === 'two-zone') {
    const dry = rateCase(m, 'two-zone');
    if (typeof dry === 'string') return fail(dry);
    cases.push({ label: 'Partial drying-out, two-zone model (1.4.2.1)', I: dry.I });
    if (dry.I < moist.I) {
      chosen = dry;
      chosenKind = 'two-zone';
      governingCase = cases[1].label;
    }
    base.notes.push(
      `Two-zone soil model: v = ρd/ρw = ${m.v.toFixed(2)}, Δθx = ${m.dThetaX.toFixed(1)} K. The lower of the moist and drying-out ratings is used.`,
    );
  }
  if (inst.type === 'direct' && inst.soilModel === 'avoid-drying') {
    // Largest current for which the cable surface rise stays at Δθx (1.4.3.1), with R at the actual temperature.
    let lo = 0;
    let hi = moist.I * 1.5;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      const t = temperatureAt(m, mid, 'moist');
      if (t.extRiseMoist > m.dThetaX) hi = mid;
      else lo = mid;
    }
    cases.push({ label: 'Surface limited to θx to avoid drying out (1.4.3.1)', I: lo });
    if (lo < moist.I) {
      chosenKind = 'avoid';
      governingCase = cases[1].label;
      const t = temperatureAt(m, lo, 'moist');
      const conductor = m.conductorAt(t.thetaC);
      chosen = {
        ...moist,
        I: lo,
        R: conductor.R,
        conductor,
        sheath: m.sheathAt(t.thetaS, conductor.R),
        thetaS: t.thetaS,
      };
    }
  }

  const I = chosen.I;
  const Wc = I * I * chosen.R;
  const l1 = chosen.sheath.lambda1;
  const W = n * (Wc * (1 + l1 + lambda2) + m.Wd);
  const conductorTemp =
    chosenKind === 'avoid' ? temperatureAt(m, I, 'moist').thetaC : m.thetaMax;
  const sheathTemp = conductorTemp - (Wc + 0.5 * m.Wd) * m.T1;
  const surface = sheathTemp - n * W * m.T3;
  const temperatures: RatingResult['temperatures'] = { conductor: conductorTemp, sheath: sheathTemp, surface };
  if (chosen.t4.T4p !== undefined) temperatures.ductInner = surface - W * chosen.t4.T4p;

  const c = chosen.conductor;
  if (c.xs > 2.8)
    base.warnings.push(
      `Skin effect argument xs = ${c.xs.toFixed(2)} is above 2.8, so the extended IEC formula was used. For large Milliken conductors, enter the datasheet AC resistance.`,
    );
  if (c.xp > 2.8)
    base.warnings.push(`Proximity effect argument xp = ${c.xp.toFixed(2)} is above 2.8, outside the range of the IEC formula.`);

  return {
    ...base,
    ok: true,
    I,
    governingCase,
    cases,
    conductor: c,
    dielectric: { C: m.C, Wd: m.Wd, included: m.wdIncluded, threshold_kV: m.wdThreshold },
    sheath: chosen.sheath,
    thermal: { T1: m.T1, T2, T3: m.T3, t4: chosen.t4 },
    losses: { Wc, Ws: Wc * l1, Wd: m.Wd, W },
    temperatures,
    iterations: chosen.iterations,
  };
}

/** Steady-state conductor temperature of the hottest cable at a given load current. */
export function calculateTemperature(
  cable: CableSpec,
  inst: InstallationSpec,
  I: number,
): TemperatureResult {
  const m = buildModel(cable, inst);
  if (m.errors.length || !(I >= 0))
    return {
      ok: false,
      errors: m.errors.length ? m.errors : ['Enter a load current.'],
      I,
      conductor: NaN,
      sheath: NaN,
      surface: NaN,
      R: NaN,
      lambda1: NaN,
      W: NaN,
      iterations: 0,
    };
  const soil: SoilCase = inst.type === 'direct' && inst.soilModel === 'two-zone' ? 'two-zone' : 'moist';
  const t = temperatureAt(m, I, soil);
  return {
    ok: Number.isFinite(t.thetaC) && t.thetaC < 1e4,
    errors: Number.isFinite(t.thetaC) && t.thetaC < 1e4 ? [] : ['The temperature does not converge at this current.'],
    I,
    conductor: t.thetaC,
    sheath: t.thetaS,
    surface: t.surface,
    R: t.R,
    lambda1: t.lambda1,
    W: t.W,
    iterations: t.iterations,
  };
}

export type SweepParam = 'depth_m' | 'soilRho' | 'ambient_C' | 'spacing_mm';

/** Rating as one installation parameter varies. */
export function sweepRating(
  cable: CableSpec,
  inst: InstallationSpec,
  param: SweepParam,
  values: number[],
): { x: number; I: number }[] {
  return values.map((x) => {
    const next: InstallationSpec = { ...inst, [param]: x };
    if (param === 'spacing_mm') next.touching = false;
    const r = calculateRating(cable, next);
    return { x, I: r.ok ? r.I : NaN };
  });
}
