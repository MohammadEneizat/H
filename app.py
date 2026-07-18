"""Streamlit UI — the protection coordination consultant.

Run:  streamlit run app.py

Three panels:
  1. Recommend — enter one relay's load/fault data, get proposed 50/51 settings
     with rationale (paste the currents from your PowerFactory short-circuit run).
  2. Review    — load a JSON study, check CTI grading across all pairs, see a TCC.
  3. Curves    — explore the standard characteristics.
"""

from __future__ import annotations

import json

import streamlit as st

from pf_protcoord import (available_curves, check_all, curve_points,
                          load_project, recommend_oc_settings, summary)
from pf_protcoord.consultant import (DeviceContext, Severity, _SEV_LABEL,
                                     review_device)
from pf_protcoord.devices import ProtectiveDevice
from pf_protcoord.report import consultant_markdown, markdown_report

st.set_page_config(page_title="Protection Coordination Consultant", layout="wide")
st.title("⚡ Protection Coordination Consultant")
st.caption("Bring your PowerFactory load & short-circuit numbers — get expert "
           "50/51 setting recommendations and grading review.")

tab_rec, tab_review, tab_curves = st.tabs(
    ["🧠 Recommend settings", "🔍 Review a study", "📈 Curves"])

# --------------------------------------------------------------------------
with tab_rec:
    st.subheader("Recommend 50/51 settings for one relay")
    c1, c2, c3 = st.columns(3)
    with c1:
        name = st.text_input("Relay name", "Feeder 51")
        load = st.number_input("Max load current (A, primary)", value=400.0, min_value=0.0)
        ct = st.number_input("CT ratio (primary/secondary)", value=120.0, min_value=1.0)
    with c2:
        min_fault = st.number_input("Min fault current (A)", value=3600.0, min_value=0.0,
                                    help="Line-to-line fault at the far end of the zone")
        max_fault = st.number_input("Max fault at relay (A)", value=6500.0, min_value=0.0)
        down_fault = st.number_input("Max fault beyond downstream device (A)",
                                     value=3600.0, min_value=0.0)
    with c3:
        curve = st.selectbox("Curve", available_curves(),
                             index=available_curves().index("IEC-SI"))
        cti = st.number_input("Required CTI (s)", value=0.30, min_value=0.0, step=0.05)
        down_time = st.number_input("Downstream operate time @ max fault (s)",
                                    value=0.20, min_value=0.0, step=0.05)
        inrush = st.number_input("Transformer inrush (A, 0 = n/a)", value=0.0, min_value=0.0)

    if st.button("Recommend", type="primary"):
        rec = recommend_oc_settings(
            max_load_current=load, min_fault_current=min_fault,
            max_fault_current=max_fault, downstream_max_fault=down_fault or None,
            ct_ratio=ct, curve=curve, downstream_trip_time=down_time or None,
            required_cti=cti, transformer_inrush=inrush or None,
        )
        st.markdown(consultant_markdown(rec, name))

# --------------------------------------------------------------------------
with tab_review:
    st.subheader("Review coordination of a study")
    up = st.file_uploader("Upload study JSON", type=["json"])
    use_example = st.checkbox("Use bundled example feeder", value=up is None)

    proj = None
    if up is not None:
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf:
            tf.write(up.getvalue().decode())
            path = tf.name
        proj = load_project(path)
    elif use_example:
        proj = load_project("examples/example_feeder.json")

    if proj:
        results = check_all(proj["pairs"])
        s = summary(results)
        m1, m2, m3, m4 = st.columns(4)
        m1.metric("Pairs", s["total"])
        m2.metric("Pass", s["passed"])
        m3.metric("Fail", s["failed"])
        m4.metric("No-operate", s["no_operate"])
        st.markdown(markdown_report(results))

        st.markdown("#### Time-Current Curves")
        try:
            from pf_protcoord.plotting import plot_tcc
            devices = list(proj["devices"].values())
            faults = [(f.location, f.current_primary) for f in proj["faults"].values()]
            fig = plot_tcc(devices, faults, title=proj["meta"].get("title", "TCC"))
            st.pyplot(fig)
        except Exception as exc:  # pragma: no cover
            st.info(f"Plot unavailable: {exc}")

# --------------------------------------------------------------------------
with tab_curves:
    st.subheader("Standard characteristics")
    sel = st.multiselect("Curves", available_curves(), default=["IEC-SI", "IEC-VI", "IEC-EI"])
    pickup = st.number_input("Pickup (A)", value=100.0, min_value=1.0)
    td = st.number_input("Time dial", value=0.5, min_value=0.01, step=0.05)
    if sel:
        import pandas as pd
        frames = {}
        for cv in sel:
            xs, ys = curve_points(pickup, td, cv)
            frames[cv] = pd.Series(ys, index=xs)
        df = pd.DataFrame(frames)
        st.line_chart(df)
        st.caption("Log-shaped inverse-time curves; y = operate time (s), x = current (A).")
