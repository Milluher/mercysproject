"""Who is signed in to this browser session, and the sign-in / invite screens.

The signed-in user's id lives in Streamlit's server-side session state, never in the URL, and the
account is re-read from the database on every page load so deactivation takes effect immediately.
Sessions end when the browser tab is closed or reloaded.
"""

from __future__ import annotations

import streamlit as st

from portfolio import auth

_USER_KEY = "user_id"


def current_user() -> auth.User | None:
    user_id = st.session_state.get(_USER_KEY)
    if user_id is None:
        return None
    user = auth.get_user(user_id)
    if user is None:  # deactivated or deleted since signing in
        sign_out()
    return user


def sign_in(user: auth.User) -> None:
    st.session_state[_USER_KEY] = user.id


def sign_out() -> None:
    st.session_state.pop(_USER_KEY, None)


def require_admin() -> auth.User:
    """Stop the page unless an admin is signed in. Pages call this as well as being hidden from founders."""
    user = current_user()
    if user is None or not user.is_admin:
        st.error("You don't have access to this page.")
        st.stop()
    return user


def sign_in_screen() -> None:
    """Shown instead of the app to anyone not signed in. Handles invite links (?invite=...) too."""
    _, middle, _ = st.columns([1, 2, 1])
    with middle:
        token = st.query_params.get("invite")
        if token:
            _invite_screen(token)
        else:
            _password_screen()


def _password_screen() -> None:
    st.title("Sign in")
    st.caption("Portfolio KPI dashboard")
    if auth.count_admins() == 0:
        st.info(
            "No accounts yet. Create the first fund admin from a terminal:\n\n"
            "`python -m portfolio.auth add-admin`"
        )
        return
    with st.form("sign_in"):
        email = st.text_input("Email", autocomplete="email")
        password = st.text_input("Password", type="password", autocomplete="current-password")
        submitted = st.form_submit_button("Sign in", type="primary", width="stretch")
    if submitted:
        try:
            user = auth.authenticate(email, password)
        except auth.AuthError as e:
            st.error(str(e))
            return
        sign_in(user)
        st.rerun()  # the original link's query parameters (e.g. ?request=3) are kept
    st.caption("Forgotten your password? Ask the fund team for a new sign-in link.")


def _invite_screen(token: str) -> None:
    try:
        user = auth.invite_user(token)
    except auth.AuthError as e:
        st.title("Invite link")
        st.error(str(e))
        if st.button("Go to sign in"):
            del st.query_params["invite"]
            st.rerun()
        return

    st.title(f"Welcome, {user.name.split()[0]}")
    st.write(f"Choose a password for **{user.email}**. You'll use it to sign in from now on.")
    with st.form("accept_invite"):
        password = st.text_input("New password", type="password", autocomplete="new-password",
                                 help=f"At least {auth.MIN_PASSWORD_LENGTH} characters")
        confirm = st.text_input("Confirm password", type="password", autocomplete="new-password")
        submitted = st.form_submit_button("Set password and sign in", type="primary", width="stretch")
    if submitted:
        if password != confirm:
            st.error("The passwords don't match.")
            return
        try:
            user = auth.accept_invite(token, password)
        except auth.AuthError as e:
            st.error(str(e))
            return
        del st.query_params["invite"]  # the link is used up; keep it out of the address bar
        sign_in(user)
        st.rerun()


def sidebar(user: auth.User) -> None:
    with st.sidebar:
        st.caption(f"Signed in as **{user.name}**" + ("" if user.is_admin else " · founder"))
        if st.button("Sign out"):
            sign_out()
            st.query_params.clear()
            st.rerun()
