# ⚡ pf-protcoord — Protection Coordination Consultant for PowerFactory

A protection-engineering **consultant in an app**. You do your load flow and
short-circuit runs in DIgSILENT PowerFactory; this tool takes those numbers and
reasons about them like a senior relay engineer — it **recommends** overcurrent
(ANSI 50/51) settings with rationale, **reviews** existing settings for
sensitivity / security / selectivity problems, checks **CTI grading** between
devices, and produces a **study report** and **time-current curve (TCC) plot**.

It is deliberately *not* a PowerFactory API bridge. You stay in control of your
model; the app advises you on what to enter and why.

---

## What it does

| Capability | Description |
|---|---|
| **Recommend settings** | From max load, min/max fault, and downstream fault currents, it proposes a 51 pickup, curve, time dial and 50 instantaneous — each with a written rationale. |
| **Review settings** | Flags pickup below load (nuisance trips), pickup above min fault (blind spots), instantaneous reaching into a downstream zone (loss of selectivity), and clearing slower than equipment withstand. |
| **Coordination check** | Computes downstream/upstream operate times at each fault point and verifies the Coordination Time Interval (CTI). |
| **Time-dial optimiser** | Suggests an upstream time dial that just meets the CTI. |
| **TCC plotting** | Log-log curves with fault markers and instantaneous drops. |
| **Standard curves** | IEC 60255 (SI/VI/EI/LTI) and IEEE C37.112 (MI/VI/EI + US CO). |

## Engineering rules it applies

- **Pickup window:** `1.25 × max load  ≤  pickup  ≤  min fault ÷ 1.5`
  (security against load above, dependable minimum-fault detection below). Both
  factors are configurable.
- **Grading:** downstream must clear at least one **CTI** (default 0.30 s)
  before its upstream backup, at every fault point.
- **Instantaneous:** set `≥ 1.25 ×` the maximum fault just beyond the next
  downstream device, and above transformer inrush, so it stays out of the
  downstream zone.

These follow common IEC 60255 / IEEE 242 ("Buff Book") style practice. Outputs
are engineering recommendations to review and enter into PowerFactory — not a
replacement for your judgement.

---

## Install

```bash
pip install -r requirements.txt   # matplotlib + streamlit + pandas + pytest
```
The core library (`pf_protcoord/curves.py`, `consultant.py`, `coordination.py`)
is pure standard-library Python; the extras are only for plots, the UI and tests.

## Use it

### Streamlit app (the consultant UI)
```bash
streamlit run app.py
```
Tabs: **Recommend** settings for a relay, **Review** a study (CTI + TCC), and
explore **Curves**.

### Command line
```bash
# Review coordination of a study
python -m pf_protcoord.cli review examples/example_feeder.json

# Recommend settings for one relay from its operating data
python -m pf_protcoord.cli recommend --name "Feeder 51" \
    --load 400 --min-fault 3600 --max-fault 6500 \
    --downstream-fault 3600 --downstream-time 0.20 --ct 120 --curve IEC-SI

# Render a TCC plot to PNG
python -m pf_protcoord.cli plot examples/example_feeder.json -o tcc.png

# List built-in curves
python -m pf_protcoord.cli curves
```

### As a library
```python
from pf_protcoord import recommend_oc_settings, review_device, DeviceContext, ProtectiveDevice

rec = recommend_oc_settings(
    max_load_current=400, min_fault_current=3600, max_fault_current=6500,
    downstream_max_fault=3600, downstream_trip_time=0.20, ct_ratio=120, curve="IEC-SI",
)
print(rec.pickup_primary, rec.time_dial, rec.inst_pickup_primary)
for f in rec.findings:
    print(f)

dev = ProtectiveDevice("Feeder 51", pickup_primary=720, time_dial=0.2, curve="IEC-SI",
                       ct_ratio=120, inst_pickup_primary=9000)
ctx = DeviceContext(max_load_current=400, min_fault_current=3600,
                    max_fault_current=6500, downstream_max_fault=3600)
for finding in review_device(dev, ctx):
    print(finding)
```

## Study file format

A study is a JSON file (see [`examples/example_feeder.json`](examples/example_feeder.json))
with `devices`, `faults` and `pairs`. Fault currents are the **primary** values
you read from your PowerFactory `ComShc` short-circuit run at each bus.

## Workflow with PowerFactory

1. In PowerFactory, run load flow → note maximum load current at each relay CT.
2. Run short-circuit (`ComShc`) → note max/min fault at each bus and just beyond
   each downstream device.
3. Feed those into **Recommend** (per relay) or a study JSON.
4. Enter the recommended pickup / curve / time dial / instantaneous into your
   `ElmRelay` objects, then re-run to confirm.
5. Use **Review** to sanity-check the grading and generate the report.

## Tests
```bash
python -m pytest -q
```

## Project layout
```
pf_protcoord/
  curves.py         # IEC/IEEE standard characteristics + operate-time math
  devices.py        # ProtectiveDevice, Fuse, FaultPoint, CoordinationPair
  consultant.py     # recommend_oc_settings, review_device  (the advisory brain)
  coordination.py   # CTI checking + time-dial optimiser
  plotting.py       # TCC log-log plots
  report.py         # text / markdown reports
  project.py        # load a study from JSON
  cli.py            # command-line interface
app.py              # Streamlit consultant UI
examples/           # worked example feeder
tests/              # pytest suite
```

## Roadmap ideas
- Earth-fault (50N/51N) recommendations and residual/sensitive elements.
- Fuse-to-relay and fuse-to-fuse coordination checks.
- Import fault tables directly from PowerFactory result exports (CSV/XML).
- Arc-flash incident-energy estimate from clearing time.
- Distance (21) and differential (87) advisory checks.
