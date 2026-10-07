"""The signed-in person's own account: details and password."""

import streamlit as st

from portfolio import auth, session, ui

user = session.current_user()
companies, _ = ui.load_data()

st.title("Account")
role = "Fund team (admin)" if user.is_admin else f"Founder · {companies.set_index('id').loc[user.company_id, 'name']}"
st.markdown(f"**{user.name}**  \n{user.email}  \n{role}")

with st.form("change_password", clear_on_submit=True):
    st.subheader("Change password")
    current = st.text_input("Current password", type="password", autocomplete="current-password")
    new = st.text_input("New password", type="password", autocomplete="new-password",
                        help=f"At least {auth.MIN_PASSWORD_LENGTH} characters")
    confirm = st.text_input("Confirm new password", type="password", autocomplete="new-password")
    if st.form_submit_button("Change password"):
        if new != confirm:
            st.error("The new passwords don't match.")
        else:
            try:
                auth.change_password(user.id, current, new)
            except auth.AuthError as e:
                st.error(str(e))
            else:
                st.success("Password changed.")
