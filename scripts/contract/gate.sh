#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly ROOT

SCHEMA_DIR="${1:-${ROOT}/contracts/cli}"
PASS_DIR="${2:-${SCHEMA_DIR}/fixtures/pass}"
FAIL_DIR="${3:-${SCHEMA_DIR}/fixtures/fail}"

if [[ ! -d "${SCHEMA_DIR}" ]]; then
  echo "contract-gate: pasta de schema inexistente: ${SCHEMA_DIR}" >&2
  exit 2
fi

export CONTRACT_SCHEMA_DIR="${SCHEMA_DIR}"
export CONTRACT_PASS_DIR="${PASS_DIR}"
export CONTRACT_FAIL_DIR="${FAIL_DIR}"

python3 - <<'PY'
import json
import os
import sys
from pathlib import Path

def matches(instance, schema):
    if "oneOf" in schema:
        return sum(1 for alt in schema["oneOf"] if matches(instance, alt)) == 1
    if "const" in schema:
        return instance == schema["const"]
    if "enum" in schema:
        return instance in schema["enum"]
    expected = schema.get("type")
    if expected == "object":
        if not isinstance(instance, dict):
            return False
        for req in schema.get("required", []):
            if req not in instance:
                return False
        props = schema.get("properties", {})
        additional = schema.get("additionalProperties", True)
        for key, value in instance.items():
            if key in props:
                if not matches(value, props[key]):
                    return False
            elif additional is False:
                return False
        return True
    if expected == "array":
        return isinstance(instance, list)
    if expected == "string":
        return isinstance(instance, str)
    if expected == "integer":
        return isinstance(instance, int) and not isinstance(instance, bool)
    if expected == "boolean":
        return isinstance(instance, bool)
    if expected is None:
        return True
    return False

schema_dir = Path(os.environ["CONTRACT_SCHEMA_DIR"])
schemas = {}
for path in sorted(schema_dir.glob("*.schema.json")):
    schemas[path.name.split(".")[0]] = json.loads(path.read_text(encoding="utf-8"))
if not schemas:
    print("contract-gate: nenhum *.schema.json", file=sys.stderr)
    sys.exit(2)

failures = 0

def schema_for(path: Path):
    name = path.name
    if name.startswith("event"):
        return schemas.get("event")
    if name.startswith("argv"):
        return schemas.get("argv")
    return None

pass_dir = Path(os.environ["CONTRACT_PASS_DIR"])
fail_dir = Path(os.environ["CONTRACT_FAIL_DIR"])

pass_files = sorted(pass_dir.glob("*.json")) if pass_dir.is_dir() else []
fail_files = sorted(fail_dir.glob("*.json")) if fail_dir.is_dir() else []
if not pass_files or not fail_files:
    print("contract-gate: fixtures pass e fail sao obrigatorias", file=sys.stderr)
    sys.exit(1)

for path in pass_files:
    schema = schema_for(path)
    instance = json.loads(path.read_text(encoding="utf-8"))
    if schema is None or not matches(instance, schema):
        print(f"contract-gate: fixture valida recusada: {path}", file=sys.stderr)
        failures += 1

for path in fail_files:
    schema = schema_for(path)
    instance = json.loads(path.read_text(encoding="utf-8"))
    if schema is None or matches(instance, schema):
        print(f"contract-gate: fixture invalida aceita: {path}", file=sys.stderr)
        failures += 1

if failures:
    sys.exit(1)
print("contract-gate: schemas e fixtures de consumidor ok")
PY
