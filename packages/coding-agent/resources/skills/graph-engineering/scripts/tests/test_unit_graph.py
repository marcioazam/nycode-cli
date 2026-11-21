"""Behavior tests for unit_graph.py through its CLI (subprocess, JSON on stdout)."""
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "unit_graph.py"


def run(*args):
    p = subprocess.run([sys.executable, str(SCRIPT), *map(str, args)], capture_output=True, text=True, timeout=30)
    return p.returncode, json.loads(p.stdout)


def unit(uid, files, after=None, acceptance="ok"):
    u = {"id": uid, "goal": f"goal {uid}", "files": files, "acceptance": acceptance}
    if after is not None:
        u["after"] = after
    return u


def write_units(tmp_path, units):
    p = tmp_path / "units.json"
    p.write_text(json.dumps(units))
    return p


def check(tmp_path, units, *flags):
    return run("check", write_units(tmp_path, units), *flags)


def make_db(tmp_path, nodes, edges):
    """nodes: (id, file_path, qualified_name); edges: (source id, target id, kind, line)."""
    db = tmp_path / "codegraph.db"
    con = sqlite3.connect(db)
    con.execute("create table nodes (id text primary key, file_path text not null, qualified_name text not null)")
    con.execute("create table edges (id integer primary key, source text, target text, kind text, line integer)")
    con.executemany("insert into nodes values (?,?,?)", nodes)
    con.executemany("insert into edges (source, target, kind, line) values (?,?,?,?)", edges)
    con.commit()
    con.close()
    return db


NODES = [("f:a", "src/a.py", "a.fa"), ("f:b", "src/b.py", "b.fb"), ("f:c", "src/c.py", "c.fc")]
UNITS = [unit("A", ["./src//a.py"]), unit("B", ["src/b.py"]), unit("C", ["src/c.py"], acceptance="")]


def test_valid_graph_gives_waves_and_critical_path(tmp_path):
    units = [unit("a", ["a.py"]), unit("b", ["b.py"], ["a"]), unit("c", ["c.py"], ["a"]), unit("d", ["d.py"], ["b", "c"])]
    code, out = check(tmp_path, {"units": units})
    assert code == 0 and out["ok"] and out["errors"] == []
    assert out["waves"] == [["a"], ["b", "c"], ["d"]]
    assert out["critical_path"] == ["a", "b", "d"]
    assert out["width"] == 2


def test_file_in_two_units_is_error_after_normalization(tmp_path):
    code, out = check(tmp_path, [unit("a", ["./src//x.py"]), unit("b", ["src/x.py"])])
    assert code == 1 and not out["ok"]
    assert any("src/x.py" in e and "a" in e and "b" in e for e in out["errors"])


@pytest.mark.parametrize("after, fragment", [(["ghost"], "unknown id ghost"), (["a"], "itself")])
def test_unknown_or_self_after_is_error(tmp_path, after, fragment):
    code, out = check(tmp_path, [unit("a", ["a.py"], after)])
    assert code == 1 and any(fragment in e for e in out["errors"])


def test_cycle_is_reported_with_its_path(tmp_path):
    units = [unit("a", ["a.py"], ["b"]), unit("b", ["b.py"], ["c"]), unit("c", ["c.py"], ["a"])]
    code, out = check(tmp_path, units)
    assert code == 1 and "cycle: a after b after c after a" in out["errors"]
    assert out["waves"] == []


def test_missing_id_files_duplicates_and_max_units(tmp_path):
    units = [{"goal": "x", "files": ["x.py"]}, unit("a", []), unit("a", ["a.py"])]
    code, out = check(tmp_path, units, "--max-units", "2")
    assert code == 1
    for fragment in ("missing id", "missing or invalid files", "duplicate id a", "3 units exceed max 2"):
        assert any(fragment in e for e in out["errors"]), fragment


