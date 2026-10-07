"""Fund admin: ask portfolio companies for specific metrics and track who has responded."""

from datetime import date

import pandas as pd
import streamlit as st

from portfolio import db, ui
from portfolio.fields import CUSTOM_KINDS, DEFAULT_FIELDS

companies, _ = ui.load_data()
names_by_id = dict(zip(companies["id"], companies["name"]))
catalogue = db.field_catalogue()

st.title("Update requests")
st.caption(
    "Ask portfolio companies for the metrics you need. The title becomes the title of the form founders fill in, "
    "and they only see the metrics you request."
)

# --- Custom metrics -------------------------------------------------------------
custom = db.load_custom_metrics()
# A fixed label keeps the expander open across reruns (changing it would reset the widget).
with st.expander("Custom metrics"):
    st.caption(
        "Define your own metrics, like gross margin or NPS, to request alongside the built-in ones. "
        "Answers show up in each request's table below and on the company's detail page."
    )
    with st.form("new_custom_metric", clear_on_submit=True):
        col1, col2 = st.columns([3, 2])
        name = col1.text_input("Metric name", placeholder="e.g. Gross margin", max_chars=60)
        kind = col2.selectbox("Type", list(CUSTOM_KINDS), format_func=lambda k: CUSTOM_KINDS[k][0])
        help_text = st.text_input(
            "Note for founders (optional)", placeholder="e.g. Revenue minus cost of goods sold, as a % of revenue"
        )
        if st.form_submit_button("Add metric"):
            try:
                db.add_custom_metric(name, kind, help_text)
            except ValueError as e:
                st.error(ui.md(str(e)))
            else:
                st.rerun()

    for m in custom.itertuples():
        row = st.columns([4, 2, 3, 1], vertical_alignment="center")
        row[0].markdown(f"**{ui.md(catalogue[m.key].label)}**" + (f"  \n{ui.md(m.help)}" if m.help else ""))
        row[1].caption(CUSTOM_KINDS[m.kind][0])
        row[2].caption(f"In {m.requests} request{'s' if m.requests != 1 else ''} · {m.answers} answer{'s' if m.answers != 1 else ''}")
        if not m.requests and not m.answers:
            if row[3].button("Delete", key=f"delete_metric_{m.id}"):
                db.delete_custom_metric(m.id)
                st.rerun()

# --- New request --------------------------------------------------------------
if companies.empty:
    st.info("Add a portfolio company first (bottom of this page).")
else:
    with st.form("new_request", clear_on_submit=True):
        st.subheader("New request")
        title = st.text_input("Title", placeholder=f"{ui.last_month():%B %Y} monthly update", max_chars=120)
        col1, col2 = st.columns(2)
        month = col1.date_input("Reporting month", value=ui.last_month(), help="Any day in the month works")
        due_on = col2.date_input("Due date (optional)", value=None)
        fields = st.multiselect(
            "Metrics to request",
            options=list(catalogue),
            default=DEFAULT_FIELDS,
            format_func=lambda k: catalogue[k].label + (" · custom" if catalogue[k].custom_id else ""),
            help="Add your own metrics under Custom metrics above",
        )
        company_ids = st.multiselect(
            "Companies",
            options=list(names_by_id),
            default=list(names_by_id),
            format_func=names_by_id.get,
        )
        if st.form_submit_button("Create request", type="primary"):
            try:
                db.create_request(title, month, fields, company_ids, due_on)
            except ValueError as e:
                st.error(ui.md(str(e)))
            else:
                st.success(f"Created “{ui.md(title.strip())}”. Share each company's form link from the list below.")

# --- Existing requests --------------------------------------------------------
requests = db.load_requests()
st.subheader("Requests")
if not requests:
    st.info("No update requests yet.")

for r in requests:
    asked = [c for c in r["company_ids"] if c in names_by_id]
    responded = [c for c in asked if c in r["responses"]]
    overdue = r["due_on"] is not None and r["due_on"] < date.today()

    with st.container(border=True):
        head, action = st.columns([5, 1])
        head.markdown(f"#### {ui.md(r['title'])}")
        due = ""
        if r["due_on"]:
            due = f" · due {r['due_on']:%d %b %Y}" + (" (overdue)" if overdue and len(responded) < len(asked) else "")
        head.caption(f"Reporting month {r['month']:%B %Y}{due} · created {r['created_on']:%d %b %Y}")
        with action.popover("Delete"):
            st.write("Delete this request? Figures companies already submitted are kept.")
            if st.button("Delete request", key=f"delete_{r['id']}", type="primary"):
                db.delete_request(r["id"])
                st.rerun()

        fields = [catalogue[k] for k in r["fields"] if k in catalogue]
        st.markdown("**Metrics:** " + ui.md(" · ".join(f.label for f in fields)))
        st.progress(
            len(responded) / len(asked) if asked else 0.0,
            text=f"{len(responded)} of {len(asked)} companies responded",
        )

        def status(cid):
            if cid in r["responses"]:
                return f"✅ Responded {r['responses'][cid]:%d %b}"
            return "⚠️ Overdue" if overdue else "⏳ Waiting"

        # Companies still to respond first, then alphabetical.
        ordered = sorted(asked, key=lambda c: (c in r["responses"], names_by_id[c]))
        answers = db.request_answers(r).reindex(ordered)
        table = pd.DataFrame(
            {
                "Company": [names_by_id[c] for c in ordered],
                "Status": [status(c) for c in ordered],
                # What's on file for the month, so the admin can read the answers here.
                **{f.label: [ui.format_value(f, v) for v in answers[f.key]] for f in fields},
                "Form link": [ui.form_link(r["id"], c) for c in ordered],
            }
        )
        st.dataframe(
            table,
            hide_index=True,
            width="stretch",
            column_config={
                "Form link": st.column_config.LinkColumn(
                    help="Send each founder their own link: it opens the form with their company already selected",
                ),
            },
        )
        pending = [names_by_id[c] for c in asked if c not in r["responses"]]
        if pending:
            st.caption("Still waiting on: " + ", ".join(sorted(pending)))

# --- Companies ----------------------------------------------------------------
with st.expander("Add a portfolio company"):
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
