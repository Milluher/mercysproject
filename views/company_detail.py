"""One company's KPI history, warning signs and founder notes."""

import pandas as pd
import streamlit as st

from portfolio import metrics, ui


companies, derived = ui.load_data()
if derived.empty:
    st.info("No KPI updates yet.")
    st.stop()

names = sorted(derived["company"].unique())
name = st.selectbox("Company", names, index=names.index(st.query_params["company"]) if st.query_params.get("company") in names else 0)
st.query_params["company"] = name

history = derived[derived["company"] == name].sort_values("month")
latest = history.iloc[-1]
info = companies.set_index("name").loc[name]
flags = metrics.company_flags(history, ui.today())
worst = max((f.severity for f in flags), key=metrics.SEVERITIES.index, default="good")

st.title(name)
details = [info["sector"], info["stage"]]
if pd.notna(info["amount_invested"]) and info["amount_invested"]:
    details.append(f"{ui.money(info['amount_invested'])} invested")
if pd.notna(info["ownership_pct"]) and info["ownership_pct"]:
    details.append(f"{info['ownership_pct']:g}% ownership")
st.caption(" · ".join(d for d in details if d) + f" · {ui.STATUS_LABELS[worst]} · last report {latest['month']:%b %Y}")

# --- Latest numbers -----------------------------------------------------------
prev = history.iloc[-2] if len(history) > 1 else None


def delta(column):
    return None if prev is None else latest[column] - prev[column]


c1, c2, c3, c4, c5 = st.columns(5)
c1.metric("MRR", ui.money(latest["revenue"]), ui.pct(latest["revenue_growth"]) if prev is not None else None)
c2.metric(
    "Net burn", ui.money(latest["burn"]),
    ui.money(delta("burn")) if prev is not None else None, delta_color="inverse",
)
c3.metric("Cash", ui.money(latest["cash"]))
c4.metric("Runway", ui.runway(latest["runway_months"]))
c5.metric("Headcount", int(latest["headcount"]), int(delta("headcount")) if prev is not None else None)

for f in flags:
    st.warning(f"{ui.STATUS_LABELS[f.severity]} — {f.metric}: {f.message}")

# --- Trends: one measure per chart --------------------------------------------
left, right = st.columns(2)
with left:
    st.markdown("**Monthly recurring revenue**")
    st.plotly_chart(ui.line_chart(history, "revenue", "MRR"), width="stretch", theme="streamlit")
    st.markdown("**Cash in bank**")
    st.plotly_chart(ui.line_chart(history, "cash", "Cash"), width="stretch", theme="streamlit")
with right:
    st.markdown("**Net burn**")
    st.plotly_chart(ui.line_chart(history, "burn", "Net burn"), width="stretch", theme="streamlit")
    st.markdown("**Headcount**")
    st.plotly_chart(ui.line_chart(history, "headcount", "Headcount", y_format=",d"), width="stretch", theme="streamlit")

# --- Founder notes and raw data ----------------------------------------------
notes = history[history["notes"].fillna("").str.strip() != ""]
if not notes.empty:
    st.subheader("Founder notes")
    for _, row in notes.iloc[::-1].iterrows():
        st.markdown(f"**{row['month']:%b %Y}** — {row['notes']}")

with st.expander("Monthly data"):
    st.dataframe(
        history[["month", "revenue", "revenue_growth", "burn", "cash", "runway_months", "headcount", "customers", "submitted_on"]]
        .assign(
            month=history["month"].dt.strftime("%b %Y"),
            revenue_growth=history["revenue_growth"].map(ui.pct),
            runway_months=history["runway_months"].map(ui.runway),
            submitted_on=history["submitted_on"].dt.strftime("%d %b %Y"),
        )
        .iloc[::-1],
        hide_index=True,
        width="stretch",
        column_config={
            "month": "Month", "revenue": st.column_config.NumberColumn("MRR ($)", format="compact"),
            "revenue_growth": "MoM growth", "burn": st.column_config.NumberColumn("Net burn ($)", format="compact"),
            "cash": st.column_config.NumberColumn("Cash ($)", format="compact"), "runway_months": "Runway",
            "headcount": "Headcount", "customers": "Customers", "submitted_on": "Submitted",
        },
    )
