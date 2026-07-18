"""Command-line entry point for the coordination consultant.

Examples
--------
  # Review coordination of a JSON study and print a report
  python -m pf_protcoord.cli review examples/example_feeder.json

  # Recommend settings for one relay from its operating data
  python -m pf_protcoord.cli recommend --load 550 --min-fault 3600 \
      --max-fault 6500 --downstream-fault 3600 --ct 120 --curve IEC-VI

  # Render a TCC plot from a study to PNG
  python -m pf_protcoord.cli plot examples/example_feeder.json -o tcc.png

  # List the built-in standard curves
  python -m pf_protcoord.cli curves
"""

from __future__ import annotations

import argparse
import sys

from . import (available_curves, check_all, load_project, markdown_report,
               recommend_oc_settings, recommendation_text, summary, text_report)


def _cmd_review(args) -> int:
    proj = load_project(args.project)
    results = check_all(proj["pairs"])
    print(markdown_report(results) if args.markdown else text_report(results))
    return 0 if summary(results)["all_ok"] else 1


def _cmd_recommend(args) -> int:
    rec = recommend_oc_settings(
        max_load_current=args.load,
        min_fault_current=args.min_fault,
        max_fault_current=args.max_fault,
        downstream_max_fault=args.downstream_fault,
        ct_ratio=args.ct,
        curve=args.curve,
        downstream_trip_time=args.downstream_time,
        required_cti=args.cti,
        transformer_inrush=args.inrush,
    )
    print(recommendation_text(rec, args.name))
    return 0


def _cmd_plot(args) -> int:
    proj = load_project(args.project)
    from .plotting import plot_tcc
    devices = list(proj["devices"].values())
    faults = [(f.location, f.current_primary) for f in proj["faults"].values()]
    plot_tcc(devices, faults, title=proj["meta"].get("title", "TCC"),
             save_path=args.output, show=args.show)
    if args.output:
        print(f"Wrote {args.output}")
    return 0


def _cmd_curves(_args) -> int:
    print("Available standard curves:")
    for c in available_curves():
        print(f"  {c}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="pf-protcoord",
        description="Protection coordination consultant for PowerFactory studies.",
    )
    sub = p.add_subparsers(dest="command", required=True)

    r = sub.add_parser("review", help="review coordination of a JSON study")
    r.add_argument("project")
    r.add_argument("--markdown", action="store_true", help="markdown output")
    r.set_defaults(func=_cmd_review)

    rc = sub.add_parser("recommend", help="recommend settings for one relay")
    rc.add_argument("--name", default="Relay")
    rc.add_argument("--load", type=float, required=True, help="max load current (A)")
    rc.add_argument("--min-fault", type=float, required=True, help="min fault current (A)")
    rc.add_argument("--max-fault", type=float, required=True, help="max fault at relay (A)")
    rc.add_argument("--downstream-fault", type=float, default=None,
                    help="max fault beyond downstream device (A)")
    rc.add_argument("--downstream-time", type=float, default=None,
                    help="downstream operate time at max fault (s), to size time dial")
    rc.add_argument("--ct", type=float, default=1.0, help="CT ratio (primary/secondary)")
    rc.add_argument("--curve", default="IEC-SI", help="curve key (see 'curves')")
    rc.add_argument("--cti", type=float, default=0.30, help="required CTI (s)")
    rc.add_argument("--inrush", type=float, default=None, help="transformer inrush (A)")
    rc.set_defaults(func=_cmd_recommend)

    pl = sub.add_parser("plot", help="render a TCC plot from a study")
    pl.add_argument("project")
    pl.add_argument("-o", "--output", default=None, help="output image path")
    pl.add_argument("--show", action="store_true")
    pl.set_defaults(func=_cmd_plot)

    cu = sub.add_parser("curves", help="list built-in standard curves")
    cu.set_defaults(func=_cmd_curves)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
