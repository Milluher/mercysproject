"""Portfolio overview: headline numbers, warning signs and every company at a glance."""

import math

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from portfolio import metrics, ui


companies, derived = ui.load_data()
if derived.empty:
    st.info("No KPI updates yet. Use **Submit update** in the sidebar to add the first one.")
    st.stop()

snapshot = metrics.latest_snapshot(derived)
flags = metrics.portfolio_flags(derived, ui.today())
status = metrics.health_status(flags, list(snapshot.index))

st.title("Portfolio KPI dashboard")
st.caption(f"Latest reported month per company · {len(snapshot)} companies · as of {ui.today():%d %b %Y}")

# --- Headline numbers ---------------------------------------------------------
finite_runway = snapshot["runway_months"].replace(math.inf, pd.NA).dropna()
needs_attention = int((status.isin(["serious", "critical"])).sum())

c1, c2, c3, c4 = st.columns(4)
c1.metric("Portfolio ARR", ui.money(snapshot["arr"].sum()), help="Sum of each company's latest MRR × 12")
c2.metric("Companies", len(snapshot))
c3.metric("Need attention", needs_attention, help="Companies with a serious or critical warning")
c4.metric(
    "Median runway",
    ui.runway(finite_runway.median()) if not finite_runway.empty else "–",
    help="Across companies that are still burning cash",
)

# --- Warning signs ------------------------------------------------------------
st.subheader("Warning signs")
if flags.empty:
    st.success("No warning signs across the portfolio.")
else:
    for _, f in flags[flags["severity"].isin(["critical", "serious"])].iterrows():
        text = f"{ui.STATUS_LABELS[f['severity']]} — **{f['company']}** · {f['metric']}: {f['message']}"
        (st.error if f["severity"] == "critical" else st.warning)(text)
    watch = flags[flags["severity"] == "warning"]
    if not watch.empty:
        st.markdown("**Keep an eye on**")
        st.markdown("\n".join(f"- 🟡 **{f['company']}** · {f['metric']}: {f['message']}" for _, f in watch.iterrows()))

# --- Company table ------------------------------------------------------------
st.subheader("Companies")
info = companies.set_index("name")
table = pd.DataFrame(
    {
        "Status": status.map(ui.STATUS_LABELS),
        "Sector": info["sector"],
        "Stage": info["stage"],
        "MRR": snapshot["revenue"],
        "MoM growth": snapshot["revenue_growth"] * 100,
        "Net burn": snapshot["burn"],
        "Cash": snapshot["cash"],
        "Runway": snapshot["runway_months"].map(ui.runway),
        "Burn multiple": snapshot["burn_multiple"],
        "Headcount": snapshot["headcount"],
        "Last report": snapshot["month"].dt.strftime("%b %Y"),
    }
).loc[snapshot.index]
# Most urgent first, then alphabetical.
urgency = status.map(metrics.SEVERITIES.index)
table = table.loc[sorted(table.index, key=lambda name: (-urgency[name], name))]

st.dataframe(
    table,
    width="stretch",
    column_config={
        "_index": st.column_config.TextColumn("Company"),
        "MRR": st.column_config.NumberColumn("MRR ($)", format="compact"),
        "Net burn": st.column_config.NumberColumn("Net burn ($)", format="compact", help="Negative = cash-flow positive"),
        "Cash": st.column_config.NumberColumn("Cash ($)", format="compact"),
        "MoM growth": st.column_config.NumberColumn(format="%+.1f%%"),
        "Burn multiple": st.column_config.NumberColumn(
            format="%.1fx",
            help="Net burn ÷ net new ARR over the last 3 months. Lower is better; above 3x is costly growth. "
            "Blank when revenue didn't grow or the company is cash-flow positive.",
        ),
    },
)

# --- Runway chart -------------------------------------------------------------
st.subheader("Runway by company")
runway_known = snapshot["runway_months"].notna()
burning = snapshot[runway_known & ~snapshot["runway_months"].map(math.isinf)].sort_values("runway_months", ascending=False)
profitable = sorted(snapshot.index[runway_known & snapshot["runway_months"].map(math.isinf)])
unknown = sorted(snapshot.index[~runway_known])

fig = go.Figure(
    go.Bar(
        x=burning["runway_months"],
        y=burning.index,
        orientation="h",
        marker=dict(color=ui.SERIES_COLOR, cornerradius=4),
        text=burning["runway_months"].map(lambda v: f"{v:.1f} mo"),
        textposition="outside",
        hovertemplate="%{y}: %{x:.1f} months<extra></extra>",
    )
)
t = metrics.DEFAULT_THRESHOLDS
for months, label in ((t.runway_critical_months, "Critical"), (t.runway_serious_months, "Fundraise")):
    fig.add_vline(
        x=months, line=dict(color=ui.REFERENCE_COLOR, width=1, dash="dot"),
        annotation_text=f"{label} ({months:g} mo)", annotation_position="top",
        annotation_font_color=ui.REFERENCE_COLOR,
    )
ui.style_figure(fig, height=max(240, 44 * len(burning) + 60))
fig.update_layout(hovermode="closest", margin=dict(t=32))
x_max = max(burning["runway_months"].max() if not burning.empty else 0, t.runway_serious_months)
fig.update_xaxes(title="Months of cash at current burn", showgrid=True, range=[0, x_max * 1.15])
if burning.empty:
    st.caption("No company is currently burning cash, or none has reported cash and burn yet.")
else:
    st.plotly_chart(fig, width="stretch", theme="streamlit")
if profitable:
    st.caption(f"Not shown, cash-flow positive: {', '.join(profitable)}")
if unknown:
    st.caption(f"Not shown, cash or burn never reported: {', '.join(unknown)}")
