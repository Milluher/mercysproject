from datetime import date

import pandas as pd
import pytest

from portfolio import db
from portfolio.fields import METRIC_FIELDS

SEPT = date(2026, 9, 1)


@pytest.fixture
def path(tmp_path):
    p = tmp_path / "t.db"
    db.init_db(p)
    return p


@pytest.fixture
def acme(path):
    return db.add_company("Acme", db_path=path)


def test_custom_metric_joins_the_catalogue(path):
    mid = db.add_custom_metric("  Gross   margin ", "percent", "As % of revenue", db_path=path)
    catalogue = db.field_catalogue(path)
    field = catalogue[f"custom:{mid}"]
    assert field.label == "Gross margin (%)"
    assert field.kind == "percent"
    assert field.help == "As % of revenue"
    assert field.custom_id == mid
    assert list(catalogue)[: len(METRIC_FIELDS)] == list(METRIC_FIELDS)  # built-ins stay first


@pytest.mark.parametrize(
    "name, kind, message",
    [
        ("", "number", "needs a name"),
        ("NPS", "colour", "Unknown metric type"),
        ("Paying customers", "integer", "already a metric"),  # same label as a built-in
    ],
)
def test_custom_metric_validation(path, name, kind, message):
    with pytest.raises(ValueError, match=message):
        db.add_custom_metric(name, kind, db_path=path)


def test_custom_metric_names_are_unique_ignoring_case(path):
    db.add_custom_metric("NPS", "integer", db_path=path)
    with pytest.raises(ValueError, match="already a metric"):
        db.add_custom_metric("nps", "number", db_path=path)


def test_request_with_custom_metrics_round_trip(path, acme):
    margin = db.add_custom_metric("Gross margin", "percent", db_path=path)
    risk = db.add_custom_metric("Biggest risk", "text", db_path=path)
    keys = [f"custom:{margin}", f"custom:{risk}", "cash"]
    rid = db.create_request("Board pack", SEPT, keys, [acme], db_path=path)

    with pytest.raises(ValueError, match="Biggest risk"):  # custom text answers are required
        db.submit_request_response(rid, acme, {keys[0]: 61.5, "cash": 1_000, keys[1]: ""}, db_path=path)

    db.submit_request_response(rid, acme, {keys[0]: 61.5, keys[1]: "Hiring", "cash": 1_000}, db_path=path)
    answers = db.request_answers(db.get_request(rid, path), path).loc[acme]
    assert answers[f"custom:{margin}"] == 61.5
    assert answers[f"custom:{risk}"] == "Hiring"
    assert answers["cash"] == 1_000

    values = db.load_custom_values(path)
    assert set(values["metric"]) == {"Gross margin", "Biggest risk"}
    assert pd.isna(values.set_index("metric").loc["Gross margin", "value_text"])


def test_custom_answers_are_replaced_on_resubmission(path, acme):
    nps = db.add_custom_metric("NPS", "integer", db_path=path)
    rid = db.create_request("NPS check", SEPT, [f"custom:{nps}"], [acme], db_path=path)
    db.submit_request_response(rid, acme, {f"custom:{nps}": 30}, db_path=path)
    db.submit_request_response(rid, acme, {f"custom:{nps}": -10}, db_path=path)  # negative scores are valid
    values = db.load_custom_values(path)
    assert list(values["value_num"]) == [-10]


def test_custom_only_request_does_not_create_empty_kpi_rows(path, acme):
    nps = db.add_custom_metric("NPS", "integer", db_path=path)
    rid = db.create_request("NPS check", SEPT, [f"custom:{nps}"], [acme], db_path=path)
    db.submit_request_response(rid, acme, {f"custom:{nps}": 40}, db_path=path)
    assert db.load_updates(path).empty  # so it can't make reporting look current or hide runway


def test_request_answers_for_company_that_has_not_answered(path, acme):
    other = db.add_company("Other", db_path=path)
    nps = db.add_custom_metric("NPS", "integer", db_path=path)
    rid = db.create_request("NPS check", SEPT, [f"custom:{nps}", "revenue"], [acme, other], db_path=path)
    db.submit_request_response(rid, acme, {f"custom:{nps}": 40, "revenue": 10}, db_path=path)
    db.upsert_update(other, SEPT, revenue=99, db_path=path)  # reported elsewhere, not to this request
    answers = db.request_answers(db.get_request(rid, path), path)
    assert answers.loc[acme, f"custom:{nps}"] == 40
    assert pd.isna(answers.loc[other, f"custom:{nps}"])
    assert pd.isna(answers.loc[other, "revenue"])


def test_metric_without_note_loads_with_empty_help(path):
    db.add_custom_metric("NPS", "integer", db_path=path)
    assert db.load_custom_metrics(path)["help"].tolist() == [""]


def test_delete_custom_metric_only_when_unused(path, acme):
    unused = db.add_custom_metric("Unused", "number", db_path=path)
    used = db.add_custom_metric("Used", "number", db_path=path)
    db.create_request("Uses it", SEPT, [f"custom:{used}"], [acme], db_path=path)

    db.delete_custom_metric(unused, path)
    assert f"custom:{unused}" not in db.field_catalogue(path)
    with pytest.raises(ValueError, match="already used"):
        db.delete_custom_metric(used, path)
