"""
Load and transform `hive.study-investigation/1` for provider structured-output APIs.

Evidence $refs are inlined. The recursive `formula` tree stays under `$defs` with internal
$refs preserved, matching Anthropic/LiteLLM JSON Schema expectations.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

STUDY_INVESTIGATION_SCHEMA_ID = "hive.study-investigation/1"
STRUCTURED_OUTPUT_SCHEMA_NAME = "hive_study_investigation_v1"

_DEFAULT_SCHEMA_PATH = (
    Path(__file__).resolve().parent.parent.parent / "prompts" / "hive-study" / "hive.study-investigation-1.schema.json"
)
_DOCKER_SCHEMA_PATH = Path(__file__).resolve().parent / "schemas" / "hive.study-investigation-1.schema.json"

_SCHEMA_STRIP_KEYS = frozenset({"$schema", "$id", "title", "description"})


class StudySchemaError(Exception):
    """Trusted schema preparation failed; do not call the model with a partial schema."""


def _schema_source_path() -> Path:
    if _DOCKER_SCHEMA_PATH.is_file():
        return _DOCKER_SCHEMA_PATH
    return _DEFAULT_SCHEMA_PATH


def _normalize_for_provider(node: Any) -> Any:
    if isinstance(node, list):
        return [_normalize_for_provider(item) for item in node]
    if not isinstance(node, dict):
        return node
    if "const" in node and len(node) == 1:
        return {"enum": [node["const"]]}
    normalized: dict[str, Any] = {}
    for key, value in node.items():
        if key in _SCHEMA_STRIP_KEYS:
            continue
        normalized[key] = _normalize_for_provider(value)
    return normalized


def _inline_evidence_refs(node: Any, evidence_def: dict[str, Any]) -> Any:
    if isinstance(node, list):
        return [_inline_evidence_refs(item, evidence_def) for item in node]
    if not isinstance(node, dict):
        return node
    ref = node.get("$ref")
    if ref == "#/$defs/evidence":
        return _normalize_for_provider(copy.deepcopy(evidence_def))
    if ref == "#/$defs/formula":
        return {"$ref": "#/$defs/formula"}
    return {key: _inline_evidence_refs(value, evidence_def) for key, value in node.items()}


def prepare_study_investigation_structured_schema(raw: dict[str, Any]) -> dict[str, Any]:
    if raw.get("$id") != STUDY_INVESTIGATION_SCHEMA_ID:
        schema_const = raw.get("properties", {})
        if not isinstance(schema_const, dict):
            raise StudySchemaError("Schema file is not hive.study-investigation/1")
        inner = schema_const.get("schema", {})
        if not isinstance(inner, dict) or inner.get("const") != STUDY_INVESTIGATION_SCHEMA_ID:
            raise StudySchemaError("Schema file is not hive.study-investigation/1")
    defs = raw.get("$defs")
    if not isinstance(defs, dict):
        raise StudySchemaError("Schema is missing $defs")
    evidence = defs.get("evidence")
    formula = defs.get("formula")
    if not isinstance(evidence, dict) or not isinstance(formula, dict):
        raise StudySchemaError("Schema is missing evidence or formula definitions")
    root = copy.deepcopy({key: value for key, value in raw.items() if key not in {"$schema", "$id", "title", "$defs"}})
    inlined = _inline_evidence_refs(root, evidence)
    if not isinstance(inlined, dict):
        raise StudySchemaError("Schema root must be an object")
    inlined["$defs"] = {"formula": _normalize_for_provider(copy.deepcopy(formula))}
    return _normalize_for_provider(inlined)


def load_study_investigation_structured_schema() -> dict[str, Any]:
    path = _schema_source_path()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise StudySchemaError(f"Schema file not readable: {path}") from exc
    except json.JSONDecodeError as exc:
        raise StudySchemaError(f"Schema file is not valid JSON: {path}") from exc
    if not isinstance(raw, dict):
        raise StudySchemaError("Schema root must be an object")
    return prepare_study_investigation_structured_schema(raw)


def study_json_schema_response_format(schema: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "json_schema",
        "json_schema": {
            "name": STRUCTURED_OUTPUT_SCHEMA_NAME,
            "strict": True,
            "schema": schema,
        },
    }
