# SPP Grounding Calculator

Grounding design and personnel-protection analysis for utility-scale photovoltaic solar power
plants, implementing **IEEE Std 2778-2020** (*Guide for Solar Power Plant Grounding for Personnel
Protection*) over the calculation core of **IEEE Std 80-2013**.

IEEE Std 2778 is a guide rather than a self-contained method: it defers to IEEE Std 80 for the
formulas and concentrates on where a solar plant departs from a substation. This app is built the
same way — an IEEE Std 80 engine, wrapped in the SPP-specific adaptations the guide calls for.

```bash
npm install
npm run dev      # development server
npm test         # 73 tests, validated against published IEEE Std 80 values
npm run build    # production bundle
```

No backend, no account, no network calls. The study lives in browser storage and exports to JSON.

## Why a solar plant is not a substation

A substation grid is dense (5–15 m spacing), small, and usually surfaced with crushed rock
throughout. A utility-scale SPP covers hundreds or thousands of acres with grid spacing above 100 m
and, in most of the plant, no surfacing at all. IEEE Std 2778, 4.1 notes that these two omissions
compound: no crushed rock lowers the tolerable voltages, and a sparse grid raises the actual ones.

The commercial stakes are the other half of the problem. Clause 4.2: the grounding system for a large
plant "can often reach into the millions of dollars in materials alone," and unlike a substation,
"even a small percentage of overdesign in a SPP can introduce significant cost." The point of an
accurate analysis is to avoid buying copper the physics does not require.

## What the app implements

### Tolerable voltages — IEEE Std 80-2013 Eq (27)–(33)

Step and touch limits for a 50 kg or 70 kg body, with the surface derating factor Cs, over native
soil or any of the surfacing materials in Table 7.

**Footwear and glove credit** (2778, 5.4.4) is applied by increasing the foot impedance, as the guide
directs, using the 1000–2000 Ω range it cites. The credit is **withheld automatically** outside the
plant fence and at the fence line, where a person may be a member of the public rather than qualified
personnel — and the un-credited limits are always reported alongside, so a reviewer can see how much
of the compliance case rests on PPE.

### Soil investigation — 2778, 5.1

- **Wenner traverse entry** with apparent resistivity ρa = 2πaR.
- **Two-layer inversion** by least squares over the Sunde/Tagg series, fitted with a coarse
  logarithmic sweep followed by Nelder–Mead refinement in log space. On synthetic data it recovers
  the generating model to four significant figures.
- **Short/long traverse combination** implementing the Table 1 methodology: upper layers from the
  short traverse that resolves them, bottom layer from the long traverse that reaches it, placed at
  the total depth the long traverse indicates.
- **Layered-to-uniform reduction**, because the IEEE Std 80 closed forms need a single ρ. Three
  documented methods are offered rather than one hidden assumption.

### Grid performance — IEEE Std 80-2013 Eq (52)–(94)

Sverak and Schwarz ground resistance, the full geometric factor set (n, na–nd, Km, Ks, Ki, Kii, Kh,
LM, LS), mesh voltage Em and step voltage Es, GPR, and the decrement factor Df from Eq (79).

### The SPP-specific corrections

Three things separate this from a generic IEEE Std 80 calculator:

**Auxiliary array grounding** (4.3, 5.4.2). Driven PV posts in solid soil contact act as short ground
rods. The app computes the post network's resistance *including mutual coupling* — which 5.4.2 warns
"can be a significant contributor" and must not be omitted — then inverts the rod formula to produce
the **equivalent rod length** for the hybrid modelling method. Posts that are coated or set in gravel
backfill are discounted. This matters commercially: the sensitivity studies cited in 5.4.2 found that
ignoring auxiliary grounding led to grid spacing three times as dense and **nine times the grounding
material**.

**Longitudinal I·R drop** (4.3, 5.4.1). This is the effect that invalidates hand calculations on a
plant this size — at SPP grid spacing "the resistance of the conductor from one portion of the plant
to another can greatly exceed the resistance to remote earth." The app models the current division at
the fault point: the local electrode and the run back to the main grid are two parallel paths to
remote earth, so `Irun = IG · Rlocal / (Rlocal + Rrun + Rrest)`. The resulting drop is added to the
mesh voltage to give the touch voltage actually seen at the equipment. Assuming the whole fault
current takes the run would be simpler and badly over-conservative.

**Regional analysis** (5.2.4, 5.4.2). A single worst-case fault does not characterise a large plant.
Each region carries its own soil model, fault current, X/R, clearing time, split factor and
surfacing; the app identifies which region governs. Split factors below 1.0 raise a warning, because
5.2.2 is explicit that the IEEE Std 80 Annex C curves are invalid inside an SPP — they neglect
grounding-conductor impedance between the fault and the line terminations, which "can reach several
ohms."

Also included: conductor thermal sizing per Eq (37) across all 14 materials of Table 1, fence touch
and transfer voltage per 4.4, a grid plan view, and a print-ready calculation record.

## Validation

`npm test` runs 73 tests. The engine is checked against published values, not just against itself:

| Reference | What is checked |
|---|---|
| Annex B.1 worked example | Lc, A, Cs, Rg, n, Km, Ki, Ks, Em, and B.1's own conclusion that the grid fails on touch but passes on step |
| Table 2 | Kf recovered from Eq (37) for **all 14 materials** — this exercises every constant in Table 1 |
| Table 10 | Decrement factor Df at seven (tf, X/R) combinations |
| Table 1 of IEEE Std 2778 | The sample soil model combination |

Two notes on Annex B.1, both verified rather than assumed:

- B.1 prints Estep70 = 2686.6 V and Etouch70 = 838.2 V. Those figures carry **Cs rounded to 0.74**
  through the rest of the calculation. Cs is exactly 0.742857…, so full precision gives 2696.1 V and
  840.5 V. The test asserts the exact values *and* demonstrates that substituting Cs = 0.74
  reproduces the standard's printed numbers, confirming the difference is rounding and not method.
- Eq (79) depends on tf and X/R only through the ratio Ta/tf, so cases sharing that ratio must agree
  exactly. That property is asserted directly, which pins the formula independently of a table
  lookup.

## Limitations — read before issuing results

**This is a screening and optimisation tool, not a final design.** IEEE Std 2778, 5.4.1 states
plainly that "the use of software is required for analysis of a utility-scale SPP." The IEEE Std 80
closed forms model the grounding system as a solid disk of uniform potential, an assumption that
weakens badly at SPP grid spacing.

The app does not hide this. It corrects for the largest known error (the longitudinal drop), credits
auxiliary grounding through the guide's own method, and flags every input outside the range the
closed forms were derived for. It does not replace a finite-element model of the plant, and the
guide's requirement for one stands. Nor does it cover the interconnection substation (design that to
IEEE Std 80), rooftop or small-scale systems, lightning protection, or dc-side grounding.

Sizing is thermal only; mechanical robustness and corrosion allowance usually govern the final
conductor choice, with 2/0 AWG copper the common minimum for a directly buried grid.

---

Not affiliated with or endorsed by the IEEE. Clause citations are provided so results can be traced
to the governing standard; obtain the standards themselves from the IEEE. Output records a
calculation and is not a professional engineering certification — review by a qualified engineer is
required before construction.
