"""Formatação das saídas da CLI."""


def format_row(name, priority, kind):
    """Linha de `list`: nome, prioridade e tipo separados por TAB."""
    return "%s\t%d\t%s" % (name, priority, kind)  # noqa: UP031


def format_info(info):
    """Bloco de `info`: uma chave por linha."""
    requires = ", ".join(info["requires"]) if info["requires"] else "-"
    return "\n".join(
        [
            "name: {}".format(info["name"]),
            "kind: {}".format(info["kind"]),
            "priority: %d" % info["priority"],  # noqa: UP031
            f"requires: {requires}",
        ]
    )
