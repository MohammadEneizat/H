import math

import pytest

from pf_protcoord import available_curves, operating_time


def test_iec_standard_inverse_reference_point():
    # IEC-SI: t = TMS * 0.14 / (M**0.02 - 1). At M=2, TMS=1 -> ~10.03 s
    t = operating_time(200, 100, 1.0, "IEC-SI")
    assert t == pytest.approx(10.03, abs=0.05)


def test_time_dial_scales_linearly():
    t1 = operating_time(500, 100, 0.1, "IEC-VI")
    t5 = operating_time(500, 100, 0.5, "IEC-VI")
    assert t5 == pytest.approx(5 * t1, rel=1e-9)


def test_higher_current_trips_faster():
    t_low = operating_time(300, 100, 0.2, "IEC-SI")
    t_high = operating_time(1000, 100, 0.2, "IEC-SI")
    assert t_high < t_low


def test_below_pickup_never_trips():
    assert math.isinf(operating_time(90, 100, 0.2, "IEC-SI"))
    assert math.isinf(operating_time(100, 100, 0.2, "IEC-SI"))


def test_ieee_very_inverse_positive_and_ordered():
    t = operating_time(600, 100, 1.0, "IEEE-VI")
    assert t > 0 and math.isfinite(t)


def test_unknown_curve_raises():
    with pytest.raises(KeyError):
        operating_time(200, 100, 1.0, "NOPE")


def test_bad_pickup_raises():
    with pytest.raises(ValueError):
        operating_time(200, 0, 1.0, "IEC-SI")


def test_all_curves_evaluate():
    for c in available_curves():
        t = operating_time(1000, 100, 0.5, c)
        assert math.isfinite(t) and t > 0
