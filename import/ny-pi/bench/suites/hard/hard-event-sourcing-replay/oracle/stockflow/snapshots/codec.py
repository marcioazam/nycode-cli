"""Snapshot de/para dict JSON-safe (set e tuple viram objetos marcados)."""

from ..errors import InvalidSnapshotError
from .model import AggregateSnapshot, Snapshot

VERSION = 1


def _is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _encode(value):
    if isinstance(value, dict):
        return {key: _encode(item) for key, item in value.items()}
    if isinstance(value, (set, frozenset)):
        return {"__set__": sorted(_encode(item) for item in value)}
    if isinstance(value, tuple):
        return {"__tuple__": [_encode(item) for item in value]}
    if isinstance(value, list):
        return [_encode(item) for item in value]
    return value


def _decode(value):
    if isinstance(value, dict):
        if set(value) == {"__set__"}:
            return {_decode(item) for item in value["__set__"]}
        if set(value) == {"__tuple__"}:
            return tuple(_decode(item) for item in value["__tuple__"])
        return {key: _decode(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_decode(item) for item in value]
    return value


def snapshot_to_dict(snapshot):
    return {
        "version": VERSION,
        "position": snapshot.position,
        "head_event_id": snapshot.head_event_id,
        "projections": list(snapshot.projections),
        "aggregates": {
            aggregate_id: {
                "state": _encode(agg.state),
                "last_sequence": agg.last_sequence,
            }
            for aggregate_id, agg in snapshot.aggregates.items()
        },
    }


def _require(condition, message):
    if not condition:
        raise InvalidSnapshotError(message)


def snapshot_from_dict(data):
    _require(isinstance(data, dict), "snapshot must be an object")
    for key in ("version", "position", "head_event_id", "projections", "aggregates"):
        _require(key in data, "missing key: " + key)
    _require(data["version"] == VERSION and _is_int(data["version"]), "unknown version")
    _require(_is_int(data["position"]) and data["position"] >= 0, "bad position")
    head = data["head_event_id"]
    _require(head is None or isinstance(head, str), "bad head_event_id")
    names = data["projections"]
    _require(
        isinstance(names, list) and all(isinstance(n, str) for n in names),
        "bad projections",
    )
    _require(isinstance(data["aggregates"], dict), "bad aggregates")
    aggregates = {}
    for aggregate_id, raw in data["aggregates"].items():
        _require(
            isinstance(raw, dict) and "state" in raw and "last_sequence" in raw,
            "bad aggregate",
        )
        _require(
            _is_int(raw["last_sequence"]) and raw["last_sequence"] >= 1,
            "bad last_sequence",
        )
        _require(isinstance(raw["state"], dict), "bad state")
        aggregates[aggregate_id] = AggregateSnapshot(
            _decode(raw["state"]), raw["last_sequence"]
        )
    return Snapshot(data["position"], head, tuple(names), aggregates)
