"""Portfolio KPI dashboard.

Run with:  streamlit run app.py
"""

import streamlit as st

st.set_page_config(page_title="Portfolio KPIs", page_icon="📊", layout="wide")

st.navigation(
    [
        st.Page("views/overview.py", title="Overview", icon="📊", default=True),
        st.Page("views/company_detail.py", title="Company detail", icon="📈", url_path="company"),
        st.Page("views/submit_update.py", title="Submit update", icon="📝", url_path="submit"),
    ]
).run()
