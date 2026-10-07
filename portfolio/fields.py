"""The metrics a fund admin can request from portfolio companies.

Built-in metrics live in columns of the `updates` table and drive the dashboard's KPIs and
warning signs. Custom metrics are defined by the admin at runtime; their keys look like
"custom:<id>" and their values live in the `custom_values` table.
"""

from __future__ import annotations

from dataclasses import dataclass

# Types an admin can choose for a custom metric, with the form label suffix each one gets.
CUSTOM_KINDS = {
    "number": ("Number", ""),
    "integer": ("Whole number", ""),
    "percent": ("Percentage", " (%)"),
    "money": ("Money", " ($)"),
    "text": ("Text", ""),
}
NUMERIC_KINDS = {"money", "integer", "number", "percent"}


@dataclass(frozen=True)
class MetricField:
    key: str        # built-in: column name in the updates table; custom: "custom:<id>"
    label: str      # form label shown to founders
    kind: str       # one of CUSTOM_KINDS
    help: str = ""
    allow_negative: bool = False
    required: bool = True   # whether a request for this metric must be answered

    @property
    def custom_id(self) -> int | None:
        return int(self.key.split(":", 1)[1]) if self.key.startswith("custom:") else None


METRIC_FIELDS: dict[str, MetricField] = {
    f.key: f
    for f in [
        MetricField("revenue", "Monthly recurring revenue ($)", "money"),
        MetricField(
            "burn", "Net burn this month ($)", "money",
            help="Cash out minus cash in. Enter a negative number if the company was cash-flow positive.",
            allow_negative=True,
        ),
        MetricField("cash", "Cash in bank at month end ($)", "money"),
        MetricField("headcount", "Headcount (full-time)", "integer"),
        MetricField("customers", "Paying customers", "integer"),
        MetricField("notes", "Highlights, lowlights and asks", "text", required=False),
    ]
}

# What a standard monthly update asks for.
DEFAULT_FIELDS = list(METRIC_FIELDS)


def custom_field(metric_id: int, name: str, kind: str, help: str = "") -> MetricField:
    """The form field for an admin-defined metric. Negative values are allowed (e.g. margins, NPS)."""
    return MetricField(f"custom:{metric_id}", name + CUSTOM_KINDS[kind][1], kind, help or "", allow_negative=True)


def validate_fields(keys: list[str], catalogue: dict[str, MetricField]) -> list[str]:
    """Return the keys in catalogue order, rejecting unknown or empty selections."""
    unknown = set(keys) - set(catalogue)
    if unknown:
        raise ValueError(f"Unknown metric fields: {', '.join(sorted(unknown))}")
    if not keys:
        raise ValueError("Select at least one metric to request")
    return [k for k in catalogue if k in keys]
