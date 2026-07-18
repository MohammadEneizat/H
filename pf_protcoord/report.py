"""Human-readable coordination + consultant reports (text/markdown)."""

from __future__ import annotations

import math

from .consultant import Finding, SettingRecommendation, Severity, _SEV_LABEL
from .coordination import CoordinationResult, summary


def _fmt_t(t: float) -> str:
    return "no-op" if math.isinf(t) else f"{t:.3f}s"


# --- coordination results ---------------------------------------------------

def text_report(results: list[CoordinationResult]) -> str:
    s = summary(results)
    lines = ["=" * 72, "PROTECTION COORDINATION REVIEW", "=" * 72]
    for r in results:
        flag = {"PASS": "[ OK ]", "FAIL": "[FAIL]", "NO-OPERATE": "[NOOP]"}[r.status]
        lines += [
            "",
            f"{flag} {r.pair_name}",
            f"       Fault @ {r.fault_location}: {r.fault_current:,.0f} A",
            f"       downstream trips {_fmt_t(r.t_downstream)}, "
            f"upstream trips {_fmt_t(r.t_upstream)}",
        ]
        margin = "inf" if math.isinf(r.actual_margin) else f"{r.actual_margin:.3f}s"
        lines.append(f"       margin {margin} (need {r.required_cti:.3f}s)")
        if r.message:
            lines.append(f"       >> {r.message}")
    lines += [
        "", "-" * 72,
        f"TOTAL {s['total']}  |  PASS {s['passed']}  |  FAIL {s['failed']}  |  "
        f"NO-OPERATE {s['no_operate']}",
        "RESULT: " + ("ALL COORDINATED" if s["all_ok"] else "COORDINATION ISSUES FOUND"),
        "=" * 72,
    ]
    return "\n".join(lines)


def markdown_report(results: list[CoordinationResult]) -> str:
    s = summary(results)
    lines = ["# Protection Coordination Review", ""]
    lines.append(f"**Result:** {'All coordinated ✅' if s['all_ok'] else 'Issues found ❌'} "
                 f"— {s['passed']}/{s['total']} pairs pass\n")
    lines.append("| Status | Pair | Fault (A) | t↓ | t↑ | Margin | Req. CTI | Note |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for r in results:
        icon = {"PASS": "✅", "FAIL": "❌", "NO-OPERATE": "⚠️"}[r.status]
        margin = "∞" if math.isinf(r.actual_margin) else f"{r.actual_margin:.3f}"
        lines.append(f"| {icon} | {r.pair_name} | {r.fault_current:,.0f} | "
                     f"{_fmt_t(r.t_downstream)} | {_fmt_t(r.t_upstream)} | "
                     f"{margin} | {r.required_cti:.2f} | {r.message} |")
    return "\n".join(lines)


# --- consultant recommendations / findings ----------------------------------

_SEV_ICON = {
    Severity.INFO: "ℹ️", Severity.ADVISORY: "🟦",
    Severity.WARNING: "⚠️", Severity.CRITICAL: "🛑",
}


def findings_text(findings: list[Finding]) -> str:
    return "\n".join(str(f) for f in findings)


def recommendation_text(rec: SettingRecommendation, name: str = "Relay") -> str:
    lines = ["=" * 72, f"CONSULTANT RECOMMENDATION — {name}", "=" * 72, ""]
    lines.append("Proposed settings:")
    ps = f"{rec.pickup_primary:,.0f} A primary" if rec.pickup_primary else "n/a"
    sec = f" ({rec.pickup_secondary} A sec)" if rec.pickup_secondary else ""
    lines.append(f"  • 51 pickup   : {ps}{sec}")
    lines.append(f"  • Curve       : {rec.curve}")
    lines.append(f"  • Time dial   : {rec.time_dial if rec.time_dial is not None else 'n/a'}")
    inst = f"{rec.inst_pickup_primary:,.0f} A" if rec.inst_pickup_primary else "not applied"
    lines.append(f"  • 50 inst.    : {inst}")
    lines += ["", "Rationale:"]
    lines += [f"  - {r}" for r in rec.rationale]
    if rec.findings:
        lines += ["", "Flags:"]
        lines += [f"  {f}" for f in rec.findings]
    lines.append("=" * 72)
    return "\n".join(lines)


def consultant_markdown(rec: SettingRecommendation, name: str = "Relay") -> str:
    lines = [f"## Recommendation — {name}", ""]
    lines.append("| Setting | Value |")
    lines.append("|---|---|")
    lines.append(f"| 51 pickup (primary) | {rec.pickup_primary:,.0f} A |"
                 if rec.pickup_primary else "| 51 pickup | n/a |")
    if rec.pickup_secondary:
        lines.append(f"| 51 pickup (secondary) | {rec.pickup_secondary} A |")
    lines.append(f"| Curve | {rec.curve} |")
    lines.append(f"| Time dial | {rec.time_dial if rec.time_dial is not None else 'n/a'} |")
    lines.append(f"| 50 instantaneous | "
                 f"{f'{rec.inst_pickup_primary:,.0f} A' if rec.inst_pickup_primary else 'not applied'} |")
    lines += ["", "**Rationale**", ""]
    lines += [f"- {r}" for r in rec.rationale]
    if rec.findings:
        lines += ["", "**Flags**", ""]
        lines += [f"- {_SEV_ICON[f.severity]} **{_SEV_LABEL[f.severity]}** "
                  f"({f.category}): {f.message}"
                  + (f" _→ {f.recommendation}_" if f.recommendation else "")
                  for f in rec.findings]
    return "\n".join(lines)
