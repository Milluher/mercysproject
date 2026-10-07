"""The form founders fill in.

Opened from a request link (?request=ID&company=ID), it shows the request's title and only the
metrics the fund admin asked for. Without a link, it lists open requests and also offers a
general update with every metric, for the team entering numbers on a founder's behalf.
"""

import streamlit as st

from portfolio import db, ui
from portfolio.fields import DEFAULT_FIELDS

GENERAL = "general"

companies, _ = ui.load_data()
names_by_id = dict(zip(companies["id"], companies["name"]))
requests = {r["id"]: r for r in db.load_requests()}


def query_int(name):
    try:
        return int(st.query_params[name])
    except (KeyError, ValueError):
        return None


request_id = query_int("request")
company_id = query_int("company")
linked = request_id in requests  # opened from a link the admin shared

if not linked:
    if request_id is not None:
        st.warning("That update request no longer exists. Pick another one below.")
    st.title("Submit an update")
    if companies.empty:
        st.info("No portfolio companies yet. Add one on the **Update requests** page.")
        st.stop()
    options = list(requests) + [GENERAL]
    choice = st.selectbox(
        "Which update are you submitting?",
        options,
        format_func=lambda k: "General update (all metrics, any month)" if k == GENERAL
        else f"{requests[k]['title']} · {requests[k]['month']:%b %Y}",
    )
    request_id = None if choice == GENERAL else choice

# --- General update: every metric, any month ---------------------------------
if request_id is None:
    with st.form("general_update"):
        name = st.selectbox("Company", companies["name"])
        month = st.date_input("Reporting month", value=ui.last_month(), max_value=ui.today(),
                              help="Any day in the month works")
        values = ui.metric_inputs(DEFAULT_FIELDS, key_prefix="general_")
        submitted = st.form_submit_button("Submit update", type="primary")
    st.caption("Blank fields keep whatever was already saved for that month.")

    if submitted:
        if all(v is None for v in values.values()):
            st.error("Fill in at least one metric.")
            st.stop()
        cid = int(companies.set_index("name").loc[name, "id"])
        db.upsert_update(cid, month, **values)
        ui.reload_data()
        st.success(f"Saved {name}'s update for {month:%B %Y}.")
        ui.show_new_flags(name)
    st.stop()

# --- Update request: the admin's title and only the requested metrics ---------
request = requests[request_id]
asked = [c for c in request["company_ids"] if c in names_by_id]

if linked:
    st.title(ui.md(request["title"]))
else:
    st.subheader(ui.md(request["title"]))
details = [f"Reporting month: **{request['month']:%B %Y}**"]
if request["due_on"]:
    details.append(f"Due **{request['due_on']:%d %B %Y}**")
st.markdown(" · ".join(details))

if linked and company_id in asked:
    st.markdown(f"Company: **{names_by_id[company_id]}**")
else:
    if linked and company_id is not None:
        st.warning("This link is for a company that wasn't asked for this update. Choose your company below.")
    company_id = st.selectbox("Company", asked, format_func=names_by_id.get)

if company_id in request["responses"]:
    st.info(
        f"Already submitted on {request['responses'][company_id]:%d %B %Y}. "
        "Submitting again replaces those figures."
    )

with st.form(f"request_{request_id}"):
    values = ui.metric_inputs(request["fields"], key_prefix=f"r{request_id}_")
    submitted = st.form_submit_button("Submit", type="primary")

if submitted:
    try:
        db.submit_request_response(request_id, company_id, values)
    except ValueError as e:
        st.error(ui.md(str(e)))
        st.stop()
    ui.reload_data()
    st.success(f"Thanks! {names_by_id[company_id]}'s figures for {request['month']:%B %Y} have been received.")
    if not linked:
        ui.show_new_flags(names_by_id[company_id])
