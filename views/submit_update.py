"""The form for submitting figures.

Founders see the requests sent to their company and can only ever submit for that company, which
comes from their account rather than the URL. The fund team can submit for any company, either
answering a request or entering a general update with every metric.

A request link (?request=ID) opens that request directly, after signing in if needed.
"""

import streamlit as st

from portfolio import db, session, ui

GENERAL = "general"

user = session.current_user()
companies, _ = ui.load_data()
names_by_id = dict(zip(companies["id"], companies["name"]))
catalogue = db.field_catalogue()
requests = {r["id"]: r for r in db.load_requests()}
if not user.is_admin:
    requests = {i: r for i, r in requests.items() if user.company_id in r["company_ids"]}


def query_int(name):
    try:
        return int(st.query_params[name])
    except (KeyError, ValueError):
        return None


linked_id = query_int("request")
request_id = linked_id if linked_id in requests else None
if linked_id is not None and request_id is None:
    st.warning("That request link isn't for your company or no longer exists." if not user.is_admin
               else "That update request no longer exists.")

linked = request_id is not None  # opened from a request link: the request's title is the page title

if not linked:
    if user.is_admin:
        st.title("Submit an update")
    else:
        st.title(names_by_id[user.company_id])
        st.caption("Updates the fund has asked you for")

if request_id is None:
    if user.is_admin:
        options = list(requests) + [GENERAL]
    else:
        # Requests still waiting for this company's answer first.
        options = sorted(requests, key=lambda i: (user.company_id in requests[i]["responses"], -i)) + [GENERAL]
    if user.is_admin and companies.empty:
        st.info("No portfolio companies yet. Add one on the **Update requests** page.")
        st.stop()

    def describe(k):
        if k == GENERAL:
            return "General update (any metrics, any month)"
        r = requests[k]
        done = " ✅ submitted" if not user.is_admin and user.company_id in r["responses"] else ""
        return f"{r['title']} · {r['month']:%b %Y}{done}"

    if not user.is_admin and len(options) == 1:
        st.info("The fund hasn't asked you for anything right now. You can still send a general update below.")
    request_id = st.selectbox("Which update are you submitting?", options, format_func=describe)
    if request_id == GENERAL:
        request_id = None

# --- General update: any metrics, any month ----------------------------------
if request_id is None:
    with st.form("general_update"):
        if user.is_admin:
            name = st.selectbox("Company", companies["name"])
            company_id = int(companies.set_index("name").loc[name, "id"])
        else:
            company_id, name = user.company_id, names_by_id[user.company_id]
        month = st.date_input("Reporting month", value=ui.last_month(), max_value=ui.today(),
                              help="Any day in the month works")
        values = ui.metric_inputs(list(catalogue.values()), key_prefix="general_", optional=True)
        submitted = st.form_submit_button("Submit update", type="primary")
    st.caption("Blank fields keep whatever was already saved for that month.")

    if submitted:
        if all(v is None for v in values.values()):
            st.error("Fill in at least one metric.")
            st.stop()
        db.save_values(company_id, month, values)
        ui.reload_data()
        st.success(f"Saved {name}'s update for {month:%B %Y}.")
        if user.is_admin:
            ui.show_new_flags(name)
    st.stop()

# --- Update request: the admin's title and only the requested metrics ---------
request = requests[request_id]
asked = [c for c in request["company_ids"] if c in names_by_id]

(st.title if linked else st.subheader)(ui.md(request["title"]))
details = [f"Reporting month: **{request['month']:%B %Y}**"]
if not user.is_admin:
    details.insert(0, f"**{names_by_id[user.company_id]}**")
if request["due_on"]:
    details.append(f"Due **{request['due_on']:%d %B %Y}**")
st.markdown(" · ".join(details))

if user.is_admin:
    company_id = st.selectbox("Company", asked, format_func=names_by_id.get)
else:
    company_id = user.company_id

if company_id in request["responses"]:
    st.info(
        f"Already submitted on {request['responses'][company_id]:%d %B %Y}. "
        "Submitting again replaces those figures."
    )

with st.form(f"request_{request_id}"):
    fields = [catalogue[k] for k in request["fields"] if k in catalogue]
    values = ui.metric_inputs(fields, key_prefix=f"r{request_id}_")
    submitted = st.form_submit_button("Submit", type="primary")

if submitted:
    try:
        db.submit_request_response(request_id, company_id, values)
    except ValueError as e:
        st.error(ui.md(str(e)))
        st.stop()
    ui.reload_data()
    st.success(f"Thanks! {names_by_id[company_id]}'s figures for {request['month']:%B %Y} have been received.")
    if user.is_admin:
        ui.show_new_flags(names_by_id[company_id])
