"""One company's KPI history, warning signs and founder notes.

The fund team can pick any company. Founders only ever see their own company, which comes from
their account (never from the URL), and don't see the fund's internal warning signs.
"""

import pandas as pd
import streamlit as st

from portfolio import db, metrics, session, ui

user = session.current_user()
companies, derived = ui.load_data()

if user.is_admin:
    if derived.empty:
        st.info("No KPI updates yet.")
        st.stop()
    names = sorted(derived["company"].unique())
    requested = st.query_params.get("company")
    name = st.selectbox("Company", names, index=names.index(requested) if requested in names else 0)
    st.query_params["company"] = name
else:
    name = companies.set_index("id").loc[user.company_id, "name"]
    if name not in set(derived["company"]):
        st.title(name)
        st.info("No figures yet. They'll appear here once you've submitted your first update.")
        st.stop()

history = derived[derived["company"] == name].sort_values("month")
# Figures a partial update request didn't ask for show their last known value.
known = metrics.with_last_known(history)
latest = known.iloc[-1]
info = companies.set_index("name").loc[name]
flags = metrics.company_flags(history, ui.today())
worst = max((f.severity for f in flags), key=metrics.SEVERITIES.index, default="good")

st.title(name)
details = [info["sector"], info["stage"]]
if user.is_admin:  # the fund's position and assessment are internal
    if pd.notna(info["amount_invested"]) and info["amount_invested"]:
        details.append(f"{ui.money(info['amount_invested'])} invested")
    if pd.notna(info["ownership_pct"]) and info["ownership_pct"]:
        details.append(f"{info['ownership_pct']:g}% ownership")
    details.append(ui.STATUS_LABELS[worst])
details.append(f"last report {latest['month']:%b %Y}")
st.caption(" · ".join(d for d in details if d))

# --- Latest numbers -----------------------------------------------------------
prev = known.iloc[-2] if len(known) > 1 else None


def delta(column, fmt):
    """Change since the previous month, formatted; None (no delta shown) when either month is missing."""
    if prev is None or pd.isna(latest[column]) or pd.isna(prev[column]):
        return None
    return fmt(latest[column] - prev[column])


headcount = "–" if pd.isna(latest["headcount"]) else int(latest["headcount"])
growth = None if pd.isna(latest["revenue_growth"]) else ui.pct(latest["revenue_growth"])

c1, c2, c3, c4, c5 = st.columns(5)
c1.metric("MRR", ui.money(latest["revenue"]), growth)
c2.metric("Net burn", ui.money(latest["burn"]), delta("burn", ui.money), delta_color="inverse")
c3.metric("Cash", ui.money(latest["cash"]))
c4.metric("Runway", ui.runway(latest["runway_months"]))
c5.metric("Headcount", headcount, delta("headcount", lambda d: f"{d:+.0f}"))

for f in flags if user.is_admin else []:
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

# --- Custom metrics the fund has requested -------------------------------------
catalogue = db.field_catalogue()
custom = db.load_custom_values()
custom = custom[(custom["company"] == name) & custom["key"].isin(catalogue)]
if not custom.empty:
    st.subheader("Custom metrics")
    numeric = [k for k in custom["key"].unique() if catalogue[k].kind != "text"]
    cols = st.columns(2)
    for i, key in enumerate(numeric):
        field = catalogue[key]
        series = custom[custom["key"] == key].rename(columns={"value_num": "value"})
        latest_value = ui.format_value(field, series["value"].iloc[-1])
        with cols[i % 2]:
            if len(series) < 2:  # a single month is a number, not a trend
                st.metric(field.label, latest_value, help=f"Reported for {series['month'].iloc[-1]:%B %Y}")
                continue
            st.markdown(f"**{ui.md(field.label)}** · latest {ui.md(latest_value)} ({series['month'].iloc[-1]:%b %Y})")
            st.plotly_chart(ui.metric_chart(series, field), width="stretch", theme="streamlit", key=f"chart_{key}")
    for key in (k for k in custom["key"].unique() if catalogue[k].kind == "text"):
        answers = custom[custom["key"] == key].iloc[::-1]
        st.markdown(f"**{ui.md(catalogue[key].label)}**")
        for row in answers.itertuples():
            st.markdown(f"- **{row.month:%b %Y}** — {ui.md(row.value_text)}")

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
