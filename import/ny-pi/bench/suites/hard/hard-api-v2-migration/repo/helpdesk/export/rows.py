"""Linhas tabulares."""

HEADER = ["id", "priority", "status", "tier", "assignee", "created", "tags"]


def to_rows(tickets):
    """Cabeçalho mais uma linha por ticket; tags unidas por ";", sem responsável vira ""."""
    rows = [list(HEADER)]
    for t in tickets:
        rows.append(
            [
                t["id"],
                t["priority"],
                t["status"],
                t["customer"]["tier"],
                t["assignee"] or "",
                t["created"],
                ";".join(t["tags"]),
            ]
        )
    return rows
