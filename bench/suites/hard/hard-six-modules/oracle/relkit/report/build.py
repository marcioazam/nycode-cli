"""Relatório de release: integra semver, globmatch, manifest, duration, table e money."""

from relkit.core.duration import format_duration, parse_duration
from relkit.core.globmatch import filter_paths
from relkit.core.manifest import parse_manifest
from relkit.core.money import format_money, parse_money, split_money, sum_money
from relkit.core.semver import bump, format_version, max_satisfying, parse_version
from relkit.core.table import render_table
from relkit.errors import ReportError
from relkit.types import Money
from relkit.util.numbers import div_round_half_even, parse_uint
from relkit.util.ordering import stable_sort
from relkit.util.paths import normalize

_HOUR_MS = 3_600_000


def _split_patterns(text):
    """Divide por vírgulas fora de chaves ``{}``; ``\\x`` é literal."""
    parts, current, depth, i = [], [], 0, 0
    while i < len(text):
        ch = text[i]
        if ch == "\\":
            current.append(text[i : i + 2])
            i += 2
            continue
        depth += (ch == "{") - (ch == "}" and depth > 0)
        if ch == "," and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(ch)
        i += 1
    parts.append("".join(current))
    return [p.strip() for p in parts if p.strip()]


def build_report(manifest_text: str, entries, history=()) -> str:
    manifest = parse_manifest(manifest_text)
    name = manifest.get("release.name")
    version = parse_version(manifest.get("release.version"))
    channel = manifest.get("release.channel", "")
    compat = manifest.get("release.compat", "*")
    patterns = _split_patterns(manifest.get("artifacts.include"))
    if not patterns:
        raise ReportError("no include patterns")
    max_name = None
    raw_limit = manifest.get("artifacts.max_name", "")
    if raw_limit:
        max_name = parse_uint(raw_limit)
        if max_name is None or max_name < 2:
            raise ReportError("bad max_name")
    rate = parse_money(manifest.get("cost.rate_per_hour"))

    allowed = set(filter_paths(patterns, [normalize(e.path) for e in entries]))
    chosen = [e for e in entries if normalize(e.path) in allowed]
    if not chosen:
        raise ReportError("no files match")
    chosen = stable_sort(
        chosen, [(lambda e: e.size, True), (lambda e: normalize(e.path), False)]
    )

    rows, costs, total_ms = [], [], 0
    for entry in chosen:
        ms = parse_duration(entry.build)
        cost = Money(div_round_half_even(rate.units * ms, _HOUR_MS), rate.currency)
        total_ms += ms
        costs.append(cost)
        rows.append(
            [
                normalize(entry.path),
                f"{entry.size:,}",
                format_duration(ms),
                format_money(cost),
            ]
        )
    total = sum_money(costs, rate.currency)

    head = f"Release {name} {format_version(version)}" + (
        f" ({channel})" if channel else ""
    )
    nexts = ", ".join(
        f"{part} {format_version(bump(version, part))}"
        for part in ("patch", "minor", "major")
    )
    latest = max_satisfying(list(history), compat)
    lines = [
        head,
        f"Next: {nexts}",
        "Compatible: " + ("none" if latest is None else str(latest)),
        "",
        render_table(
            ["File", "Size", "Build", "Cost"],
            rows,
            "lrrr",
            [max_name, None, None, None],
        ),
        "",
        (
            f"Total: {len(chosen)} files, {sum(e.size for e in chosen):,} bytes, "
            f"{format_duration(total_ms)}, {format_money(total)}"
        ),
    ]
    limit = manifest.get("budget.max_cost", "")
    if limit:
        cap = parse_money(limit)
        if cap.currency != total.currency:
            raise ReportError("budget currency mismatch")
        diff = Money(abs(total.units - cap.units), total.currency)
        lines.append(
            f"OVER BUDGET by {format_money(diff)}"
            if total.units > cap.units
            else f"Within budget: {format_money(diff)} left"
        )
    shares = manifest.get("cost.shares", "")
    if shares:
        weights = [parse_uint(w.strip()) for w in shares.split(":")]
        try:
            if None in weights:
                raise ValueError
            parts = split_money(total, weights)
        except ValueError:
            raise ReportError("bad shares") from None
        lines.append("Shares: " + " / ".join(format_money(p) for p in parts))
    return "\n".join(lines)
