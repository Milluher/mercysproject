"""The metrics a fund admin can request from portfolio companies."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class MetricField:
    key: str        # column name in the updates table
    label: str      # form label shown to founders
    kind: str       # "money", "integer" or "text"
    help: str = ""
    allow_negative: bool = False


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
        MetricField("notes", "Highlights, lowlights and asks", "text"),
    ]
}

# What a standard monthly update asks for.
DEFAULT_FIELDS = list(METRIC_FIELDS)


def validate_fields(keys: list[str]) -> list[str]:
    """Return the keys in catalogue order, rejecting unknown or empty selections."""
    unknown = set(keys) - set(METRIC_FIELDS)
    if unknown:
        raise ValueError(f"Unknown metric fields: {', '.join(sorted(unknown))}")
    if not keys:
        raise ValueError("Select at least one metric to request")
    return [k for k in METRIC_FIELDS if k in keys]
