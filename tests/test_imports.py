import math

import pytest

from pf_protcoord import (available_curves, import_curve_from_csv,
                          import_curve_from_text, import_relays_from_csv,
                          is_custom_curve, operating_time,
                          recommend_oc_settings, register_custom_curve,
                          review_device)


def test_register_and_evaluate_custom_curve():
    register_custom_curve("MYCURVE", [2, 5, 10, 20], [4.0, 1.2, 0.6, 0.35])
    assert is_custom_curve("MYCURVE")
    # at M=5, TD=1 -> exactly the tabulated 1.2 s
    t = operating_time(500, 100, 1.0, "MYCURVE")
    assert t == pytest.approx(1.2, abs=1e-6)


def test_custom_curve_scales_with_time_dial():
    register_custom_curve("MC2", [2, 10], [4.0, 0.6])
    t1 = operating_time(1000, 100, 0.1, "MC2")
    t5 = operating_time(1000, 100, 0.5, "MC2")
    assert t5 == pytest.approx(5 * t1, rel=1e-9)


def test_custom_curve_loglog_interpolation():
    register_custom_curve("MC3", [2, 8], [4.0, 1.0])
    # geometric-mean current -> geometric-mean time on log-log
    t = operating_time(400, 100, 1.0, "MC3")  # M=4, between 2 and 8
    assert 1.0 < t < 4.0


def test_import_curve_from_csv_file():
    name = import_curve_from_csv("examples/my_curve.csv")
    assert name in available_curves()
    assert math.isfinite(operating_time(1000, 100, 0.5, name))


def test_import_curve_from_text_current_form():
    text = "current,time\n200,4.0\n1000,0.6\n"
    import_curve_from_text(text, "FROMCURR", pickup=100)
    t = operating_time(1000, 100, 1.0, "FROMCURR")  # M=10 -> 0.6 s
    assert t == pytest.approx(0.6, abs=1e-6)


def test_recommend_with_imported_curve():
    name = import_curve_from_csv("examples/my_curve.csv")
    rec = recommend_oc_settings(
        max_load_current=400, min_fault_current=3600, max_fault_current=6500,
        downstream_max_fault=3600, ct_ratio=120, curve=name,
        downstream_trip_time=0.20,
    )
    assert rec.curve == name
    assert rec.pickup_primary is not None
    assert rec.time_dial is not None and rec.time_dial > 0


def test_import_relays_and_review():
    pairs = import_relays_from_csv("examples/my_relays.csv")
    assert len(pairs) == 3
    dev, ctx = pairs[0]  # Load-CB pickup 300 < load 500 -> security critical
    findings = review_device(dev, ctx)
    assert any(f.category == "security" for f in findings)
