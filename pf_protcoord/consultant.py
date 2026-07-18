"""The consultant engine: expert recommendations and review of settings.

This is the advisory brain of the toolkit. Instead of just computing pass/fail,
it reasons like a protection engineer: given your load and short-circuit data
(from PowerFactory short-circuit runs), it recommends overcurrent (ANSI 50/51)
settings with rationale, and reviews existing settings against accepted grading
practice, flagging sensitivity, security and selectivity problems.

The rules encoded here follow common industry practice (IEC 60255 / IEEE 242
"Buff Book" style grading):

  * Pickup must sit ABOVE maximum load (security against nuisance trips) and
    BELOW minimum fault current with margin (dependability / sensitivity).
  * Time-overcurrent grading uses a Coordination Time Interval (CTI), typically
    0.25-0.40 s for relay-to-relay, larger for relay-to-fuse.
  * Instantaneous (50) is set ABOVE the maximum through-fault (fault just beyond
    the next downstream device / on the downstream bus) so it does not reach
    into the downstream zone, and above transformer inrush where applicable.

Numbers produced here are engineering recommendations to review and enter into
PowerFactory — not a substitute for the engineer's judgement.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import IntEnum

from .curves import operating_time
from .devices import ProtectiveDevice


class Severity(IntEnum):
    INFO = 0
    ADVISORY = 1
    WARNING = 2
    CRITICAL = 3


_SEV_LABEL = {
    Severity.INFO: "INFO",
    Severity.ADVISORY: "ADVISORY",
    Severity.WARNING: "WARNING",
    Severity.CRITICAL: "CRITICAL",
}


@dataclass
class Finding:
    severity: Severity
    category: str          # e.g. "sensitivity", "security", "selectivity"
    message: str
    recommendation: str = ""

    def __str__(self) -> str:
        base = f"[{_SEV_LABEL[self.severity]}] ({self.category}) {self.message}"
        if self.recommendation:
            base += f"\n        → {self.recommendation}"
        return base


@dataclass
class SettingRecommendation:
    """A recommended overcurrent setting with the reasoning behind it."""

    pickup_primary: float | None
    curve: str
    time_dial: float | None
    inst_pickup_primary: float | None
    ct_ratio: float
    rationale: list[str] = field(default_factory=list)
    findings: list[Finding] = field(default_factory=list)

    @property
    def pickup_secondary(self) -> float | None:
        if self.pickup_primary is None or not self.ct_ratio:
            return self.pickup_primary
        return round(self.pickup_primary / self.ct_ratio, 3)


# ---------------------------------------------------------------------------
# Recommending settings from load + fault data
# ---------------------------------------------------------------------------

def recommend_oc_settings(
    *,
    max_load_current: float,
    min_fault_current: float,
    max_fault_current: float,
    downstream_max_fault: float | None = None,
    ct_ratio: float = 1.0,
    overload_factor: float = 1.25,
    sensitivity_factor: float = 1.5,
    curve: str = "IEC-SI",
    downstream_trip_time: float | None = None,
    required_cti: float = 0.30,
    transformer_inrush: float | None = None,
    inst_safety_factor: float = 1.25,
) -> SettingRecommendation:
    """Recommend 50/51 settings for one relay from its operating data.

    Parameters (all currents in PRIMARY amps unless noted)
    ------------------------------------------------------
    max_load_current : maximum continuous / emergency load through the CT.
    min_fault_current : minimum fault current the relay must still detect
        (typically the line-to-line fault at the far end of the protected zone).
    max_fault_current : maximum fault current at the relay location (bolted 3ph).
    downstream_max_fault : maximum fault just beyond the next downstream device
        (used to keep the instantaneous element out of the downstream zone).
    overload_factor : multiplier applied to load to set the pickup floor.
    sensitivity_factor : required ratio of min fault to pickup for dependable
        pickup (min_fault >= sensitivity_factor * pickup).
    downstream_trip_time : operate time of the downstream device at
        ``max_fault_current``; if given, a time dial is proposed to meet CTI.
    transformer_inrush : if the relay is over a transformer, its inrush current
        so the pickup/instantaneous can be checked against it.

    Returns a :class:`SettingRecommendation`.
    """
    rationale: list[str] = []
    findings: list[Finding] = []

    pickup_floor = overload_factor * max_load_current
    pickup_ceiling = min_fault_current / sensitivity_factor
    rationale.append(
        f"Pickup window: above {pickup_floor:,.0f} A "
        f"({overload_factor:g}× max load {max_load_current:,.0f} A) and below "
        f"{pickup_ceiling:,.0f} A (min fault {min_fault_current:,.0f} A ÷ "
        f"{sensitivity_factor:g} sensitivity margin)."
    )

    pickup: float | None
    if pickup_floor <= pickup_ceiling:
        # centre the pickup geometrically within the valid window
        pickup = round(math.sqrt(pickup_floor * pickup_ceiling), 1)
        rationale.append(f"Chose pickup ≈ {pickup:,.0f} A (geometric centre of the window).")
    else:
        pickup = round(pickup_floor, 1)
        findings.append(Finding(
            Severity.CRITICAL, "sensitivity",
            f"No valid pickup window: load floor {pickup_floor:,.0f} A exceeds "
            f"sensitivity ceiling {pickup_ceiling:,.0f} A. The relay cannot both "
            f"ride through load and reliably detect the minimum fault.",
            "Increase minimum fault current (check source/impedance), reduce the "
            "protected-zone length, add a dedicated sensitive earth-fault element, "
            "or accept reduced margin after review.",
        ))

    if transformer_inrush is not None and pickup is not None and pickup < 0.3 * transformer_inrush:
        findings.append(Finding(
            Severity.WARNING, "security",
            f"Pickup {pickup:,.0f} A may be low relative to transformer inrush "
            f"~{transformer_inrush:,.0f} A.",
            "Confirm the inverse curve rides through inrush (2nd-harmonic "
            "restraint preferred), or raise the pickup / use a slower curve.",
        ))

    # Time dial to meet CTI with the downstream device (linear scaling of curve)
    time_dial: float | None = None
    if downstream_trip_time is not None and pickup is not None:
        target = downstream_trip_time + required_cti
        t_at_td1 = operating_time(max_fault_current, pickup, 1.0, curve)
        if math.isfinite(t_at_td1) and t_at_td1 > 0:
            time_dial = round(target / t_at_td1, 3)
            rationale.append(
                f"Time dial {time_dial:g} sizes the {curve} curve to operate in "
                f"{target:.3f} s at {max_fault_current:,.0f} A "
                f"(downstream {downstream_trip_time:.3f} s + CTI {required_cti:.2f} s)."
            )
        else:
            findings.append(Finding(
                Severity.WARNING, "selectivity",
                "Could not size a time dial: relay does not pick up at the max "
                "fault current with the proposed pickup.",
            ))

    # Instantaneous (50)
    inst: float | None = None
    if downstream_max_fault is not None:
        inst = round(inst_safety_factor * downstream_max_fault, 1)
        rationale.append(
            f"Instantaneous (50) ≈ {inst:,.0f} A "
            f"({inst_safety_factor:g}× downstream max fault {downstream_max_fault:,.0f} A) "
            f"so it does not reach into the downstream zone."
        )
        if inst >= max_fault_current:
            findings.append(Finding(
                Severity.ADVISORY, "coverage",
                f"Instantaneous pickup {inst:,.0f} A is at/above the local max "
                f"fault {max_fault_current:,.0f} A — the 50 element will rarely "
                f"or never operate here.",
                "This is acceptable when downstream coordination dominates; "
                "otherwise omit the instantaneous element at this location.",
            ))
        if transformer_inrush is not None and inst < 1.25 * transformer_inrush:
            findings.append(Finding(
                Severity.WARNING, "security",
                f"Instantaneous {inst:,.0f} A is below 1.25× inrush "
                f"{transformer_inrush:,.0f} A and may trip on energisation.",
                "Raise the instantaneous pickup above inrush or add a short delay.",
            ))

    return SettingRecommendation(
        pickup_primary=pickup,
        curve=curve,
        time_dial=time_dial,
        inst_pickup_primary=inst,
        ct_ratio=ct_ratio,
        rationale=rationale,
        findings=findings,
    )


# ---------------------------------------------------------------------------
# Reviewing an existing device against its operating context
# ---------------------------------------------------------------------------

@dataclass
class DeviceContext:
    """Operating data around a device, used to review its settings."""

    max_load_current: float
    min_fault_current: float
    max_fault_current: float
    downstream_max_fault: float | None = None
    overload_factor: float = 1.25
    sensitivity_factor: float = 1.5
    equipment_damage_time: float | None = None   # thermal withstand at max fault (s)


def review_device(dev: ProtectiveDevice, ctx: DeviceContext) -> list[Finding]:
    """Review one relay's settings against accepted grading practice."""
    findings: list[Finding] = []
    p = dev.pickup_primary

    # Security: pickup vs load
    floor = ctx.overload_factor * ctx.max_load_current
    if p < ctx.max_load_current:
        findings.append(Finding(
            Severity.CRITICAL, "security",
            f"'{dev.name}' pickup {p:,.0f} A is below maximum load "
            f"{ctx.max_load_current:,.0f} A — it will nuisance-trip on normal load.",
            f"Raise pickup above {floor:,.0f} A ({ctx.overload_factor:g}× load).",
        ))
    elif p < floor:
        findings.append(Finding(
            Severity.WARNING, "security",
            f"'{dev.name}' pickup {p:,.0f} A gives little margin over load "
            f"(<{ctx.overload_factor:g}× {ctx.max_load_current:,.0f} A = {floor:,.0f} A).",
            f"Consider raising pickup toward {floor:,.0f} A to avoid trips on overload/inrush.",
        ))

    # Sensitivity: pickup vs minimum fault
    ceiling = ctx.min_fault_current / ctx.sensitivity_factor
    if p > ctx.min_fault_current:
        findings.append(Finding(
            Severity.CRITICAL, "sensitivity",
            f"'{dev.name}' pickup {p:,.0f} A exceeds the minimum fault "
            f"{ctx.min_fault_current:,.0f} A — it may fail to detect end-of-zone faults.",
            f"Lower pickup below {ceiling:,.0f} A, or add a sensitive earth-fault element.",
        ))
    elif p > ceiling:
        findings.append(Finding(
            Severity.WARNING, "sensitivity",
            f"'{dev.name}' pickup {p:,.0f} A has thin sensitivity margin: only "
            f"{ctx.min_fault_current / p:.2f}× the minimum fault (want ≥ "
            f"{ctx.sensitivity_factor:g}×).",
            f"Lower pickup toward {ceiling:,.0f} A for dependable minimum-fault pickup.",
        ))

    # Selectivity: instantaneous reaching into downstream zone
    if dev.inst_pickup_primary is not None and ctx.downstream_max_fault is not None:
        if dev.inst_pickup_primary < ctx.downstream_max_fault:
            findings.append(Finding(
                Severity.CRITICAL, "selectivity",
                f"'{dev.name}' instantaneous {dev.inst_pickup_primary:,.0f} A is "
                f"below the downstream max fault {ctx.downstream_max_fault:,.0f} A — "
                f"it will trip instantaneously for faults in the downstream zone.",
                f"Raise the instantaneous pickup above "
                f"{1.25 * ctx.downstream_max_fault:,.0f} A (1.25× downstream fault).",
            ))

    # Equipment protection: operate time vs thermal withstand
    if ctx.equipment_damage_time is not None:
        t_op = dev.trip_time(ctx.max_fault_current)
        if math.isfinite(t_op) and t_op > ctx.equipment_damage_time:
            findings.append(Finding(
                Severity.WARNING, "equipment",
                f"'{dev.name}' clears the max fault in {t_op:.3f} s, slower than the "
                f"equipment withstand {ctx.equipment_damage_time:.3f} s.",
                "Reduce time dial / use a more inverse curve so clearing stays under "
                "the damage curve, or add an instantaneous element.",
            ))

    if not findings:
        findings.append(Finding(
            Severity.INFO, "review",
            f"'{dev.name}' settings look consistent with load and fault data.",
        ))
    return findings
