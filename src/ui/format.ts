/** Fixed-decimals formatting; "–" for missing values. */
export function fmt(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return v.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Significant-figure formatting for small engineering quantities. */
export function sig(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e6) return Number(v.toPrecision(digits)).toLocaleString('en-GB', { maximumFractionDigits: 8 });
  return v.toExponential(digits - 1);
}

export function amps(v: number): string {
  return Number.isFinite(v) ? Math.round(v).toLocaleString('en-GB') : '–';
}
