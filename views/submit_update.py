"""Monthly KPI form for founders (or the analyst entering numbers on their behalf)."""

from datetime import date

import streamlit as st

from portfolio import db, metrics, ui


companies, _ = ui.load_data()

st.title("Submit a monthly update")
st.caption("Enter the numbers for one month. Submitting the same month again replaces the earlier figures.")

with st.expander("Add a new portfolio company"):
    with st.form("new_company", clear_on_submit=True):
        new_name = st.text_input("Company name")
        col1, col2 = st.columns(2)
        sector = col1.text_input("Sector")
        stage = col2.selectbox("Stage", ["Pre-seed", "Seed", "Series A", "Series B", "Series C+"])
        invested = col1.number_input("Amount invested ($)", min_value=0.0, step=50_000.0, format="%.0f")
        ownership = col2.number_input("Ownership (%)", min_value=0.0, max_value=100.0, step=0.5)
        invested_on = st.date_input("Investment date", value=date.today())
        if st.form_submit_button("Add company"):
            if not new_name.strip():
                st.error("Company name is required.")
            elif new_name.strip() in set(companies["name"]):
                st.error(f"{new_name.strip()} is already in the portfolio.")
            else:
                db.add_company(new_name.strip(), sector.strip(), stage, invested_on, invested or None, ownership or None)
                ui.reload_data()
                st.success(f"Added {new_name.strip()}.")
                st.rerun()

if companies.empty:
    st.info("Add a company above first.")
    st.stop()

last_month = (date.today().replace(day=1) - date.resolution).replace(day=1)

with st.form("update"):
    name = st.selectbox("Company", companies["name"])
    month = st.date_input("Reporting month", value=last_month, max_value=date.today(), help="Any day in the month works")
    col1, col2 = st.columns(2)
    revenue = col1.number_input("Monthly recurring revenue ($)", min_value=0.0, step=1_000.0, format="%.0f")
    burn = col2.number_input(
        "Net burn this month ($)", step=1_000.0, format="%.0f",
        help="Cash out minus cash in. Enter a negative number if the company was cash-flow positive.",
    )
    cash = col1.number_input("Cash in bank at month end ($)", min_value=0.0, step=10_000.0, format="%.0f")
    headcount = col2.number_input("Headcount (full-time)", min_value=0, step=1)
    customers = col1.number_input("Paying customers", min_value=0, step=1)
    notes = st.text_area("Highlights, lowlights and asks", placeholder="Key wins, risks, and where the fund can help")
    submitted = st.form_submit_button("Submit update", type="primary")

if submitted:
    if revenue == 0 and burn == 0 and cash == 0:
        st.error("Please fill in at least revenue, burn and cash.")
        st.stop()
    company_id = int(companies.set_index("name").loc[name, "id"])
    db.upsert_update(company_id, month, revenue, burn, cash, int(headcount), int(customers), notes.strip())
    ui.reload_data()
    st.success(f"Saved {name}'s update for {month:%B %Y}.")

    _, derived = ui.load_data()
    history = derived[derived["company"] == name]
    flags = metrics.company_flags(history, ui.today())
    if flags:
        st.markdown("**This update raises the following warning signs:**")
        for f in flags:
            st.warning(f"{ui.STATUS_LABELS[f.severity]} — {f.metric}: {f.message}")
    else:
        st.markdown(f"No warning signs for {name}. Runway: **{ui.runway(history.iloc[-1]['runway_months'])}**.")
