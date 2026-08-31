import type { Region, StudyInput } from './types';

let seq = 0;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

export function makeRegion(name: string, overrides: Partial<Region> = {}): Region {
  return {
    id: nextId('region'),
    name,
    soil: [
      { rho: 50, thickness: 2 },
      { rho: 120, thickness: 33 },
      { rho: 65, thickness: 0 },
    ],
    faultCurrent: 6000,
    xOverR: 15,
    faultDuration: 0.5,
    shockDuration: 0.5,
    splitFactor: 1,
    surface: { materialId: 'native', rhoS: 0, thickness: 0 },
    insidePlant: true,
    auxRunLength: 150,
    auxRunPaths: 1,
    ...overrides,
  };
}

/**
 * Default study. The soil model matches the worked example in IEEE Std 2778-2020, Table 1
 * (50 Ω·m for 2 m over 120 Ω·m to 35 m over 65 Ω·m), and the grid geometry reflects the
 * large-spacing SPP layout described in 5.3.1 — a grid sized to surround each 1 MW to 4 MW block,
 * "in excess of 100 m (350 ft)".
 */
export function defaultStudy(): StudyInput {
  return {
    meta: {
      name: 'Untitled SPP grounding study',
      client: '',
      location: '',
      engineer: '',
      date: new Date().toISOString().slice(0, 10),
      plantCapacityMW: 100,
      notes: '',
    },
    units: 'SI',
    bodyWeight: 70,
    footwearResistance: 0,
    gloveResistance: 0,
    grid: {
      lengthX: 1200,
      lengthY: 900,
      spacing: 150,
      depth: 0.75,
      materialId: 'cu-annealed',
      conductorAreaMm2: 67.4,
      conductorDiameterM: 0.0105,
      rodCount: 0,
      rodLength: 3,
      rodDiameterM: 0.0159,
      rodsOnPerimeter: false,
    },
    auxiliary: {
      enabled: true,
      postCount: 400,
      postLength: 2.0,
      postDiameterM: 0.1,
      postSpacing: 5,
      contactFraction: 0.9,
    },
    sizing: {
      materialId: 'cu-annealed',
      ambientTemp: 40,
      maxTemp: 1083,
      duration: 0.5,
    },
    regions: [
      makeRegion('Block A — near interconnect substation', { faultCurrent: 12_000, auxRunLength: 60 }),
      makeRegion('Block M — mid-plant', { faultCurrent: 7000, auxRunLength: 200 }),
      makeRegion('Block Z — far end of collector', { faultCurrent: 4500, auxRunLength: 350 }),
    ],
    traverses: [],
    influenceDepth: 0,
    equivalentSoilMethod: 'apparent',
    fence: {
      enabled: true,
      separation: 6,
      bonded: false,
      potentialFraction: 0.3,
      surface: { materialId: 'native', rhoS: 0, thickness: 0 },
    },
  };
}
