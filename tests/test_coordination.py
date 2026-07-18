import math

from pf_protcoord import (CoordinationPair, FaultPoint, ProtectiveDevice,
                          check_pair, load_project, check_all, summary)
from pf_protcoord.coordination import suggest_time_dial


def _pair(td_down=0.1, td_up=0.2, fault=3600, cti=0.30):
    down = ProtectiveDevice("D", pickup_primary=500, time_dial=td_down, curve="IEC-SI")
    up = ProtectiveDevice("U", pickup_primary=800, time_dial=td_up, curve="IEC-SI")
    fp = FaultPoint("bus", fault)
    return CoordinationPair(downstream=down, upstream=up, fault=fp, required_cti=cti)


def test_pass_when_margin_sufficient():
    p = _pair(td_down=0.1, td_up=1.0)
    r = check_pair(p)
    assert r.status == "PASS"
    assert r.actual_margin >= p.required_cti


def test_fail_when_upstream_faster():
    p = _pair(td_down=1.0, td_up=0.1)
    r = check_pair(p)
    assert r.status == "FAIL"
    assert r.actual_margin < 0


def test_fail_when_margin_thin():
    # identical devices with close dials -> small positive margin under CTI
    down = ProtectiveDevice("D", pickup_primary=500, time_dial=0.50, curve="IEC-SI")
    up = ProtectiveDevice("U", pickup_primary=500, time_dial=0.52, curve="IEC-SI")
    p = CoordinationPair(down, up, FaultPoint("bus", 3600), required_cti=0.30)
    r = check_pair(p)
    assert r.status == "FAIL"
    assert 0 <= r.actual_margin < 0.30


def test_no_operate_when_upstream_below_pickup():
    down = ProtectiveDevice("D", pickup_primary=100, time_dial=0.1, curve="IEC-SI")
    up = ProtectiveDevice("U", pickup_primary=5000, time_dial=0.2, curve="IEC-SI")
    p = CoordinationPair(down, up, FaultPoint("bus", 1000))
    r = check_pair(p)
    assert r.status == "NO-OPERATE"
    assert math.isinf(r.t_upstream)


def test_suggest_time_dial_fixes_margin():
    p = _pair(td_down=1.0, td_up=0.1)  # currently miscoordinated
    new_td = suggest_time_dial(p)
    assert new_td is not None
    p.upstream.time_dial = new_td
    r = check_pair(p)
    assert r.actual_margin >= p.required_cti - 1e-6


def test_example_project_loads_and_checks():
    proj = load_project("examples/example_feeder.json")
    results = check_all(proj["pairs"])
    s = summary(results)
    assert s["total"] == 2
    assert len(proj["devices"]) == 3
