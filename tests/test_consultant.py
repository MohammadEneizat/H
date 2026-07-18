from pf_protcoord import (DeviceContext, ProtectiveDevice, Severity,
                          recommend_oc_settings, review_device)


def test_recommend_places_pickup_in_valid_window():
    rec = recommend_oc_settings(
        max_load_current=400, min_fault_current=3600, max_fault_current=6500,
        downstream_max_fault=3600, ct_ratio=120, curve="IEC-SI",
        downstream_trip_time=0.20,
    )
    assert rec.pickup_primary is not None
    assert 1.25 * 400 <= rec.pickup_primary <= 3600 / 1.5
    assert rec.time_dial is not None and rec.time_dial > 0
    assert rec.inst_pickup_primary == round(1.25 * 3600, 1)
    assert not any(f.severity >= Severity.WARNING for f in rec.findings)


def test_recommend_flags_impossible_window():
    # load floor above sensitivity ceiling -> critical
    rec = recommend_oc_settings(
        max_load_current=3000, min_fault_current=3600, max_fault_current=6500,
    )
    assert any(f.severity == Severity.CRITICAL and f.category == "sensitivity"
               for f in rec.findings)


def test_review_flags_pickup_below_load():
    dev = ProtectiveDevice("R", pickup_primary=300, time_dial=0.2, curve="IEC-SI")
    ctx = DeviceContext(max_load_current=500, min_fault_current=3600, max_fault_current=6500)
    findings = review_device(dev, ctx)
    assert any(f.category == "security" and f.severity == Severity.CRITICAL
               for f in findings)


def test_review_flags_instantaneous_reaching_downstream():
    dev = ProtectiveDevice("R", pickup_primary=700, time_dial=0.2, curve="IEC-SI",
                           inst_pickup_primary=2000)
    ctx = DeviceContext(max_load_current=400, min_fault_current=3600,
                        max_fault_current=6500, downstream_max_fault=3600)
    findings = review_device(dev, ctx)
    assert any(f.category == "selectivity" and f.severity == Severity.CRITICAL
               for f in findings)


def test_review_clean_device_returns_info():
    dev = ProtectiveDevice("R", pickup_primary=700, time_dial=0.2, curve="IEC-SI",
                           inst_pickup_primary=4600)
    ctx = DeviceContext(max_load_current=400, min_fault_current=3600,
                        max_fault_current=6500, downstream_max_fault=3600)
    findings = review_device(dev, ctx)
    assert all(f.severity <= Severity.ADVISORY for f in findings)
