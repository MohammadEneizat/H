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

## Cross-section builder

Choose **Trench layout** as the installation method to build the cross-section in a
drag-and-drop editor next to the results. Start from a template or from scratch, then add,
move, resize and reorder objects:

- **Ground layers** from the surface down (topsoil, clay, sand…), each with its own
  thermal resistivity. The bottom layer continues downwards. Drag a boundary to change a
  layer's thickness. The ground surface can be grass, paving or road.
- **Shapes**, each filled with a material of its own resistivity:
  - **Trench**: width at the bottom and at the surface (sloped walls), depth and position,
    filled in horizontal **bands** (sand bedding, cement-bound sand, excavated soil…) from
    the bottom up;
  - **Rectangle** (a concrete encasement, a duct bank, a subbase);
  - **Circle** (a bentonite-filled drilled bore);
  - **Polygon** with corners you drag, add (click a mid-point handle) or type, for any
    other outline.

  Shapes are stacked in order: a later shape lies on top of an earlier one where they
  overlap. **Bring forward / Send backward** changes the order.
- **Cover tiles** (polymer or concrete) and **warning tape**. The tape is drawn only; it
  has no thermal effect.
- **Circuits**: drag them into place, or type exact positions. Each circuit has its own
  formation, which can also be turned (**flat vertical**, or **trefoil point down**), and
  can lie directly in the ground or in **ducts of its own size and material**.
- **Heat sources**: district heating pipes, a parallel cable or any other buried pipe,
  as a diameter and a heat output in W/m. They heat every circuit in both rating methods.
- **Templates**: MV trench with two circuits in sand, HV trench with CBS backfill, road
  crossing with ducts in concrete, a 6 m deep drilled crossing (HDD), and a trench next to
  district heating pipes.

Editing: undo and redo (Ctrl+Z, Ctrl+Y, also for every other input), duplicate (Ctrl+D),
delete, arrow keys to nudge, snapping to 10, 50 or 100 mm or off, zoom (buttons or
Ctrl + wheel), pan by dragging the ground, and an object list to select anything that is
hard to reach. Labels and the temperature field can be switched off.

Material resistivities default to typical values (concrete and PE from IEC 60287-2-1
Table 1, the rest are typical design values). Replace them with measured site values.

Every layout is rated in two ways, shown side by side:

1. **IEC 60287**: the shape that holds the whole main circuit becomes a rectangular
   backfill zone (IEC 60287-2-1 2.2.7.3, the duct-bank method) in the native layer at
   cable depth: a trench band or rectangle as it is, a circle as the square of equal
   thermal effect, a polygon as its bounding box. Other layers, tiles, sloped walls and
   other shapes are not part of this method; if no shape holds the whole circuit, uniform
   ground is used and a note says so. Other circuits and heat sources are added by
   superposition (IEC 60287-2-1 2.2.3.1).
2. **Numerical 2D ground model** (`src/engine/numeric.ts`): a finite-volume model of the
   whole cross-section on a non-uniform grid, solved with conjugate gradients and an
   incomplete-Cholesky preconditioner (see IEC TR 62095 for numerical methods). Cables and
   ducts are highly conducting bodies; the ground surface and far boundaries are at
   ambient. One solve per cable and heat source gives an influence matrix (rise at each
   cable per W/m in each cable or source). The grid and boundary error is removed by comparing a reference solve in
   uniform ground with the exact image solution. Cable losses, internal thermal
   resistances and the duct air gap still follow IEC 60287. The model runs in a Web
   Worker shortly after each change, and its temperature field is drawn in the editor.

Checks in `tests/numeric.test.ts`:
- a single cable in uniform ground matches the exact solution;
- a rectangular backfill is within 4 % of the IEC formula;
- touching cables are within 3 % of the IEC touching-group formula;
- results converge as the grid is refined;
- every template is within 5 % of the IEC method;
- older trench files are converted to shapes, and each shape type maps to the IEC
  backfill zone as described above;
- turned formations, per-circuit ducts and heat sources give the expected positions and
  temperature rises (a heat source is checked against the closed-form image formula).

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
- Several cables in one duct
- Soil drying-out in the numerical model, and longitudinal heat flow at short crossings
- Cyclic and emergency ratings (IEC 60853)
- Finite-element calculation for non-standard geometries

## Layout

```
src/engine/   IEC 60287 engine, cross-section model, numerical ground model (no UI dependencies)
src/ui/       React components, drawings, heat map
src/report/   calculation-sheet tables and the PDF report
public/fonts/ font subsets embedded in the PDF
tests/        engine tests (Vitest)
scripts/      packs a single-file build for hosting
```
