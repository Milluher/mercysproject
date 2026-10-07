from datetime import datetime, timedelta

import pytest

from portfolio import auth, db
from portfolio.auth import AuthError

PASSWORD = "correct horse battery"


@pytest.fixture
def path(tmp_path):
    p = tmp_path / "t.db"
    db.init_db(p)
    return p


@pytest.fixture
def acme(path):
    return db.add_company("Acme", db_path=path)


@pytest.fixture
def founder(path, acme):
    return auth.create_user("Jo@Acme.example ", "Jo  Founder", "founder", acme, password=PASSWORD, db_path=path)


def test_password_hashing():
    stored = auth.hash_password(PASSWORD)
    assert PASSWORD not in stored
    assert auth.verify_password(PASSWORD, stored)
    assert not auth.verify_password("wrong password", stored)
    assert auth.hash_password(PASSWORD) != stored  # salted
    assert not auth.verify_password(PASSWORD, None)
    assert not auth.verify_password(PASSWORD, "garbage")


def test_create_user_normalises_and_validates(path, acme, founder):
    assert founder.email == "jo@acme.example"
    assert founder.name == "Jo Founder"
    assert founder.company_id == acme
    with pytest.raises(AuthError, match="already an account"):
        auth.create_user("JO@acme.example", "Someone", "founder", acme, db_path=path)
    with pytest.raises(AuthError, match="company"):
        auth.create_user("x@y.example", "No company", "founder", db_path=path)
    with pytest.raises(AuthError, match="valid email"):
        auth.create_user("not-an-email", "Bad", "admin", db_path=path)
    with pytest.raises(AuthError, match="at least"):
        auth.create_user("x@y.example", "Short", "admin", password="short", db_path=path)


def test_admin_accounts_have_no_company(path, acme):
    admin = auth.create_user("a@fund.example", "Ann", "admin", acme, password=PASSWORD, db_path=path)
    assert admin.company_id is None and admin.is_admin


def test_authenticate(path, founder):
    user = auth.authenticate("  JO@acme.example", PASSWORD, path)
    assert user == founder
    for email, password in [("jo@acme.example", "wrong password"), ("nobody@x.example", PASSWORD), ("", "")]:
        with pytest.raises(AuthError, match="Incorrect email or password"):
            auth.authenticate(email, password, path)


def test_lockout_after_repeated_failures(path, founder, monkeypatch):
    for _ in range(auth.MAX_FAILED_LOGINS):
        with pytest.raises(AuthError, match="Incorrect"):
            auth.authenticate(founder.email, "wrong password", path)
    with pytest.raises(AuthError, match="Too many failed attempts"):
        auth.authenticate(founder.email, PASSWORD, path)  # even the right password is refused while locked

    later = datetime.now() + auth.LOCKOUT + timedelta(minutes=1)
    monkeypatch.setattr(auth, "_now", lambda: later.replace(microsecond=0))
    assert auth.authenticate(founder.email, PASSWORD, path) == founder


def test_deactivated_user_cannot_log_in_and_is_signed_out(path, founder):
    auth.create_user("a@fund.example", "Ann", "admin", password=PASSWORD, db_path=path)
    auth.set_active(founder.id, False, path)
    assert auth.get_user(founder.id, path) is None
    with pytest.raises(AuthError, match="Incorrect"):
        auth.authenticate(founder.email, PASSWORD, path)
    auth.set_active(founder.id, True, path)
    assert auth.get_user(founder.id, path) == founder


def test_last_admin_cannot_be_deactivated(path):
    admin = auth.create_user("a@fund.example", "Ann", "admin", password=PASSWORD, db_path=path)
    with pytest.raises(AuthError, match="last admin"):
        auth.set_active(admin.id, False, path)
    auth.create_user("b@fund.example", "Bo", "admin", password=PASSWORD, db_path=path)
    auth.set_active(admin.id, False, path)
    assert auth.count_admins(path) == 1


def test_invite_flow(path, acme):
    user = auth.create_user("new@acme.example", "New Founder", "founder", acme, db_path=path)
    with pytest.raises(AuthError):
        auth.authenticate(user.email, PASSWORD, path)  # no password until the invite is accepted

    token = auth.create_invite(user.id, path)
    assert auth.invite_user(token, path) == user
    with pytest.raises(AuthError, match="at least"):
        auth.accept_invite(token, "short", path)
    assert auth.accept_invite(token, PASSWORD, path) == user
    assert auth.authenticate(user.email, PASSWORD, path) == user

    with pytest.raises(AuthError, match="isn't valid"):  # single use
        auth.accept_invite(token, "another password", path)


def test_new_invite_replaces_old_one(path, founder):
    first = auth.create_invite(founder.id, path)
    second = auth.create_invite(founder.id, path)
    with pytest.raises(AuthError, match="isn't valid"):
        auth.invite_user(first, path)
    assert auth.invite_user(second, path) == founder


def test_invite_expires(path, founder, monkeypatch):
    token = auth.create_invite(founder.id, path)
    later = datetime.now() + auth.INVITE_LIFETIME + timedelta(days=1)
    monkeypatch.setattr(auth, "_now", lambda: later.replace(microsecond=0))
    with pytest.raises(AuthError, match="expired"):
        auth.invite_user(token, path)


def test_invite_stops_working_when_account_deactivated(path, founder):
    auth.create_user("a@fund.example", "Ann", "admin", password=PASSWORD, db_path=path)
    token = auth.create_invite(founder.id, path)
    auth.set_active(founder.id, False, path)
    with pytest.raises(AuthError):
        auth.invite_user(token, path)


def test_invite_tokens_are_not_stored(path, founder):
    token = auth.create_invite(founder.id, path)
    with db.connect(path) as conn:
        stored = [r[0] for r in conn.execute("SELECT token_hash FROM invites")]
    assert token not in stored


def test_change_password(path, founder):
    with pytest.raises(AuthError, match="current password"):
        auth.change_password(founder.id, "wrong password", "new password 123", path)
    auth.change_password(founder.id, PASSWORD, "new password 123", path)
    assert auth.authenticate(founder.email, "new password 123", path) == founder


def test_load_users(path, founder):
    auth.create_user("pending@acme.example", "Pending", "founder", founder.company_id, db_path=path)
    users = auth.load_users(path).set_index("email")
    assert users.loc["jo@acme.example", "company"] == "Acme"
    assert users.loc["jo@acme.example", "has_password"]
    assert not users.loc["pending@acme.example", "has_password"]
