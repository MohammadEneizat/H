"""Standard inverse-time overcurrent relay characteristics.

Implements the IEC 60255-151 and IEEE C37.112 standard curve families used
for time-overcurrent (ANSI 51) elements, plus definite-time (ANSI 50/DT)
behaviour. Operating times are computed from the classic multiplying
equations so results line up with what PowerFactory reports for the same
relay type, pickup and time setting.

All currents are treated as *primary* amps unless a CT ratio is applied by
the caller. The equations depend only on the multiple  M = I / Ipickup,
so they are unit-agnostic as long as I and Ipickup share units.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum


class CurveStandard(str, Enum):
    IEC = "IEC"
    IEEE = "IEEE"
    DEFINITE_TIME = "DT"


@dataclass(frozen=True)
class CurveCoeffs:
    """Coefficients for a standard characteristic.

    IEC 60255:      t = TMS * ( k / (M**alpha - 1) )
    IEEE C37.112:   t = TDS * ( a / (M**p - 1) + b )
    """

    standard: CurveStandard
    k: float = 0.0
    alpha: float = 0.0
    a: float = 0.0
    b: float = 0.0
    p: float = 0.0


# IEC 60255-151 curves:  t = TMS * k / (M**alpha - 1)
IEC_CURVES = {
    "IEC-SI": CurveCoeffs(CurveStandard.IEC, k=0.14, alpha=0.02),      # Standard Inverse
    "IEC-VI": CurveCoeffs(CurveStandard.IEC, k=13.5, alpha=1.0),       # Very Inverse
    "IEC-EI": CurveCoeffs(CurveStandard.IEC, k=80.0, alpha=2.0),       # Extremely Inverse
    "IEC-LTI": CurveCoeffs(CurveStandard.IEC, k=120.0, alpha=1.0),     # Long-Time Inverse
}

# IEEE C37.112 curves:  t = TDS * ( a/(M**p - 1) + b )
IEEE_CURVES = {
    "IEEE-MI": CurveCoeffs(CurveStandard.IEEE, a=0.0515, b=0.1140, p=0.02),  # Moderately Inverse
    "IEEE-VI": CurveCoeffs(CurveStandard.IEEE, a=19.61, b=0.491, p=2.0),     # Very Inverse
    "IEEE-EI": CurveCoeffs(CurveStandard.IEEE, a=28.2, b=0.1217, p=2.0),     # Extremely Inverse
    # US CO family (kept in the IEEE multiplying form)
    "US-CO8": CurveCoeffs(CurveStandard.IEEE, a=5.95, b=0.180, p=2.0),       # Inverse
    "US-CO2": CurveCoeffs(CurveStandard.IEEE, a=0.0239, b=0.0169, p=0.02),   # Short-Time Inverse
}

ALL_CURVES = {**IEC_CURVES, **IEEE_CURVES}


@dataclass(frozen=True)
class CustomCurve:
    """A user-imported characteristic defined by (multiple, time) points.

    ``multiples`` are M = I/pickup values (ascending, each > 1) and ``times``
    are the operate times at ``time_dial = 1``. Operating time at any current
    is found by log-log interpolation between points and scales linearly with
    the time dial — the same behaviour as a real relay's TMS/TDS. This is the
    natural form for manufacturer curve tables and PowerFactory characteristic
    exports (time/TMS vs. multiple of pickup).
    """

    name: str
    multiples: tuple[float, ...]
    times: tuple[float, ...]


# Registry of imported curves, keyed by name (kept separate from the built-ins).
_CUSTOM_CURVES: dict[str, CustomCurve] = {}


def register_custom_curve(name: str, multiples, times) -> str:
    """Register an imported characteristic so it can be used like a built-in.

    Points are sorted by multiple; requires at least two points, all multiples
    strictly increasing and > 1, all times > 0. Returns the registered name.
    """
    pts = sorted(zip((float(m) for m in multiples), (float(t) for t in times)))
    if len(pts) < 2:
        raise ValueError("a custom curve needs at least two (multiple, time) points")
    ms = [m for m, _ in pts]
    ts = [t for _, t in pts]
    if ms[0] <= 1.0:
        raise ValueError("all multiples must be > 1 (M = I/pickup above pickup)")
    if any(b <= a for a, b in zip(ms, ms[1:])):
        raise ValueError("multiples must be strictly increasing")
    if any(t <= 0 for t in ts):
        raise ValueError("all times must be positive")
    _CUSTOM_CURVES[name] = CustomCurve(name, tuple(ms), tuple(ts))
    return name


def is_custom_curve(name: str) -> bool:
    return name in _CUSTOM_CURVES


def get_custom_curve(name: str) -> CustomCurve | None:
    return _CUSTOM_CURVES.get(name)


def _interp_loglog(x: float, xs: list[float] | tuple[float, ...],
                   ys: list[float] | tuple[float, ...]) -> float:
    """Interpolate y at x on log-log axes, extrapolating on the end segments."""
    import bisect
    if x <= xs[0]:
        i0, i1 = 0, 1
    elif x >= xs[-1]:
        i0, i1 = len(xs) - 2, len(xs) - 1
    else:
        j = bisect.bisect_right(xs, x)
        i0, i1 = j - 1, j
    lx0, lx1 = math.log10(xs[i0]), math.log10(xs[i1])
    ly0, ly1 = math.log10(ys[i0]), math.log10(ys[i1])
    ly = ly0 + (ly1 - ly0) * (math.log10(x) - lx0) / (lx1 - lx0)
    return 10 ** ly


def available_curves(include_custom: bool = True) -> list[str]:
    """Names of every characteristic (built-in, plus imported if requested)."""
    names = list(ALL_CURVES.keys())
    if include_custom:
        names += list(_CUSTOM_CURVES.keys())
    return sorted(names)


def operating_time(
    current: float,
    pickup: float,
    time_dial: float,
    curve: str = "IEC-SI",
    *,
    min_time: float = 0.0,
    reset: bool = True,
) -> float:
    """Return relay operating time (seconds) for a steady fault ``current``.

    Parameters
    ----------
    current : fault current seen by the element (same units as ``pickup``).
    pickup : element pickup / plug setting.
    time_dial : TMS (IEC) or TDS (IEEE) multiplier.
    curve : key from :func:`available_curves`.
    min_time : optional definite minimum time floor added by some relays.
    reset : if True, currents at or below pickup return ``inf`` (no trip)
        rather than raising.

    Returns
    -------
    float
        Operating time in seconds. ``math.inf`` when the current does not
        reach pickup (the element never operates).
    """
    if pickup <= 0:
        raise ValueError("pickup must be positive")
    if current <= 0:
        return math.inf
    m = current / pickup
    if m <= 1.0:
        if reset:
            return math.inf
        raise ValueError(f"current {current} does not exceed pickup {pickup}")

    custom = _CUSTOM_CURVES.get(curve)
    if custom is not None:
        t = time_dial * _interp_loglog(m, custom.multiples, custom.times)
        return max(t, min_time)

    c = ALL_CURVES.get(curve)
    if c is None:
        raise KeyError(f"unknown curve '{curve}'. Options: {available_curves()}")

    if c.standard is CurveStandard.IEC:
        t = time_dial * (c.k / (m ** c.alpha - 1.0))
    elif c.standard is CurveStandard.IEEE:
        t = time_dial * (c.a / (m ** c.p - 1.0) + c.b)
    else:  # pragma: no cover - definite time handled elsewhere
        raise ValueError(f"curve '{curve}' is not an inverse-time characteristic")

    return max(t, min_time)


def curve_points(
    pickup: float,
    time_dial: float,
    curve: str = "IEC-SI",
    *,
    m_start: float = 1.05,
    m_end: float = 40.0,
    points: int = 200,
) -> tuple[list[float], list[float]]:
    """Sample a characteristic for plotting.

    Returns ``(currents, times)`` where ``currents`` are primary amps spanning
    ``m_start``..``m_end`` multiples of pickup on a log scale, and ``times`` are
    the corresponding operating times.
    """
    custom = _CUSTOM_CURVES.get(curve)
    if custom is not None:
        # sample within the imported curve's own multiple range
        m_start = max(m_start, custom.multiples[0])
        m_end = min(m_end, custom.multiples[-1])
    currents: list[float] = []
    times: list[float] = []
    log_lo, log_hi = math.log10(m_start), math.log10(m_end)
    for i in range(points):
        m = 10 ** (log_lo + (log_hi - log_lo) * i / (points - 1))
        currents.append(m * pickup)
        times.append(operating_time(m * pickup, pickup, time_dial, curve))
    return currents, times
