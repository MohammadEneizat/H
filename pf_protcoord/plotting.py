"""Time-Current Curve (TCC) plotting on log-log axes.

Renders relay/fuse characteristics the way a coordination study expects:
current on the x-axis (log), operating time on the y-axis (log), with fault
markers and CTI annotations. matplotlib is imported lazily so the rest of the
package works in environments without it (e.g. inside PowerFactory's engine).
"""

from __future__ import annotations

from .curves import curve_points
from .devices import Fuse, ProtectiveDevice


def plot_tcc(
    devices: list[ProtectiveDevice | Fuse],
    faults: list[tuple[str, float]] | None = None,
    *,
    title: str = "Time-Current Coordination",
    current_range: tuple[float, float] = (10.0, 100_000.0),
    time_range: tuple[float, float] = (0.01, 100.0),
    save_path: str | None = None,
    show: bool = False,
):
    """Plot device characteristics and optional fault current lines.

    Returns the matplotlib ``Figure``. Pass ``save_path`` to write a PNG/PDF.
    """
    import matplotlib

    if save_path and not show:
        matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(8, 10))

    for dev in devices:
        if isinstance(dev, ProtectiveDevice):
            xs, ys = curve_points(dev.pickup_primary, dev.time_dial, dev.curve)
            (line,) = ax.plot(xs, ys, label=f"{dev.name} ({dev.curve})", linewidth=2)
            if dev.inst_pickup_primary is not None:
                # draw the instantaneous (50) element as a vertical drop
                ax.plot(
                    [dev.inst_pickup_primary, dev.inst_pickup_primary],
                    [max(dev.inst_delay, time_range[0]), _time_at(dev)],
                    color=line.get_color(), linestyle="--", linewidth=1.5,
                )
        elif isinstance(dev, Fuse):
            ax.plot(dev.currents, dev.clear_times, label=f"{dev.name} (fuse)",
                    linewidth=2, linestyle="-.")

    if faults:
        for label, current in faults:
            ax.axvline(current, color="red", linestyle=":", alpha=0.7)
            ax.text(current, time_range[1] * 0.6, f" {label}\n {current:.0f}A",
                    rotation=90, va="top", ha="left", fontsize=8, color="red")

    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlim(*current_range)
    ax.set_ylim(*time_range)
    ax.set_xlabel("Current (A, primary)")
    ax.set_ylabel("Operating time (s)")
    ax.set_title(title)
    ax.grid(True, which="both", linestyle="-", alpha=0.25)
    ax.grid(True, which="major", linestyle="-", alpha=0.5)
    ax.legend(loc="upper right", fontsize=8)

    if save_path:
        fig.savefig(save_path, dpi=150, bbox_inches="tight")
    if show:
        plt.show()
    return fig


def _time_at(dev: ProtectiveDevice) -> float:
    """Operate time of the 51 element right at the instantaneous pickup."""
    if dev.inst_pickup_primary is None:
        return 1.0
    return dev.trip_time(dev.inst_pickup_primary)