def test_warnings_for_wide_wave_many_files_and_no_acceptance(tmp_path):
    units = [unit("a", [f"f{i}.py" for i in range(9)]), unit("b", ["b.py"], acceptance=""), unit("c", ["c.py"])]
    code, out = check(tmp_path, units, "--max-writers", "2")
    assert code == 0 and out["width"] == 3
    assert len(out["warnings"]) == 3
    assert any("wave 1 has 3 units" in w for w in out["warnings"])
    assert any("unit a: 9 files" in w for w in out["warnings"])
    assert any("unit b: no acceptance" in w for w in out["warnings"])


def test_suggest_finds_b_after_a_from_calls_edge(tmp_path):
    db = make_db(tmp_path, NODES, [("f:b", "f:a", "calls", 7), ("f:b", "f:a", "imports", 1), ("f:c", "f:a", "contains", 3)])
    code, out = run("suggest", write_units(tmp_path, UNITS), "--db", db)
    assert code == 0 and out["mutual"] == []
    assert out["suggested_after"] == {"B": ["A"]}
    assert out["evidence"] == [{"unit": "B", "after": "A", "edges": 2, "example": "b.fb -> a.fa (src/b.py:7)"}]
    by_id = {u["id"]: u for u in out["units"]}
    assert by_id["B"]["after"] == ["A"] and "after" not in by_id["A"]
    assert by_id["A"]["files"] == ["src/a.py"]


def test_suggest_keeps_existing_after_and_output_feeds_check(tmp_path):
    units = [unit("A", ["src/a.py"]), unit("B", ["src/b.py"], ["C"]), unit("C", ["src/c.py"])]
    db = make_db(tmp_path, NODES, [("f:b", "f:a", "calls", 7)])
    _, out = run("suggest", write_units(tmp_path, units), "--db", db)
    assert {u["id"]: u["after"] for u in out["units"] if "after" in u} == {"B": ["C", "A"]}
    code, checked = check(tmp_path, out["units"])
    assert code == 0 and checked["waves"] == [["A", "C"], ["B"]]


def test_suggest_edges_both_ways_land_in_mutual(tmp_path):
    db = make_db(tmp_path, NODES, [("f:b", "f:a", "calls", 7), ("f:a", "f:b", "references", 9)])
    code, out = run("suggest", write_units(tmp_path, UNITS), "--db", db)
    assert code == 0 and out["suggested_after"] == {} and out["evidence"] == []
    assert len(out["mutual"]) == 1 and out["mutual"][0]["units"] == ["A", "B"]
    assert out["mutual"][0]["edges"] == {"A after B": 1, "B after A": 1}
    assert all("after" not in u for u in out["units"])


def test_suggest_unreferenced_file_is_unindexed(tmp_path):
    db = make_db(tmp_path, NODES[:2], [("f:b", "f:a", "calls", 7)])
    code, out = run("suggest", write_units(tmp_path, UNITS), "--db", db)
    assert code == 0 and out["unindexed"] == ["src/c.py"]


def test_suggest_strips_root_from_absolute_db_paths(tmp_path):
    nodes = [("f:a", "/repo/src/a.py", "a.fa"), ("f:b", "/repo/src/b.py", "b.fb")]
    db = make_db(tmp_path, nodes, [("f:b", "f:a", "extends", None)])
    code, out = run("suggest", write_units(tmp_path, UNITS[:2]), "--db", db, "--root", "/repo")
    assert code == 0 and out["suggested_after"] == {"B": ["A"]}
    assert out["evidence"][0]["example"] == "b.fb -> a.fa (src/b.py)"


def test_invalid_input_exits_2(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("{not json")
    assert run("check", bad)[0] == 2
    assert run("check", tmp_path / "missing.json")[0] == 2
    shape = tmp_path / "shape.json"
    shape.write_text(json.dumps({"units": "nope"}))
    assert run("check", shape)[0] == 2
    code, out = run("suggest", write_units(tmp_path, UNITS), "--db", tmp_path / "none.db")
    assert code == 2 and "no such database" in out["error"]
