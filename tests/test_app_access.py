"""End-to-end access control through the real Streamlit app (Streamlit's AppTest runs app.py)."""

from datetime import date
from pathlib import Path

import pytest
from streamlit.testing.v1 import AppTest

from portfolio import auth, db, seed, ui

ADMIN_EMAIL, ADMIN_PASSWORD = seed.DEMO_ADMIN[1], seed.DEMO_ADMIN[2]
ROOT = Path(__file__).resolve().parent.parent


def view(name: str) -> str:
    return str(ROOT / "views" / f"{name}.py")


@pytest.fixture(scope="module", autouse=True)
def demo_db():
    seed.build_demo_db()  # into the throwaway PORTFOLIO_DB set in conftest.py
    ui.load_data.clear()


def app(**query) -> AppTest:
    at = AppTest.from_file(str(ROOT / "app.py"), default_timeout=60)
    for k, v in query.items():
        at.query_params[k] = str(v)
    return at.run()


def sign_in(at: AppTest, email: str, password: str) -> AppTest:
    inputs = {t.label: t for t in at.text_input}
    inputs["Email"].set_value(email)
    inputs["Password"].set_value(password)
    next(b for b in at.button if b.label == "Sign in").click()
    return at.run()


def registered_pages(at: AppTest) -> set[str]:
    """Page files the signed-in person can reach (switching to any other page raises)."""
    pages = set()
    for page in ["overview", "company_detail", "update_requests", "submit_update", "people", "account"]:
        try:
            at.switch_page(view(page))
            pages.add(page)
        except ValueError:
            pass
    return pages


def text_of(at: AppTest) -> str:
    parts = [e.value for kind in ("title", "subheader", "markdown", "caption", "info", "warning", "success", "error")
             for e in getattr(at, kind)]
    return "\n".join(str(p) for p in parts)


@pytest.mark.parametrize("page", ["overview", "company_detail", "update_requests", "submit_update", "people"])
def test_signed_out_page_urls_show_only_sign_in(page):
    at = AppTest.from_file(str(ROOT / "app.py"), default_timeout=60)
    at.switch_page(view(page)).run()
    assert [t.value for t in at.title] == ["Sign in"]
    assert not at.dataframe and not at.metric
    assert "Lumen Health" not in text_of(at)


def test_signed_out_request_link_asks_to_sign_in_and_keeps_link():
    board_pack = next(r["id"] for r in db.load_requests() if r["title"] == "Q3 board pack")
    at = app(request=board_pack)
    assert [t.value for t in at.title] == ["Sign in"]
    at = sign_in(at, "ravi@cargoline.example", seed.DEMO_FOUNDER_PASSWORD)
    assert at.query_params["request"] == str(board_pack)
    assert [t.value for t in at.title] == ["Q3 board pack"]  # lands on the request it was sent


def test_wrong_password_is_rejected():
    at = sign_in(app(), "ravi@cargoline.example", "not the password")
    assert [e.value for e in at.error] == ["Incorrect email or password"]
    assert [t.value for t in at.title] == ["Sign in"]


def test_founder_only_reaches_their_own_pages():
    at = sign_in(app(), "ravi@cargoline.example", seed.DEMO_FOUNDER_PASSWORD)
    assert not at.exception
    assert registered_pages(at) == {"submit_update", "company_detail", "account"}


def test_founder_company_page_shows_only_their_company_without_fund_assessment():
    at = sign_in(app(), "ravi@cargoline.example", seed.DEMO_FOUNDER_PASSWORD)
    at.switch_page(view("company_detail")).run()
    assert [t.value for t in at.title] == ["Cargoline"]
    assert not at.selectbox  # no way to pick another company
    page = text_of(at)
    assert "Critical" not in page and "% ownership" not in page and "invested" not in page


def test_founder_ignores_company_in_url():
    at = sign_in(app(company="Lumen Health"), "ravi@cargoline.example", seed.DEMO_FOUNDER_PASSWORD)
    at.switch_page(view("company_detail")).run()
    assert [t.value for t in at.title] == ["Cargoline"]


def test_founder_only_sees_requests_for_their_company():
    rid = db.create_request("Lumen only", date(2026, 9, 1), ["revenue"], [1])  # company 1 = Lumen Health
    at = sign_in(app(), "ravi@cargoline.example", seed.DEMO_FOUNDER_PASSWORD)
    options = at.selectbox[0].options
    assert not any("Lumen only" in o for o in options)

    at = sign_in(app(request=rid), "ravi@cargoline.example", seed.DEMO_FOUNDER_PASSWORD)
    assert "isn't for your company" in text_of(at)
    db.delete_request(rid)


def test_founder_submits_for_their_own_company():
    rid = db.create_request("Headcount check", date(2026, 9, 1), ["headcount"], [1, 2])
    at = sign_in(app(request=rid), "ravi@cargoline.example", seed.DEMO_FOUNDER_PASSWORD)
    assert "Company" not in [s.label for s in at.selectbox]  # company comes from the login
    at.number_input[0].set_value(13)
    next(b for b in at.button if b.label == "Submit").click()
    at.run()
    assert "Cargoline" in at.success[0].value
    cargoline = int(db.load_companies().set_index("name").loc["Cargoline", "id"])
    assert list(db.get_request(rid)["responses"]) == [cargoline]
    db.delete_request(rid)


def test_admin_reaches_every_page():
    at = sign_in(app(), ADMIN_EMAIL, ADMIN_PASSWORD)
    assert registered_pages(at) == {"overview", "company_detail", "update_requests", "submit_update", "people", "account"}
    for page in ["overview", "company_detail", "update_requests", "submit_update", "people", "account"]:
        at.switch_page(view(page)).run()
        assert not at.exception, page


def test_invite_link_sets_password_and_signs_in():
    token = auth.create_invite(auth.load_users().set_index("email").loc["kwame@nimbuslearning.example", "id"].item())
    at = app(invite=token)
    assert at.title[0].value == "Welcome, Kwame"
    inputs = {t.label: t for t in at.text_input}
    inputs["New password"].set_value("kwame's new password")
    inputs["Confirm password"].set_value("kwame's new password")
    next(b for b in at.button if b.label == "Set password and sign in").click()
    at.run()
    assert "invite" not in at.query_params
    assert [t.value for t in at.title] == ["Nimbus Learning"]

    at = app(invite=token)  # used up
    assert "isn't valid" in at.error[0].value


def test_deactivated_founder_is_signed_out_on_next_click():
    at = sign_in(app(), "noor@pathwise.example", seed.DEMO_FOUNDER_PASSWORD)
    assert [t.value for t in at.title] == ["Pathwise"]
    noor = auth.load_users().set_index("email").loc["noor@pathwise.example", "id"].item()
    auth.set_active(noor, False)
    at.run()
    assert [t.value for t in at.title] == ["Sign in"]
    auth.set_active(noor, True)


def test_sign_out():
    at = sign_in(app(), ADMIN_EMAIL, ADMIN_PASSWORD)
    next(b for b in at.sidebar.button if b.label == "Sign out").click()
    at.run()
    assert [t.value for t in at.title] == ["Sign in"]
