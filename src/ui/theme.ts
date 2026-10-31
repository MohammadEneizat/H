import { useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

/** Resolved colours for the drawings (hex, so an SVG can be exported on its own). */
export interface Palette {
  mode: ThemeMode;
  ink: string;
  ink2: string;
  ink3: string;
  accent: string;
  panel: string;
  /** Metals: highlight, body, shadow */
  cu: [string, string, string];
  al: [string, string, string];
  pb: [string, string, string];
  steel: [string, string, string];
  semicon: string;
  xlpe: [string, string];
  tape: string;
  tapeLine: string;
  jacket: [string, string];
  jacketEdge: string;
  sky: [string, string];
  grass: string;
  topsoil: string;
  soil: string;
  soilGrain: string;
  concrete: string;
  aggregate: string;
  duct: string;
  ductEdge: string;
  air: string;
  /** Temperature ramp from ambient to hottest (one hue, light to dark; reversed in dark mode) */
  heat: string[];
  isotherm: string;
  halo: string;
}

export const PALETTES: Record<ThemeMode, Palette> = {
  light: {
    mode: 'light',
    ink: '#142029',
    ink2: '#485662',
    ink3: '#66737f',
    accent: '#a24f1c',
    panel: '#ffffff',
    cu: ['#f1b989', '#c8783f', '#8a4a1f'],
    al: ['#eef1f3', '#b3bbc2', '#7c868e'],
    pb: ['#a7afb6', '#717b84', '#4a535b'],
    steel: ['#c3c9ce', '#8b949b', '#5d666d'],
    semicon: '#1c2024',
    xlpe: ['#fbfcfb', '#dfe6e4'],
    tape: '#c8ced2',
    tapeLine: '#a3abb1',
    jacket: ['#4a535a', '#1a1f23'],
    jacketEdge: '#0e1215',
    sky: ['#dbe8f2', '#eef4f8'],
    grass: '#6b8c37',
    topsoil: '#a98b63',
    soil: '#dccfb6',
    soilGrain: '#c6b493',
    concrete: '#c9ccce',
    aggregate: '#a6abaf',
    duct: '#8e979d',
    ductEdge: '#5f686f',
    air: '#eef3f6',
    heat: ['#fff1e3', '#f9c99e', '#ee8e55', '#cf5a26', '#982f12', '#5e1708'],
    isotherm: '#3d2216',
    halo: '#ffffff',
  },
  dark: {
    mode: 'dark',
    ink: '#e4ebf1',
    ink2: '#a8b5c1',
    ink3: '#8693a0',
    accent: '#e48c52',
    panel: '#141c23',
    cu: ['#f0b484', '#c47538', '#7a3f18'],
    al: ['#d9dfe3', '#9aa4ad', '#646e76'],
    pb: ['#959ea6', '#646e77', '#3f474f'],
    steel: ['#b0b7bd', '#7d868e', '#525b62'],
    semicon: '#050708',
    xlpe: ['#56636d', '#3a4650'],
    tape: '#59646d',
    tapeLine: '#76818a',
    jacket: ['#2c3338', '#0a0d0f'],
    jacketEdge: '#5b6670',
    sky: ['#121b23', '#18232c'],
    grass: '#4d6a2a',
    topsoil: '#4a3a27',
    soil: '#3a3227',
    soilGrain: '#4b4133',
    concrete: '#4c5258',
    aggregate: '#61686e',
    duct: '#6f7982',
    ductEdge: '#9aa4ad',
    air: '#17212a',
    heat: ['#3b2a20', '#6a3218', '#a8461b', '#dc6a2e', '#f39a5c', '#ffd2a8'],
    isotherm: '#ffe7d3',
    halo: '#141c23',
  },
};

function currentMode(): ThemeMode {
  try {
    const t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark' || t === 'light') return t;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** The viewer's theme: an explicit data-theme on <html>, else the system setting. */
export function useThemeMode(): ThemeMode {
  const [mode, setMode] = useState<ThemeMode>(currentMode);
  useEffect(() => {
    const update = () => setMode(currentMode());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq.removeEventListener?.('change', update);
      mo.disconnect();
    };
  }, []);
  return mode;
}

// --- Colour interpolation in OKLab ----------------------------------------------------

type RGB = [number, number, number];

const hexToRgb = (hex: string): RGB => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
};
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToOklab([r, g, b]: RGB): RGB {
  const [R, G, B] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [R, G, B].map((c) => Math.min(1, Math.max(0, fromLinear(c)))) as RGB;
}

/** Builds a lookup function t ∈ [0, 1] → [r, g, b] (0–255) along the given stops. */
export function makeRamp(stops: string[]): (t: number) => [number, number, number] {
  const labs = stops.map((s) => rgbToOklab(hexToRgb(s)));
  const n = labs.length - 1;
  const cache = new Map<number, [number, number, number]>();
  return (t: number) => {
    const k = Math.round(Math.min(1, Math.max(0, t)) * 512);
    const hit = cache.get(k);
    if (hit) return hit;
    const x = (k / 512) * n;
    const i = Math.min(n - 1, Math.floor(x));
    const f = x - i;
    const a = labs[i];
    const b = labs[i + 1];
    const rgb = oklabToRgb([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
    const out: [number, number, number] = [Math.round(rgb[0] * 255), Math.round(rgb[1] * 255), Math.round(rgb[2] * 255)];
    cache.set(k, out);
    return out;
  };
}

export const rgbHex = ([r, g, b]: [number, number, number]) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Opacity of the heat overlay: clear at ambient, nearly opaque at the hottest. */
export const heatAlpha = (t: number) => 0.92 * Math.sqrt(Math.min(1, Math.max(0, t)));
