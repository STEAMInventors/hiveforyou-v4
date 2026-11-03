"""
Load and transform `hive.study-investigation/1` for provider structured-output APIs.

Evidence $refs are inlined. Recursive `formula` trees are unrolled to a fixed depth
(matching trusted verification `FORMULA_MAX_DEPTH`) without `$defs` or `$ref`, which
Anthropic structured output rejects via LiteLLM.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

STUDY_INVESTIGATION_SCHEMA_ID = "hive.study-investigation/1"
STRUCTURED_OUTPUT_SCHEMA_NAME = "hive_study_investigation_v1"

# Align with packages/contracts/src/analysis/decimal-formula.ts (D-041).
PROVIDER_FORMULA_MAX_DEPTH = 12

_DEFAULT_SCHEMA_PATH = (
    Path(__file__).resolve().parent.parent.parent / "prompts" / "hive-study" / "hive.study-investigation-1.schema.json"
)
_DOCKER_SCHEMA_PATH = Path(__file__).resolve().parent / "schemas" / "hive.study-investigation-1.schema.json"

_SCHEMA_STRIP_META_KEYS = frozenset({"$schema", "$id"})


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
        if key in _SCHEMA_STRIP_META_KEYS:
            continue
        if key in {"title", "description"} and isinstance(value, str):
            continue
        normalized[key] = _normalize_for_provider(value)
    return normalized


def _formula_input_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["input"],
        "properties": {"input": {"type": "integer", "minimum": 0}},
    }


def _formula_value_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["value"],
        "properties": {"value": {"type": "string", "pattern": r"^-?[0-9]+(\.[0-9]+)?$"}},
    }


def _formula_op_schema(arg_schema: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["op", "args"],
        "properties": {
            "op": {"enum": ["+", "-", "*", "/", "min", "max", "round"]},
            "args": {"type": "array", "minItems": 1, "items": arg_schema},
            "places": {"type": "integer", "minimum": 0, "maximum": 6},
        },
    }


def bounded_formula_schema(max_depth: int = PROVIDER_FORMULA_MAX_DEPTH) -> dict[str, Any]:
    """
    Provider-safe formula schema: leaf nodes plus `op` branches down to `max_depth`.

    Depth counting matches `parseFormula` in decimal-formula.ts (each node consumes one
    depth level). Formulas deeper than `max_depth` are rejected by trusted verification
    anyway; they cannot be represented without `$ref` recursion on Anthropic.
    """
    if max_depth < 0:
        raise StudySchemaError("Formula unroll depth must be non-negative")

    def at_depth(remaining_levels: int) -> dict[str, Any]:
        """`remaining_levels` is the max visit depth (1-based) allowed at this subtree root."""
        leaves: list[dict[str, Any]] = [_formula_input_schema(), _formula_value_schema()]
        if remaining_levels <= 1:
            return {"oneOf": leaves}
        child = at_depth(remaining_levels - 1)
        return {"oneOf": leaves + [_formula_op_schema(child)]}

    return at_depth(max_depth)


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


def _substitute_formula_refs(node: Any, formula_schema: dict[str, Any]) -> Any:
    if isinstance(node, list):
        return [_substitute_formula_refs(item, formula_schema) for item in node]
    if not isinstance(node, dict):
        return node
    ref = node.get("$ref")
    if ref == "#/$defs/formula":
        return copy.deepcopy(formula_schema)
    return {key: _substitute_formula_refs(value, formula_schema) for key, value in node.items()}


def schema_uses_defs_or_ref(node: Any) -> bool:
    """True when the schema still contains $defs or $ref (unsupported on Anthropic structured output)."""
    if isinstance(node, list):
        return any(schema_uses_defs_or_ref(item) for item in node)
    if not isinstance(node, dict):
        return False
    if "$defs" in node or "$ref" in node:
        return True
    return any(schema_uses_defs_or_ref(value) for value in node.values())


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

    formula_schema = bounded_formula_schema()
    root = copy.deepcopy({key: value for key, value in raw.items() if key not in {"$schema", "$id", "title", "$defs"}})
    inlined = _inline_evidence_refs(root, evidence)
    if not isinstance(inlined, dict):
        raise StudySchemaError("Schema root must be an object")
    provider_schema = _substitute_formula_refs(inlined, formula_schema)
    if not isinstance(provider_schema, dict):
        raise StudySchemaError("Schema root must be an object")
    if schema_uses_defs_or_ref(provider_schema):
        raise StudySchemaError("Provider schema still contains $defs or $ref after transformation")
    return _normalize_for_provider(provider_schema)


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
