# Ampacity Workbench

A web app that calculates the continuous current rating (ampacity) of power cables to
**IEC 60287**, from the values on a cable manufacturer's datasheet.

Phase 1 covers one three-phase circuit of **single-core cables without armour**: the usual
MV and HV XLPE land cable with a copper wire screen, a lead or aluminium sheath, or a
corrugated sheath.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine test suite
npm run build      # static site in dist/
```

Everything runs in the browser, with no server. Your inputs and your cable library are
kept in the browser's local storage. Use **Library → Copy JSON / Download JSON** to keep
a project file.

## What it calculates

| Step | Standard | Notes |
|---|---|---|
| Conductor AC resistance R, skin effect ys, proximity effect yp | IEC 60287-1-1 2.1 | ks, kp from Table 2 (2014 amendment values for Milliken conductors). A datasheet AC resistance can replace the calculation. |
| Dielectric losses Wd | IEC 60287-1-1 2.2 | Neglected below the Table 3 voltage threshold unless you force them on. |
| Screen / sheath losses λ1 = λ1′ + λ1″ | IEC 60287-1-1 2.3 | Trefoil and flat formation, transposed or not. Bonding: both ends, single point, or cross-bonded. Eddy currents per 2.3.6, with Ft for Milliken conductors bonded at both ends. |
| T1 insulation, T3 oversheath | IEC 60287-2-1 2.1 | Smooth sheath, wire screen and corrugated sheath. |
| T4 direct buried | IEC 60287-2-1 2.2.3 | Touching trefoil and flat use the closed formulas; spaced groups use superposition with image sources. |
| T4 in ducts (T4′ + T4″ + T4‴) | IEC 60287-2-1 2.2.7 | One cable per duct. T4′ is iterated on the mean air temperature in the duct. |
| T4 duct bank | IEC 60287-2-1 2.2.7.3 | Equivalent radius rb and the soil / concrete correction. |
| T4* free air, with or without sun | IEC 60287-2-1 2.2.1 | h = Z/De^g + E, iterated for Δθs. |
| Rating I | IEC 60287-1-1 1.4.1.1, 1.4.2.1, 1.4.3.1, 1.4.4 | Moist soil, partial drying-out (two-zone model, lower of the two ratings), drying-out avoided, solar radiation. |

The sheath temperature, the duct air temperature and the free-air surface temperature are
iterated until the rating converges. A separate forward calculation computes the conductor
temperature for any load current, with every property at its actual temperature.

For flat formation the three cables have different loss factors. The app uses the largest
one together with T4 of the hottest position, which is conservative.

## Entering a datasheet

- **Conductor**: diameter, maximum DC resistance at 20 °C, construction. If the datasheet
  gives the AC resistance at 90 °C, enter it under *Datasheet AC resistance*.
- **Layers**: conductor screen, insulation, insulation screen and tapes under the metallic
  screen, as thicknesses in mm. The built-up diameters are shown so you can compare them
  with the datasheet. You can also enter the datasheet overall diameter.
- **Metallic screen**: the cross-section in mm², or the screen resistance at 20 °C. For a
  corrugated sheath, also enter the diameter over the crests (Doc).
- Material constants (ρT, εr, tan δ, ks, kp, duct U/V/Y) default to the IEC tables. Any of
  them can be overridden.

## How it is checked

`tests/engine.test.ts` checks:

- each loss and thermal-resistance formula against an independent evaluation of the
  standard's equation;
- a full step-by-step hand calculation of one case;
- that the rated current gives exactly the maximum conductor temperature in the forward
  calculation, for every installation type, which compares two independent code paths;
- that the rating moves the right way with depth, soil resistivity, ambient temperature and
  bonding.

It has **not yet been compared against published benchmark cases** such as CIGRE TB 880
or the IEC TR 62095 examples. Add those cases as tests before relying on the results for
design work. The free-air constants (Z, E, g) and the plastic-duct U, V, Y values should
be confirmed against your copy of IEC 60287-2-1.

## Not covered yet

- Three-core cables, armour (λ2, T2), pipe-type cables
- More than one circuit, and other heat sources
- Cyclic and emergency ratings (IEC 60853)
- Finite-element calculation for non-standard geometries
- Exporting the report as PDF (the browser's print works when the app runs locally)

## Layout

```
src/engine/   IEC 60287 calculation engine (no UI dependencies)
src/ui/       React components
tests/        engine tests (Vitest)
scripts/      packs a single-file build for hosting
```
