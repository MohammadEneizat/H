# Ampacity Workbench

A web app that calculates the continuous current rating (ampacity) of power cables to
**IEC 60287**, from the values on a cable manufacturer's datasheet.

It covers three-phase circuits of **single-core cables without armour**: the usual MV and
HV XLPE land cable with a copper wire screen, a lead or aluminium sheath, or a corrugated
sheath. Several circuits can share a trench, ducts or a duct bank, each with its own cable.

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

## Drawings and report

- **Cable cross-section**, drawn to scale from the layer thicknesses: individual conductor
  strands or Milliken segments, semiconducting screens, insulation, tapes, separate screen
  wires or the sheath (smooth or corrugated), and the oversheath. Numbered callouts match
  a layer key with the datasheet values.
- **Installation**: an overview to scale from the ground surface (depth dimension, duct
  bank, ducts) and a detail of the circuits, both with the **ground temperature field** at
  the rated current as a heat map with labelled isotherms and a °C scale. The field uses the
  same superposition model as the rating (line sources plus images; the duct bank adds the
  concrete correction inside the bank). It is for illustration: the rating itself uses the
  IEC formulas, which for touching groups differ slightly from pure superposition.
- **PDF report** (*Download PDF report* in the results): A4, with the rating and key
  figures, all circuits, the drawings with the temperature scale, all inputs (standard
  values marked), rating-sensitivity charts, the full calculation sheet with IEC clauses,
  warnings and assumptions, and the method. The report is built in the browser with
  [jsPDF](https://github.com/parallax/jsPDF) 2.5.1, loaded from cdnjs when you click, so it
  needs an internet connection. Text uses subsets of DejaVu Sans (`public/fonts`, Bitstream
  Vera licence) so Greek letters and symbols print correctly.

## Several circuits

The **Circuits** tab adds further circuits around the main circuit C1. Each has its own
cable, position, depth, formation, bonding and load. Cables in free air are always
calculated as a single circuit.

- **Heating between circuits** follows IEC 60287-2-1 2.2.3.1. Every cable dissipating
  W W/m raises the temperature of a cable p in another circuit by
  ρ/2π · W · ln(d′pk/dpk), where d′pk is the distance to the image of cable k above
  the ground. That rise is taken off cable p's permissible temperature rise, and the
  circuit's rating is the lowest of its three cables. Within each circuit the cables are
  handled as above, so a single circuit gives the same answer as before.
- **Duct bank**: the soil/concrete correction is applied with the total heat of all
  cables in the bank (the N·W term of 2.2.7.3, generalised to unequal loads).
- **Rated circuits** are either each loaded to their own temperature limit, or all carry
  one current set by the first to reach its limit.
- **Fixed circuits** carry a load you enter, and their temperature is calculated with
  every property at its actual temperature. A fixed circuit that runs above its limit is
  flagged.
- Soil drying-out models are only defined for a single circuit, so moist soil is used
  when there are several.

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
- a two-circuit case against superposition summed by hand over all six cables;
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
- Other heat sources (district heating pipes, etc.)
- Different duct sizes per circuit, and several cables in one duct
- Cyclic and emergency ratings (IEC 60853)
- Finite-element calculation for non-standard geometries

## Layout

```
src/engine/   IEC 60287 calculation engine and temperature field (no UI dependencies)
src/ui/       React components, drawings, heat map
src/report/   calculation-sheet tables and the PDF report
public/fonts/ font subsets embedded in the PDF
tests/        engine tests (Vitest)
scripts/      packs a single-file build for hosting
```
