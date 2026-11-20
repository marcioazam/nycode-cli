"""Serialização do relatório para dict/JSON."""

import json

from ledger.report.builder import Line
from ledger.report.summary import Totals


def to_dict(lines: list[Line], totals: Totals) -> dict:
    return {
        "lines": [
            {
                "id": l.entry_id,
                "kind": l.kind,
                "net": str(l.net),
                "tax": str(l.tax),
                "gross": str(l.gross),
            }
            for l in lines
        ],
        "totals": {
            "net": str(totals.net),
            "tax": str(totals.tax),
            "gross": str(totals.gross),
        },
    }


def to_json(lines: list[Line], totals: Totals) -> str:
    return json.dumps(to_dict(lines, totals), sort_keys=True)
