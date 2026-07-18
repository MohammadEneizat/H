"""Protective device models used in a coordination study.

A :class:`ProtectiveDevice` bundles the settings of a single relay element
(ANSI 51 time-overcurrent + optional 50 instantaneous) together with its CT
ratio so that operating times can be evaluated against a fault current
expressed in primary amps.

Fuses are modelled by their published minimum-melt / total-clear time-current
points and interpolated in log-log space.
"""

from __future__ import annotations

import bisect
import math
from dataclasses import dataclass, field

from .curves import operating_time


@dataclass
class ProtectiveDevice:
    """A relay time-overcurrent element with optional instantaneous stage.

    Attributes
    ----------
    name : label shown on plots/reports (e.g. "Feeder 51").
    pickup_primary : ANSI 51 pickup in primary amps.
    time_dial : TMS/TDS multiplier.
    curve : characteristic key (see :mod:`pf_protcoord.curves`).
    ct_ratio : CT ratio as (primary/secondary), e.g. 600/5 -> 120.0.
        Kept for reporting secondary settings; time math uses primary amps.
    inst_pickup_primary : ANSI 50 instantaneous pickup (primary amps) or None.
    inst_delay : definite time delay applied to the 50 element (seconds).
    min_time : optional minimum operate time floor for the 51 element.
    voltage_kv : nominal voltage of the location (for current base shifting).
    """

    name: str
    pickup_primary: float
    time_dial: float
    curve: str = "IEC-SI"
    ct_ratio: float = 1.0
    inst_pickup_primary: float | None = None
    inst_delay: float = 0.0
    min_time: float = 0.0
    voltage_kv: float | None = None

    def trip_time(self, fault_primary: float) -> float:
        """Total time to trip for a fault of ``fault_primary`` amps.

        Takes the faster of the instantaneous (50) and time-overcurrent (51)
        elements, mirroring how a real relay races its stages.
        """
        t51 = operating_time(
            fault_primary,
            self.pickup_primary,
            self.time_dial,
            self.curve,
            min_time=self.min_time,
        )
        if self.inst_pickup_primary is not None and fault_primary >= self.inst_pickup_primary:
            t50 = self.inst_delay
            return min(t51, t50)
        return t51

    @property
    def pickup_secondary(self) -> float:
        """Pickup referred to the CT secondary (for entering into the relay)."""
        return self.pickup_primary / self.ct_ratio if self.ct_ratio else self.pickup_primary


@dataclass
class Fuse:
    """A fuse defined by time-current points (interpolated log-log)."""

    name: str
    currents: list[float]          # primary amps, ascending
    clear_times: list[float]       # total clear time (s) at each current
    voltage_kv: float | None = None

    def trip_time(self, fault_primary: float) -> float:
        cs, ts = self.currents, self.clear_times
        if fault_primary <= cs[0]:
            return math.inf
        if fault_primary >= cs[-1]:
            return ts[-1]
        i = bisect.bisect_right(cs, fault_primary)
        x0, x1 = math.log10(cs[i - 1]), math.log10(cs[i])
        y0, y1 = math.log10(ts[i - 1]), math.log10(ts[i])
        x = math.log10(fault_primary)
        y = y0 + (y1 - y0) * (x - x0) / (x1 - x0)
        return 10 ** y


@dataclass
class FaultPoint:
    """A short-circuit result at a location used for coordination checks."""

    location: str
    current_primary: float          # e.g. max 3-phase fault at the bus
    label: str = ""


@dataclass
class CoordinationPair:
    """An upstream device that must back up a downstream device."""

    downstream: ProtectiveDevice | Fuse
    upstream: ProtectiveDevice | Fuse
    fault: FaultPoint
    required_cti: float = 0.30      # seconds; typical 0.25-0.40 for relays
    notes: str = ""
    extras: dict = field(default_factory=dict)
