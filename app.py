"""Portfolio KPI dashboard.

Run with:  streamlit run app.py
"""

import streamlit as st

from portfolio import session, ui

st.set_page_config(page_title="Portfolio KPIs", page_icon="📊", layout="wide")
ui.ensure_db()

user = session.current_user()
if user is None:
    # Not signed in: show only the sign-in screen. No pages are registered, so nothing else is reachable.
    session.sign_in_screen()
    st.stop()

session.sidebar(user)

# Each role only gets its own pages; a founder can't open the fund's pages even by typing their URL.
account = st.Page("views/account.py", title="Account", icon="👤", url_path="account")
if user.is_admin:
    pages = [
        st.Page("views/overview.py", title="Overview", icon="📊", default=True),
        st.Page("views/company_detail.py", title="Company detail", icon="📈", url_path="company"),
        st.Page("views/update_requests.py", title="Update requests", icon="📨", url_path="requests"),
        st.Page("views/submit_update.py", title="Submit update", icon="📝", url_path="submit"),
        st.Page("views/people.py", title="People", icon="🔑", url_path="people"),
        account,
    ]
else:
    pages = [
        st.Page("views/submit_update.py", title="Submit update", icon="📝", url_path="submit", default=True),
        st.Page("views/company_detail.py", title="My company", icon="📈", url_path="company"),
        account,
    ]

st.navigation(pages).run()
