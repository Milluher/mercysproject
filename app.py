"""Portfolio KPI dashboard.

Run with:  streamlit run app.py
"""

import streamlit as st

st.set_page_config(page_title="Portfolio KPIs", page_icon="📊", layout="wide")

# Founders arrive through a request link; show them just their form, without the fund's pages
# in the sidebar. This is presentation only, not access control.
founder_link = "request" in st.query_params

st.navigation(
    [
        st.Page("views/overview.py", title="Overview", icon="📊", default=True),
        st.Page("views/company_detail.py", title="Company detail", icon="📈", url_path="company"),
        st.Page("views/update_requests.py", title="Update requests", icon="📨", url_path="requests"),
        st.Page("views/submit_update.py", title="Submit update", icon="📝", url_path="submit"),
    ],
    position="hidden" if founder_link else "sidebar",
).run()
