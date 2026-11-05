# Ampacity Workbench

A web app that calculates the continuous current rating (ampacity) of power cables to
**IEC 60287**, from the values on a cable manufacturer's datasheet.

It covers three-phase circuits of **single-core cables without armour** (the usual MV and
HV XLPE land cable with a copper wire screen, a lead or aluminium sheath, a corrugated
sheath, or no metallic screen at all) and **three-core cables without screen or armour**,
such as the LV cables NYY, NAYY, N2XY and NA2XY, and **DC circuits** of two single-core
cables (+ and −), such as PV string and main DC cables. Several circuits can share a trench,
ducts, a duct bank or one conduit, each with its own cable. A trench section can be imported
from a **DXF** drawing.

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

To edit the drawing, click **✎ Edit drawing** (next to the installation drawing or the PDF
button), click the installation drawing itself, or choose **✎ Draw your own cross-section**
as the installation method. Direct buried cables, ducts and duct banks open as they are
(uniform soil, the duct bank as a concrete rectangle), so the rating does not change until
you edit something. The **Cross-section** panel opens at the top of the results, with the
IEC and numerical ratings above the drawing (on a phone, use *Go to the drawing* or *See
drawing* in the bar at the top). Start from what you had, from a template or from scratch,
then add, move, resize and reorder objects:

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
hard to reach. Labels and the temperature field can be switched off. If a change makes the
layout impossible to rate (two circuits overlapping, a cable above the ground, a heat
source touching a cable), the drawing stays on screen with the problem and an *Undo last
change* button above it.

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

## Three-core cables

Choose **Three-core** under *Cable type*. One three-core cable carries one circuit. The
conductors can be sector-shaped (SE, SM) or round (RE, RM); for sector-shaped ones the
conductor diameter is the diameter of a round conductor with the same area and compaction
(dx). Enter the core insulation, the inner covering (extruded filler) and the oversheath;
if the inner covering is left empty it is worked out from the datasheet overall diameter.

- **T1** between one conductor and the oversheath follows IEC 60287-2-1 4.1.2.2:
  G = 3·F2·ln(da/2r1), F2 = 1 + 3t/[2π(dx + t) − t] for sector-shaped conductors, where r1
  is the radius of the circle around the conductors (worked out from the area, or entered)
  and da the diameter over the filler. For round conductors Equation 1 with the filler term
  is used; its G (Figure 3 of the standard) is approximated with the sector formula, and a
  warning says so.
- **Proximity effect** with s = dc + t, two-thirds of the round-conductor value for sector
  conductors (IEC 60287-1-1 2.1.4).
- The rating equation uses **n = 3**, λ1 = λ2 = 0 and T2 = 0. T3 and T4 carry the heat of all
  three cores.

The library has two examples with typical NA2XY values (3×240 SM three-core, and
1×240 RM single-core without screen). Replace them with your datasheet.

## DC cables

Under *Cable → Used in*, choose **DC (+ and −)**. A DC circuit is two single-core cables, side
by side or one above the other, touching or spaced. The rating follows IEC 60287-1-1 1.4.1.2
(DC cables up to 5 kV): I = √[Δθ / (R′·(T1 + n·T2 + n·(T3 + T4)))] with R′ the DC resistance at
the maximum temperature; there are no skin, proximity, dielectric or screen losses. T4 of the
pair, and the heating between circuits, use superposition with image sources. AC and DC
circuits can lie in the same trench, each with its own cable.

The Library has the **Prysmian TECSUN (PV) H1Z2Z2-K** range (1×4 to 1×400 mm²) from the
datasheet of 2024-11-19: conductor and cable diameters (mean of minimum and maximum) and DC
resistance are the datasheet values; the insulation thickness is the usual 0.6/1 kV value for
the size and the EVA sheath the rest of the wall (ρ 5.0 K·m/W assumed, not in IEC Table 1).
The datasheet's current ratings (EN 50618, single cable in air at 60 °C ambient and 120 °C)
are not used.

