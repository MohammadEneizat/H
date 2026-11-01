import React from 'react';
import type { GroundMaterial } from '../engine';
import type { ThemeMode } from './theme';

type Kind = 'dots' | 'dash' | 'roots' | 'stones' | 'aggregate' | 'speckle' | 'wave' | 'plain';

const LIGHT: Record<GroundMaterial, { base: string; mark: string; kind: Kind }> = {
  topsoil: { base: '#9b7a55', mark: '#6c5034', kind: 'roots' },
  clay: { base: '#c99c6e', mark: '#a67a4f', kind: 'dash' },
  sand: { base: '#ebdbb0', mark: '#cbb37d', kind: 'dots' },
  'sand-dry': { base: '#f3e8c8', mark: '#d8c690', kind: 'dots' },
  gravel: { base: '#bdb6a8', mark: '#878071', kind: 'stones' },
  cbs: { base: '#d7d0b6', mark: '#a49d84', kind: 'aggregate' },
  ftb: { base: '#d1cbbb', mark: '#a59f8e', kind: 'dots' },
  concrete: { base: '#c7cacd', mark: '#999ea3', kind: 'aggregate' },
  asphalt: { base: '#45484c', mark: '#73777c', kind: 'speckle' },
  subbase: { base: '#aca598', mark: '#7e776b', kind: 'stones' },
  bentonite: { base: '#a3aaad', mark: '#858e91', kind: 'wave' },
  polymer: { base: '#efa33b', mark: '#c47e1f', kind: 'plain' },
  custom: { base: '#cbc3b4', mark: '#a39b8c', kind: 'dots' },
};

const darken = (hex: string, f: number) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${c.map((v) => Math.round(v * f).toString(16).padStart(2, '0')).join('')}`;
};

export function groundColors(mode: ThemeMode, m: GroundMaterial) {
  const c = LIGHT[m] ?? LIGHT.custom;
  return mode === 'light' ? c : { base: darken(c.base, 0.42), mark: darken(c.mark, 0.55), kind: c.kind };
}

const MARKS = [
  [0.12, 0.18],
  [0.42, 0.08],
  [0.71, 0.27],
  [0.27, 0.52],
  [0.58, 0.61],
  [0.88, 0.73],
  [0.08, 0.83],
  [0.4, 0.91],
  [0.83, 0.43],
];

/** One <pattern> per ground material, id `${prefix}-m-${material}`. */
export function MaterialDefs({ prefix, mode, tile }: { prefix: string; mode: ThemeMode; tile: number }) {
  return (
    <>
      {(Object.keys(LIGHT) as GroundMaterial[]).map((m) => {
        const { base, mark, kind } = groundColors(mode, m);
        const t = tile;
        let marks: React.ReactNode = null;
        switch (kind) {
          case 'dots':
            marks = MARKS.map(([x, y], i) => <circle key={i} cx={x * t} cy={y * t} r={t * 0.022} fill={mark} />);
            break;
          case 'dash':
            marks = MARKS.map(([x, y], i) => (
              <line key={i} x1={x * t} y1={y * t} x2={x * t + t * 0.12} y2={y * t} stroke={mark} strokeWidth={t * 0.018} strokeLinecap="round" />
            ));
            break;
          case 'roots':
            marks = MARKS.map(([x, y], i) => (
              <path
                key={i}
                d={`M${x * t} ${y * t} q ${t * 0.04} ${t * 0.05} ${t * 0.02} ${t * 0.11}`}
                fill="none"
                stroke={mark}
                strokeWidth={t * 0.014}
                strokeLinecap="round"
              />
            ));
            break;
          case 'stones':
            marks = MARKS.map(([x, y], i) => (
              <ellipse key={i} cx={x * t} cy={y * t} rx={t * (0.04 + (i % 3) * 0.012)} ry={t * 0.03} fill="none" stroke={mark} strokeWidth={t * 0.012} />
            ));
            break;
          case 'aggregate':
            marks = MARKS.map(([x, y], i) => (
              <circle key={i} cx={x * t} cy={y * t} r={t * (0.018 + (i % 3) * 0.01)} fill={mark} opacity={0.8} />
            ));
            break;
          case 'speckle':
            marks = MARKS.map(([x, y], i) => <circle key={i} cx={y * t} cy={x * t} r={t * 0.014} fill={mark} />);
            break;
          case 'wave':
            marks = (
              <path
                d={`M0 ${t * 0.5} q ${t * 0.25} ${-t * 0.08} ${t * 0.5} 0 t ${t * 0.5} 0`}
                fill="none"
                stroke={mark}
                strokeWidth={t * 0.012}
              />
            );
            break;
          default:
            marks = null;
        }
        return (
          <pattern key={m} id={`${prefix}-m-${m}`} width={t} height={t} patternUnits="userSpaceOnUse">
            <rect width={t} height={t} fill={base} />
            {marks}
          </pattern>
        );
      })}
    </>
  );
}
