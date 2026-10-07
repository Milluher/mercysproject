"""Fund admin: accounts for the fund team and for founders.

New people get a single-use invite link to choose their own password. The same kind of link
resets a forgotten password. Deactivating an account signs the person out straight away.
"""

import streamlit as st

from portfolio import auth, session, ui

me = session.require_admin()
companies, _ = ui.load_data()
names_by_id = dict(zip(companies["id"], companies["name"]))

st.title("People")
st.caption(
    "Founders sign in to see their own company and answer the fund's requests. They never see other "
    "companies or the fund's warning signs. The fund team sees everything."
)


def show_link(name: str, token: str, reset: bool = False) -> None:
    what = "reset their password" if reset else "choose a password and sign in"
    st.success(f"Send this link to {name} so they can {what}. It works once and expires in "
               f"{auth.INVITE_LIFETIME.days} days. It won't be shown again, but you can make a new one.")
    st.code(ui.invite_link(token), language=None)


# --- Add a person -----------------------------------------------------------------
with st.form("add_person", clear_on_submit=True):
    st.subheader("Add a person")
    col1, col2 = st.columns(2)
    name = col1.text_input("Name")
    email = col2.text_input("Email")
    role = col1.radio("Role", ["founder", "admin"], horizontal=True,
                      format_func={"founder": "Founder", "admin": "Fund team (admin)"}.get)
    company_id = col2.selectbox("Company (founders only)", list(names_by_id), format_func=names_by_id.get,
                                index=None, placeholder="Choose a company")
    if st.form_submit_button("Add and create invite link", type="primary"):
        try:
            user = auth.create_user(email, name, role, company_id if role == "founder" else None)
            st.session_state["new_invite"] = (user.name, auth.create_invite(user.id), False)
        except auth.AuthError as e:
            st.error(str(e))

# Shown outside the form so it survives the form clearing itself.
if "new_invite" in st.session_state:
    show_link(*st.session_state.pop("new_invite"))

# --- Everyone -------------------------------------------------------------------
users = auth.load_users()
for heading, group in (("Founders", users[users["role"] == "founder"]), ("Fund team", users[users["role"] == "admin"])):
    st.subheader(f"{heading} ({int(group['active'].sum())})")
    if group.empty:
        st.caption("No one yet.")
    for u in group.itertuples():
        with st.container(border=True):
            info, status_col, actions = st.columns([4, 3, 3], vertical_alignment="center")
            company = f" · {u.company}" if u.role == "founder" else ""
            you = " (you)" if u.id == me.id else ""
            info.markdown(f"**{u.name}**{you}  \n{u.email}{company}")
            if not u.active:
                status = "⛔ Deactivated"
            elif not u.has_password:
                status = "✉️ Invite not accepted yet"
            elif isinstance(u.last_login, str):
                status = f"✅ Last signed in {u.last_login[:10]}"
            else:
                status = "✅ Active"
            status_col.caption(status)

            with actions:
                b1, b2 = st.columns(2)
                if u.active:
                    label = "Reset link" if u.has_password else "New invite"
                    if b1.button(label, key=f"invite_{u.id}", help="Make a new single-use link; older links stop working"):
                        st.session_state[f"link_{u.id}"] = auth.create_invite(int(u.id))
                    if u.id != me.id and b2.button("Deactivate", key=f"off_{u.id}"):
                        try:
                            auth.set_active(int(u.id), False)
                            st.rerun()
                        except auth.AuthError as e:
                            st.error(str(e))
                elif b1.button("Reactivate", key=f"on_{u.id}"):
                    auth.set_active(int(u.id), True)
                    st.rerun()
            if f"link_{u.id}" in st.session_state:
                show_link(u.name, st.session_state.pop(f"link_{u.id}"), reset=u.has_password)

without_founder = sorted(set(names_by_id) - set(users[(users["role"] == "founder") & users["active"]]["company_id"]))
if without_founder:
    st.caption("Companies with no founder account: " + ", ".join(names_by_id[c] for c in without_founder))
