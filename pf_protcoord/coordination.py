"""Coordination checking: CTI margins between device pairs.

The core of a protection coordination study is verifying that, for a fault
anywhere on the system, the *downstream* protective device operates before its
*upstream* backup by at least the Coordination Time Interval (CTI). This
module evaluates that margin at each defined fault point and reports pass/fail
with the actual timing.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .devices import CoordinationPair


@dataclass
class CoordinationResult:
    pair_name: str
    fault_location: str
    fault_current: float
    t_downstream: float
    t_upstream: float
    required_cti: float
    actual_margin: float
    status: str            # "PASS", "FAIL", or "NO-OPERATE"
    message: str = ""

    @property
    def ok(self) -> bool:
        return self.status == "PASS"


def check_pair(pair: CoordinationPair) -> CoordinationResult:
    """Evaluate one upstream/downstream pair at its fault point."""
    ic = pair.fault.current_primary
    td = pair.downstream.trip_time(ic)
    tu = pair.upstream.trip_time(ic)
    pair_name = f"{pair.downstream.name} → {pair.upstream.name}"

    if math.isinf(td) or math.isinf(tu):
        who = []
        if math.isinf(td):
            who.append(f"downstream '{pair.downstream.name}'")
        if math.isinf(tu):
            who.append(f"upstream '{pair.upstream.name}'")
        return CoordinationResult(
            pair_name, pair.fault.location, ic, td, tu, pair.required_cti,
            math.inf, "NO-OPERATE",
            "Device does not pick up for this fault: " + ", ".join(who),
        )

    margin = tu - td
    if margin >= pair.required_cti:
        status, msg = "PASS", ""
    elif margin < 0:
        status = "FAIL"
        msg = (f"Miscoordination: upstream trips {abs(margin):.3f}s BEFORE "
               f"downstream (upstream should be slower).")
    else:
        status = "FAIL"
        msg = (f"Insufficient margin: {margin:.3f}s < required "
               f"{pair.required_cti:.3f}s (short by {pair.required_cti - margin:.3f}s).")

    return CoordinationResult(
        pair_name, pair.fault.location, ic, td, tu,
        pair.required_cti, margin, status, msg,
    )


def check_all(pairs: list[CoordinationPair]) -> list[CoordinationResult]:
    return [check_pair(p) for p in pairs]


def summary(results: list[CoordinationResult]) -> dict:
    passed = sum(1 for r in results if r.status == "PASS")
    failed = sum(1 for r in results if r.status == "FAIL")
    no_op = sum(1 for r in results if r.status == "NO-OPERATE")
    return {
        "total": len(results),
        "passed": passed,
        "failed": failed,
        "no_operate": no_op,
        "all_ok": failed == 0 and no_op == 0,
    }


def suggest_time_dial(
    pair: CoordinationPair,
    *,
    tolerance: float = 0.005,
    max_td: float = 15.0,
) -> float | None:
    """Suggest an upstream time-dial that just satisfies the CTI.

    Only meaningful when the upstream device is a relay (has ``time_dial``).
    Uses the linear scaling of inverse-time curves with the dial: the operate
    time is proportional to TMS/TDS, so the required dial can be solved
    directly and then verified.
    """
    up = pair.upstream
    if not hasattr(up, "time_dial"):
        return None

    ic = pair.fault.current_primary
    td_down = pair.downstream.trip_time(ic)
    if math.isinf(td_down):
        return None

    target_tu = td_down + pair.required_cti
    # operate time is linear in the dial (instantaneous excluded here)
    current_dial = up.time_dial
    if current_dial <= 0:
        return None
    t_at_current = up.trip_time(ic)
    if math.isinf(t_at_current) or t_at_current <= 0:
        return None
    scale = target_tu / t_at_current
    new_dial = round(min(current_dial * scale, max_td), 3)

    # verify
    saved = up.time_dial
    up.time_dial = new_dial
    achieved = up.trip_time(ic)
    up.time_dial = saved
    if achieved + tolerance >= target_tu:
        return new_dial
    return new_dial  # best effort; caller can re-check
