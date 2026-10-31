import React, { useEffect, useId, useState } from 'react';

const parse = (t: string): number | null => {
  const s = t.trim().replace(',', '.');
  if (s === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : NaN;
};

const show = (v: number | null | undefined) =>
  v === null || v === undefined || Number.isNaN(v) ? '' : String(Number(v.toPrecision(10)));

interface NumProps {
  id: string;
  label: string;
  unit?: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  /** Shown when empty; for optional overrides this is the standard value */
  placeholder?: string;
  hint?: string;
  step?: number;
  optional?: boolean;
}

/** Number input that keeps the typed text and reports a parsed number (null when empty). */
export function NumField({ id, label, unit, value, onChange, placeholder, hint, step, optional }: NumProps) {
  const [text, setText] = useState(show(value));
  useEffect(() => {
    const parsed = parse(text);
    if (parsed !== value && !(Number.isNaN(parsed as number) && value === null)) setText(show(value));
    // Only outside changes of the value replace the typed text.
  }, [value]);
  const parsed = parse(text);
  const invalid = Number.isNaN(parsed as number) || (!optional && parsed === null);
  return (
    <div className={`field${invalid ? ' is-invalid' : ''}`}>
      <label htmlFor={id}>
        <span className="field-label">{label}</span>
        {optional && <span className="field-tag">optional</span>}
      </label>
      <div className="field-input">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          placeholder={placeholder}
          step={step}
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            const v = parse(e.target.value);
            if (v === null) onChange(null);
            else if (!Number.isNaN(v)) onChange(v);
          }}
        />
        {unit && <span className="field-unit">{unit}</span>}
      </div>
      {hint && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

interface SelectProps<T extends string> {
  id: string;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  hint?: string;
}

export function SelectField<T extends string>({ id, label, value, options, onChange, hint }: SelectProps<T>) {
  return (
    <div className="field">
      <label htmlFor={id}>
        <span className="field-label">{label}</span>
      </label>
      <div className="field-input">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function TextField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field field-wide">
      <label htmlFor={id}>
        <span className="field-label">{label}</span>
      </label>
      <div className="field-input">
        <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

interface SegProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  id: string;
}

/** Segmented radio group. */
export function Segmented<T extends string>({ label, value, options, onChange, id }: SegProps<T>) {
  return (
    <fieldset className="field field-wide segmented" id={id}>
      <legend className="field-label">{label}</legend>
      <div className="seg-row" role="radiogroup">
        {options.map((o) => (
          <label key={o.value} className={`seg${o.value === value ? ' is-on' : ''}`}>
            <input
              type="radio"
              name={id}
              value={o.value}
              checked={o.value === value}
              onChange={() => onChange(o.value)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Toggle({
  id,
  label,
  checked,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="field field-wide toggle">
      <label htmlFor={id} className="toggle-row">
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-track" aria-hidden="true" />
        <span className="field-label">{label}</span>
      </label>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function Section({
  title,
  children,
  aside,
}: {
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  const id = useId();
  return (
    <section className="form-section" aria-labelledby={id}>
      <header className="form-section-head">
        <h3 id={id}>{title}</h3>
        {aside}
      </header>
      <div className="field-grid">{children}</div>
    </section>
  );
}

/** Collapsible group of standard-value overrides. */
export function Overrides({ children, label = 'Override standard values' }: { children: React.ReactNode; label?: string }) {
  return (
    <details className="overrides field-wide">
      <summary>{label}</summary>
      <div className="field-grid">{children}</div>
    </details>
  );
}
