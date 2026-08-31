import type { ReactNode } from 'react';
import type { UnitSystem } from '../engine';

/* ---------------------------------------------------------------- units --- */

export const M_PER_FT = 0.3048;

export function toDisplayLength(meters: number, units: UnitSystem): number {
  return units === 'US' ? meters / M_PER_FT : meters;
}
export function fromDisplayLength(value: number, units: UnitSystem): number {
  return units === 'US' ? value * M_PER_FT : value;
}
export function lengthUnit(units: UnitSystem): string {
  return units === 'US' ? 'ft' : 'm';
}
export function areaLabel(areaM2: number, units: UnitSystem): string {
  if (units === 'US') {
    const acres = areaM2 / 4046.8564224;
    return `${fmt(areaM2 / (M_PER_FT * M_PER_FT), 0)} ft² (${fmt(acres, 1)} acres)`;
  }
  const hectares = areaM2 / 10_000;
  return `${fmt(areaM2, 0)} m² (${fmt(hectares, 1)} ha)`;
}

/* ------------------------------------------------------------ formatting --- */

export function fmt(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  if (value !== 0 && Math.abs(value) < 0.001) return value.toExponential(2);
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/* ------------------------------------------------------------- primitives --- */

export function Card({
  title,
  subtitle,
  children,
  actions,
}: {
  title?: string;
  subtitle?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  );
}

export function Grid({ cols = 2, children }: { cols?: number; children: ReactNode }) {
  return (
    <div className="field-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {children}
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  unit,
  hint,
  step = 'any',
  min,
  max,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  hint?: ReactNode;
  step?: number | 'any';
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <label className={`field${disabled ? ' is-disabled' : ''}`}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="number"
          value={Number.isFinite(value) ? Number(value.toFixed(6)) : ''}
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onChange(Number.isFinite(v) ? v : 0);
          }}
        />
        {unit && <span className="field-unit">{unit}</span>}
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function LengthField({
  label,
  meters,
  onChange,
  units,
  hint,
  min,
}: {
  label: string;
  meters: number;
  onChange: (meters: number) => void;
  units: UnitSystem;
  hint?: ReactNode;
  min?: number;
}) {
  return (
    <NumberField
      label={label}
      value={toDisplayLength(meters, units)}
      unit={lengthUnit(units)}
      min={min}
      hint={hint}
      onChange={(v) => onChange(fromDisplayLength(v, units))}
    />
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      </span>
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  hint?: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <select value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: ReactNode;
}) {
  return (
    <label className="field field-check">
      <span className="check-row">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="field-label">{label}</span>
      </span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Stat({
  label,
  value,
  unit,
  tone,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'pass' | 'marginal' | 'fail' | 'neutral';
  note?: ReactNode;
}) {
  return (
    <div className={`stat${tone ? ` tone-${tone}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

export function Badge({ verdict }: { verdict: 'pass' | 'marginal' | 'fail' }) {
  const text = verdict === 'pass' ? 'Compliant' : verdict === 'marginal' ? 'Marginal' : 'Exceeds limit';
  return <span className={`badge badge-${verdict}`}>{text}</span>;
}

export function Callout({
  kind = 'info',
  title,
  children,
}: {
  kind?: 'info' | 'warn' | 'ref';
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`callout callout-${kind}`}>
      {title && <strong>{title}</strong>}
      <div>{children}</div>
    </div>
  );
}

/** A short citation to the governing clause, rendered inline. */
export function Ref({ children }: { children: ReactNode }) {
  return <cite className="ref">{children}</cite>;
}
