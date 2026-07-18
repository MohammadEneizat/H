"""Import your own relay curves and settings.

Two things you can bring in:

1. **A characteristic (curve)** — a table of operate time vs. multiple of
   pickup at time-dial = 1, from a manufacturer datasheet or a PowerFactory
   characteristic export. Once imported it behaves exactly like a built-in
   curve: it scales with the time dial and works in recommend / review /
   coordination.

   Accepted CSV columns (header row, case-insensitive; separators , ; or tab):
     * ``multiple`` (or ``m``, ``ratio``, ``i/is``, ``x pickup``) and
       ``time`` (or ``t``, ``seconds``, ``sec``)              -> used directly
     * ``current`` (or ``i``, ``amps``) and ``time`` + a ``pickup`` argument
       -> converted to multiples via M = current / pickup

2. **Relay settings** — a table of relays plus their operating context, so the
   consultant can review each and recommend fixes in one pass.

     name,pickup_primary,time_dial,curve,ct_ratio,inst_pickup_primary,
     max_load_current,min_fault_current,max_fault_current,downstream_max_fault
"""

from __future__ import annotations

import csv
import io
import json

from .consultant import DeviceContext
from .curves import register_custom_curve
from .devices import ProtectiveDevice

_MULT_KEYS = {"multiple", "multiples", "m", "ratio", "i/is", "x pickup", "xpickup", "mult"}
_TIME_KEYS = {"time", "t", "seconds", "sec", "s", "operate", "operate_time"}
_CURR_KEYS = {"current", "currents", "i", "amps", "a", "primary"}


def _sniff_rows(text: str) -> list[dict]:
    """Parse delimited text (,/;/tab) with a header row into dict rows."""
    sample = text[:2048]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    rows = []
    for raw in reader:
        rows.append({(k or "").strip().lower(): (v.strip() if v else "")
                     for k, v in raw.items()})
    return rows


def _find_key(row: dict, options: set[str]) -> str | None:
    for k in row:
        if k in options:
            return k
    return None


def import_curve_from_csv(path: str, name: str | None = None,
                          pickup: float | None = None) -> str:
    """Import a characteristic from a CSV file and register it.

    Returns the registered curve name (use it anywhere a curve key is expected).
    """
    with open(path) as f:
        text = f.read()
    return import_curve_from_text(text, name=name or _stem(path), pickup=pickup)


def import_curve_from_text(text: str, name: str, pickup: float | None = None) -> str:
    rows = _sniff_rows(text)
    if not rows:
        raise ValueError("no data rows found in curve file")

    mkey = _find_key(rows[0], _MULT_KEYS)
    tkey = _find_key(rows[0], _TIME_KEYS)
    ckey = _find_key(rows[0], _CURR_KEYS)
    if tkey is None:
        raise ValueError(f"could not find a time column; headers were {list(rows[0])}")

    multiples: list[float] = []
    times: list[float] = []
    for r in rows:
        try:
            t = float(r[tkey])
            if mkey is not None and r.get(mkey):
                m = float(r[mkey])
            elif ckey is not None and r.get(ckey):
                if pickup is None:
                    raise ValueError("current column present but no pickup given "
                                     "to convert current -> multiple")
                m = float(r[ckey]) / pickup
            else:
                continue
        except (ValueError, KeyError):
            continue
        multiples.append(m)
        times.append(t)

    if len(multiples) < 2:
        raise ValueError("need at least two valid (multiple/current, time) points")
    return register_custom_curve(name, multiples, times)


def import_curve_from_json(path: str) -> str:
    """Import a curve from JSON: {name, multiples:[...], times:[...]} or
    {name, pickup, currents:[...], times:[...]}."""
    with open(path) as f:
        data = json.load(f)
    name = data.get("name") or _stem(path)
    if "multiples" in data:
        return register_custom_curve(name, data["multiples"], data["times"])
    if "currents" in data:
        pickup = data["pickup"]
        mult = [c / pickup for c in data["currents"]]
        return register_custom_curve(name, mult, data["times"])
    raise ValueError("JSON curve needs 'multiples' or 'currents'+'pickup'")


def import_relays_from_csv(path: str) -> list[tuple[ProtectiveDevice, DeviceContext]]:
    """Import a table of relays + operating context for batch review.

    Returns a list of (device, context) pairs ready for
    :func:`pf_protcoord.review_device`.
    """
    with open(path) as f:
        rows = _sniff_rows(f.read())

    out: list[tuple[ProtectiveDevice, DeviceContext]] = []
    for r in rows:
        if not r.get("name"):
            continue
        dev = ProtectiveDevice(
            name=r["name"],
            pickup_primary=float(r["pickup_primary"]),
            time_dial=float(r.get("time_dial") or 0.0),
            curve=r.get("curve") or "IEC-SI",
            ct_ratio=float(r.get("ct_ratio") or 1.0),
            inst_pickup_primary=float(r["inst_pickup_primary"])
            if r.get("inst_pickup_primary") else None,
        )
        ctx = DeviceContext(
            max_load_current=float(r["max_load_current"]),
            min_fault_current=float(r["min_fault_current"]),
            max_fault_current=float(r["max_fault_current"]),
            downstream_max_fault=float(r["downstream_max_fault"])
            if r.get("downstream_max_fault") else None,
        )
        out.append((dev, ctx))
    return out


def _stem(path: str) -> str:
    import os
    return os.path.splitext(os.path.basename(path))[0] or "custom"
