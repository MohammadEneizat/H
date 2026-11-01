import React from 'react';
import {
  AIR_CONSTANTS,
  defaultTrench,
  DUCTS,
  JACKETS,
  type AirArrangement,
  type CableSpec,
  type DuctKey,
  type InstallationSpec,
} from '../engine';
import { NumField, Overrides, Section, SelectField, Segmented, Toggle } from './fields';

interface Props {
  inst: InstallationSpec;
  cable: CableSpec;
  onChange: (i: InstallationSpec) => void;
}

const ductOptions = (Object.keys(DUCTS) as DuctKey[]).map((k) => ({ value: k, label: DUCTS[k].label }));
const airOptions = (Object.keys(AIR_CONSTANTS) as AirArrangement[]).map((k) => ({
  value: k,
  label: AIR_CONSTANTS[k].label,
}));

export function InstallationForm({ inst, cable, onChange }: Props) {
  const i = inst;
  const set = (patch: Partial<InstallationSpec>) => onChange({ ...i, ...patch });
  const setDuct = (patch: Partial<InstallationSpec['duct']>) => set({ duct: { ...i.duct, ...patch } });
  const setBank = (patch: Partial<InstallationSpec['bank']>) => set({ bank: { ...i.bank, ...patch } });
  const setAir = (patch: Partial<InstallationSpec['air']>) => set({ air: { ...i.air, ...patch } });
  const num = (v: number | null) => (v === null ? NaN : v);
  const buried = i.type !== 'air';
  const trench = i.type === 'trench';
  const inDucts = i.type === 'ducts' || i.type === 'ductbank' || (trench && !!i.trench?.ducted);
  const duct = DUCTS[i.duct.material];
  const airSpaced = i.type === 'air' && AIR_CONSTANTS[i.air.arrangement].spacingFactor === null;
  const flat = i.type === 'air' ? AIR_CONSTANTS[i.air.arrangement].formation === 'flat' : i.formation === 'flat';

  return (
    <div className="form">
      <Section title="Installation">
        <Segmented
          id="inst-type"
          label="Method"
          value={i.type}
          options={[
            { value: 'direct', label: 'Direct buried' },
            { value: 'ducts', label: 'Ducts' },
            { value: 'ductbank', label: 'Duct bank' },
            { value: 'air', label: 'Free air' },
            { value: 'trench', label: 'Trench layout' },
          ]}
          onChange={(type) => set(type === 'trench' && !i.trench ? { type, trench: defaultTrench(i) } : { type })}
        />
        {trench && (
          <p className="field-hint field-wide">
            Build the trench in the editor next to the results: ground layers, fill zones, cover tiles and cable
            positions. The rating is shown by the IEC method and by a numerical ground model.
          </p>
        )}
        <NumField
          id="amb"
          label={buried ? 'Ground temperature at depth' : 'Air temperature'}
          unit="°C"
          value={i.ambient_C}
          onChange={(v) => set({ ambient_C: num(v) })}
        />
        <SelectField
          id="freq"
          label="Frequency"
          value={String(i.frequency_Hz) as '50' | '60'}
          options={[
            { value: '50', label: '50 Hz' },
            { value: '60', label: '60 Hz' },
          ]}
          onChange={(v) => set({ frequency_Hz: Number(v) })}
        />
      </Section>

      <Section title="Circuit">
        {i.type === 'air' ? (
          <SelectField
            id="air-arr"
            label="Arrangement"
            value={i.air.arrangement}
            options={airOptions}
            onChange={(arrangement) => setAir({ arrangement })}
          />
        ) : (
          <Segmented
            id="formation"
            label="Formation"
            value={i.formation}
            options={[
              { value: 'trefoil', label: 'Trefoil' },
              { value: 'flat', label: 'Flat' },
            ]}
            onChange={(formation) => set({ formation })}
          />
        )}
        {i.type !== 'air' && (
          <Toggle
            id="touching"
            label={inDucts ? 'Ducts touching' : 'Cables touching'}
            checked={i.touching}
            onChange={(touching) => set({ touching })}
          />
        )}
        {((i.type !== 'air' && !i.touching) || airSpaced) && (
          <NumField
            id="spacing"
            label={inDucts ? 'Axial spacing of ducts' : 'Axial spacing of cables'}
            unit="mm"
            value={i.spacing_mm}
            onChange={(v) => set({ spacing_mm: num(v) })}
            hint="Centre to centre, between adjacent phases."
          />
        )}
        {flat && (
          <Toggle
            id="transposed"
            label="Cables regularly transposed"
            checked={i.transposed}
            onChange={(transposed) => set({ transposed })}
          />
        )}
        <Segmented
          id="bonding"
          label="Screen bonding"
          value={i.bonding}
          options={[
            { value: 'both', label: 'Both ends' },
            { value: 'single', label: 'Single point' },
            { value: 'cross', label: 'Cross-bonded' },
          ]}
          onChange={(bonding) => set({ bonding })}
        />
        {i.bonding === 'cross' && (
          <NumField
            id="xb"
            label="Circulating loss factor λ1′"
            optional
            value={i.crossBondLambda1}
            onChange={(v) => set({ crossBondLambda1: v })}
            placeholder={i.type === 'ducts' || i.type === 'ductbank' ? '0.05' : '0.03'}
            hint="Residual loss from unequal minor sections. Enter 0 for perfectly balanced sections."
          />
        )}
        <Toggle
          id="wd"
          label="Always include dielectric losses"
          checked={i.forceDielectric}
          onChange={(forceDielectric) => set({ forceDielectric })}
          hint="IEC 60287-1-1 Table 3 neglects them below a voltage threshold."
        />
      </Section>

      {buried && (
        <Section title={i.type === 'ductbank' ? 'Duct bank and soil' : trench ? 'Main circuit position' : 'Soil'}>
          <NumField
            id="depth"
            label={i.type === 'ductbank' ? 'Depth to centre of bank' : 'Depth to centre of circuit'}
            unit="m"
            value={i.depth_m}
            onChange={(v) => set({ depth_m: num(v) })}
          />
          {trench ? (
            <NumField
              id="main-x"
              label="Horizontal position"
              unit="m"
              value={i.mainX_m ?? 0}
              onChange={(v) => set({ mainX_m: v ?? 0 })}
            />
          ) : (
            <NumField
              id="soil"
              label="Soil thermal resistivity"
              unit="K·m/W"
              value={i.soilRho}
              onChange={(v) => set({ soilRho: num(v) })}
            />
          )}
          {i.type === 'ductbank' && (
            <>
              <NumField
                id="bank-w"
                label="Bank width"
                unit="m"
                value={i.bank.width_m}
                onChange={(v) => setBank({ width_m: num(v) })}
              />
              <NumField
                id="bank-h"
                label="Bank height"
                unit="m"
                value={i.bank.height_m}
                onChange={(v) => setBank({ height_m: num(v) })}
              />
              <NumField
                id="bank-rho"
                label="Concrete resistivity"
                unit="K·m/W"
                value={i.bank.concreteRho}
                onChange={(v) => setBank({ concreteRho: num(v) })}
              />
            </>
          )}
          {i.type === 'direct' && (
            <>
              <Segmented
                id="soil-model"
                label="Soil drying"
                value={i.soilModel}
                options={[
                  { value: 'moist', label: 'Moist' },
                  { value: 'two-zone', label: 'Partial drying' },
                  { value: 'avoid-drying', label: 'Avoid drying' },
                ]}
                onChange={(soilModel) => set({ soilModel })}
              />
              {i.soilModel !== 'moist' && (
                <NumField
                  id="theta-x"
                  label="Critical soil temperature θx"
                  unit="°C"
                  value={i.criticalTemp_C}
                  onChange={(v) => set({ criticalTemp_C: num(v) })}
                />
              )}
              {i.soilModel === 'two-zone' && (
                <NumField
                  id="rho-dry"
                  label="Dry soil resistivity"
                  unit="K·m/W"
                  value={i.dryRho}
                  onChange={(v) => set({ dryRho: num(v) })}
                />
              )}
            </>
          )}
        </Section>
      )}

      {inDucts && (
        <Section title="Ducts">
          <SelectField
            id="duct-mat"
            label="Duct material"
            value={i.duct.material}
            options={ductOptions}
            onChange={(material) => setDuct({ material })}
          />
          <NumField
            id="duct-id"
            label="Inner diameter"
            unit="mm"
            value={i.duct.innerD_mm}
            onChange={(v) => setDuct({ innerD_mm: num(v) })}
          />
          <NumField
            id="duct-od"
            label="Outer diameter"
            unit="mm"
            value={i.duct.outerD_mm}
            onChange={(v) => setDuct({ outerD_mm: num(v) })}
          />
          <Overrides label="Override duct constants (IEC 60287-2-1 Table 4)">
            <NumField
              id="duct-rho"
              label="Wall resistivity"
              unit="K·m/W"
              optional
              value={i.duct.rho}
              onChange={(v) => setDuct({ rho: v })}
              placeholder={`${duct.rho}`}
            />
            <NumField id="duct-u" label="U" optional value={i.duct.U} onChange={(v) => setDuct({ U: v })} placeholder={`${duct.U}`} />
            <NumField id="duct-v" label="V" optional value={i.duct.V} onChange={(v) => setDuct({ V: v })} placeholder={`${duct.V}`} />
            <NumField id="duct-y" label="Y" optional value={i.duct.Y} onChange={(v) => setDuct({ Y: v })} placeholder={`${duct.Y}`} />
          </Overrides>
        </Section>
      )}

      {i.type === 'air' && (
        <Section title="Solar radiation">
          <Toggle id="solar" label="Cables exposed to sun" checked={i.air.solar} onChange={(solar) => setAir({ solar })} />
          {i.air.solar && (
            <>
              <NumField
                id="solar-h"
                label="Solar intensity H"
                unit="W/m²"
                value={i.air.H}
                onChange={(v) => setAir({ H: num(v) })}
              />
              <NumField
                id="solar-abs"
                label="Absorption coefficient σ"
                optional
                value={i.air.absorption}
                onChange={(v) => setAir({ absorption: v })}
                placeholder={`${JACKETS[cable.jacket.material].solarAbsorption}`}
              />
            </>
          )}
        </Section>
      )}
    </div>
  );
}
