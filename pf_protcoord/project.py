"""Load/save a coordination study from a simple JSON project file.

Lets users define relays, fuses, fault points and coordination pairs without
PowerFactory, and re-use the same definitions across CLI, UI and tests.
"""

from __future__ import annotations

import json
from dataclasses import asdict

from .devices import (CoordinationPair, FaultPoint, Fuse, ProtectiveDevice)


def _build_device(d: dict) -> ProtectiveDevice | Fuse:
    if d.get("type") == "fuse":
        return Fuse(
            name=d["name"],
            currents=d["currents"],
            clear_times=d["clear_times"],
            voltage_kv=d.get("voltage_kv"),
        )
    return ProtectiveDevice(
        name=d["name"],
        pickup_primary=d["pickup_primary"],
        time_dial=d.get("time_dial", 0.0),
        curve=d.get("curve", "IEC-SI"),
        ct_ratio=d.get("ct_ratio", 1.0),
        inst_pickup_primary=d.get("inst_pickup_primary"),
        inst_delay=d.get("inst_delay", 0.0),
        min_time=d.get("min_time", 0.0),
        voltage_kv=d.get("voltage_kv"),
    )


def load_project(path: str) -> dict:
    """Return a dict with keys: devices, faults, pairs, meta.

    ``devices`` maps name -> device object, ``pairs`` is a list of
    :class:`CoordinationPair`.
    """
    with open(path) as f:
        raw = json.load(f)

    devices: dict[str, ProtectiveDevice | Fuse] = {}
    for d in raw.get("devices", []):
        dev = _build_device(d)
        devices[dev.name] = dev

    faults: dict[str, FaultPoint] = {}
    for fp in raw.get("faults", []):
        faults[fp["location"]] = FaultPoint(
            location=fp["location"],
            current_primary=fp["current_primary"],
            label=fp.get("label", ""),
        )

    pairs: list[CoordinationPair] = []
    for p in raw.get("pairs", []):
        pairs.append(CoordinationPair(
            downstream=devices[p["downstream"]],
            upstream=devices[p["upstream"]],
            fault=faults[p["fault"]],
            required_cti=p.get("required_cti", 0.30),
            notes=p.get("notes", ""),
        ))

    return {
        "meta": raw.get("meta", {}),
        "devices": devices,
        "faults": faults,
        "pairs": pairs,
    }