Many circuits close together, such as tens of PV string pairs in one trench, are solved
directly: with λ1, T4′ and the governing cable fixed, each circuit's temperature limit is
linear in the squares of all currents, so each step solves that linear system. Both rating
modes are exact at convergence: every circuit at its own limit, or one current with the
hottest circuit at its limit.

## DXF import

In the cross-section editor, **Import DXF…** reads an ASCII DXF drawing of the trench section
(DWG must be saved as DXF first). It reads lines, polylines (with arcs), arcs, circles,
ellipses, splines, text and blocks; hatches and dimensions are skipped.

- **Regions**: closed areas are found from all the lines together, whether drawn as closed
  polylines or as separate lines that meet or cross (a trench outline with a line across it
  for the top of the bedding gives two regions). Each becomes a fill shape, larger ones first
  so smaller ones lie on top. The material comes from a label inside the region (sand, CBS,
  concrete, bentonite, gravel, asphalt, topsoil, backfill…, with a resistivity if the label
  gives one in K·m/W), otherwise sand where it holds cables and native soil elsewhere. The
  frame of the drawing is left out.
- **Circles**: concentric circles of similar size are one object. Circles up to the cable size
  you set are cables, larger ones conduits (up to 600 mm) or bores. Cables are grouped into
  circuits as the Cable tab says: three single-core (AC), two (DC) or one three-core cable;
  cables inside a conduit become circuits in that conduit; single cables each in their own duct
  become a circuit in ducts. Formation, spacing and touching are read from the positions.
- **Placement**: the units come from the file header (or the size of the drawing), the ground
  surface is the highest line, and x = 0 is the middle of the drawing; all three can be changed
  in the import panel, which shows a preview and lets you change each region's material.
- The drawing stays visible underneath as thin lines (switch *DXF drawing* off, or remove it).

The editor has a sample (a PV trench with four DC pairs and a spare DN160 conduit) to try.

## Shared conduits

In the cross-section editor, **Add → Conduit** places a pipe (DN160, PE 160/141 mm by default)
that can hold several circuits. Choose *Placement: In DN160* on each circuit, or switch the
circuits on in the conduit's panel. The cables are drawn lying along the bottom of the pipe;
dragging the conduit moves them with it.

The circuits in one conduit are rated together, after IEC 60287-2-1 4.2.7:
- T4′ (air in the conduit) uses the equivalent diameter of the group of cables: two cables
  1.65·De, three 2.15·De, four 2.5·De. A single-core circuit counts as three cables, a
  three-core cable as one. More than four cables are extrapolated (with a warning).
- The mean air temperature θm, the conduit wall T4″ and the ground T4‴ carry the heat of
  every cable in the conduit; each circuit's permissible rise is reduced by the heat of the
  others crossing the same air gap, wall and ground.
- In the numerical model the conduit is one body holding the heat of all its cables.

The template **LV: two circuits in one DN160 conduit, 2 m deep** sets this up: load the NA2XY
3×240 cable from the Library first.

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

- Armour (λ2, T2), three-core cables with metallic screens, pipe-type cables
- DXF: hatches, dimensions and binary DXF are not read; DWG is not supported
- Round three-core conductors use an approximation of IEC Figure 3 for G
- Soil drying-out in the numerical model, and longitudinal heat flow at short crossings
- Cyclic and emergency ratings (IEC 60853)
- Finite-element calculation for non-standard geometries

## Layout

```
src/engine/   IEC 60287 engine, cross-section model, numerical ground model (no UI dependencies)
src/ui/       React components, drawings, heat map
src/report/   calculation-sheet tables and the PDF report
public/fonts/ font subsets embedded in the PDF
tests/        engine tests (Vitest): IEC formulas, numerical model, three-core and DC cables, conduits, DXF
src/samples/  sample DXF drawing
scripts/      packs a single-file build for hosting
```
