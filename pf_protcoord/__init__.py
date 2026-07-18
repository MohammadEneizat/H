"""pf_protcoord — a protection-coordination *consultant* for PowerFactory studies.

You bring the numbers from your PowerFactory model (loads, short-circuit
currents, device settings); this toolkit reasons about them like a senior
protection engineer — recommending 50/51 settings with rationale, reviewing
existing settings for sensitivity/security/selectivity problems, checking CTI
grading, and producing a study report and TCC plot.

Public API:

    from pf_protcoord import (
        ProtectiveDevice, Fuse, FaultPoint, CoordinationPair,
        operating_time, available_curves, curve_points,
        check_all, check_pair, suggest_time_dial, summary,
        recommend_oc_settings, review_device, DeviceContext,
        SettingRecommendation, Finding, Severity,
        text_report, markdown_report, recommendation_text, consultant_markdown,
        load_project,
    )
"""

from __future__ import annotations

from .consultant import (DeviceContext, Finding, SettingRecommendation,
                         Severity, recommend_oc_settings, review_device)
from .coordination import (CoordinationResult, check_all, check_pair,
                           suggest_time_dial, summary)
from .curves import available_curves, curve_points, operating_time
from .devices import CoordinationPair, FaultPoint, Fuse, ProtectiveDevice
from .project import load_project
from .report import (consultant_markdown, findings_text, markdown_report,
                     recommendation_text, text_report)

__version__ = "0.1.0"

__all__ = [
    "ProtectiveDevice", "Fuse", "FaultPoint", "CoordinationPair",
    "operating_time", "available_curves", "curve_points",
    "check_all", "check_pair", "suggest_time_dial", "summary",
    "CoordinationResult",
    "recommend_oc_settings", "review_device", "DeviceContext",
    "SettingRecommendation", "Finding", "Severity",
    "text_report", "markdown_report", "findings_text",
    "recommendation_text", "consultant_markdown",
    "load_project", "__version__",
]
