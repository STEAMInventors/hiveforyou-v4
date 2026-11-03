"""
Provider-facing structured-output schema for the `study` task, derived from `hive.study-investigation/1`.

The canonical schema file is unchanged and stays the contract. The provider schema is a compact,
nonrecursive projection of it that keeps only `type`, `properties`, `required`,
`additionalProperties`, `items` and `enum`:

- annotations (`$schema`, `$id`, `title`, `description`) are dropped;
- value constraints (`format`, `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`, `minItems`)
  are dropped and recorded as relaxations;
- `const` becomes a single-value `enum`;
- evidence `$ref`s are inlined;
- the recursive nullable `formula` becomes an optional fixed three-level structure (operation, then
  operation-or-leaf, then leaf) with no `$ref`, `$defs`, `oneOf` or `anyOf`.

Anything else in the canonical schema fails closed with `StudySchemaError`, so a future canonical
change cannot silently send an unreviewed keyword to the provider. Trusted verification
(`verifyStudyInvestigation` in packages/contracts) enforces the complete contract on every output.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

STUDY_INVESTIGATION_SCHEMA_ID = "hive.study-investigation/1"
STRUCTURED_OUTPUT_SCHEMA_NAME = "hive_study_investigation_v1"

PROVIDER_SCHEMA_KEYWORDS = frozenset({"type", "properties", "required", "additionalProperties", "items", "enum"})
ANNOTATION_KEYWORDS = frozenset({"$schema", "$id", "title", "description"})
RELAXED_CONSTRAINT_KEYWORDS = frozenset({"format", "pattern", "minLength", "maxLength", "minimum", "maximum", "minItems"})

# Formula levels the provider schema can express; parseFormula accepts up to FORMULA_MAX_DEPTH (12).
PROVIDER_FORMULA_DEPTH = 3
FORMULA_OPERATORS = ["+", "-", "*", "/", "min", "max", "round"]

_EVIDENCE_REF = "#/$defs/evidence"
_FORMULA_REF = "#/$defs/formula"

_DEFAULT_SCHEMA_PATH = (
    Path(__file__).resolve().parent.parent.parent / "prompts" / "hive-study" / "hive.study-investigation-1.schema.json"
)
_DOCKER_SCHEMA_PATH = Path(__file__).resolve().parent / "schemas" / "hive.study-investigation-1.schema.json"


class StudySchemaError(Exception):
    """Trusted schema preparation failed; do not call the model with a partial schema."""


def _schema_source_path() -> Path:
    if _DOCKER_SCHEMA_PATH.is_file():
        return _DOCKER_SCHEMA_PATH
    return _DEFAULT_SCHEMA_PATH


def shallow_formula_schema() -> dict[str, Any]:
    """
    Formula as root operation -> operation-or-leaf -> leaf. Arity, `round` places, literal syntax and
    input bounds are checked by `parseFormula`; a formula it rejects leaves the calculation UNVERIFIED.
    """
    leaf = {
        "type": "object",
        "additionalProperties": False,
        "properties": {"input": {"type": "integer"}, "value": {"type": "string"}},
    }
    operation_or_leaf = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "op": {"enum": list(FORMULA_OPERATORS)},
            "args": {"type": "array", "items": leaf},
            "places": {"type": "integer"},
            "input": {"type": "integer"},
            "value": {"type": "string"},
        },
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["op", "args"],
        "properties": {
            "op": {"enum": list(FORMULA_OPERATORS)},
            "args": {"type": "array", "items": operation_or_leaf},
            "places": {"type": "integer"},
        },
    }


def _is_nullable_formula(node: dict[str, Any]) -> bool:
    branches = node.get("oneOf")
    return (
        isinstance(branches, list)
        and len(branches) == 2
        and {"type": "null"} in branches
        and {"$ref": _FORMULA_REF} in branches
    )


class _ProviderProjection:
    def __init__(self, evidence_def: dict[str, Any]) -> None:
        self.evidence_def = evidence_def
        self.relaxations: list[dict[str, Any]] = []

    def schema(self, node: Any, path: str) -> dict[str, Any]:
        if not isinstance(node, dict):
            raise StudySchemaError(f"Schema node at {path} is not an object")
        ref = node.get("$ref")
        if ref is not None:
            if ref != _EVIDENCE_REF or len(node) != 1:
                raise StudySchemaError(f"Unsupported $ref at {path}")
            return self.schema(self.evidence_def, path)
        if "oneOf" in node:
            if not _is_nullable_formula(node):
                raise StudySchemaError(f"Unsupported oneOf at {path}")
            self.relaxations.append({"path": path, "keyword": "formula", "value": "nullable recursive formula"})
            return shallow_formula_schema()

        out: dict[str, Any] = {}
        for key, value in node.items():
            if key in ANNOTATION_KEYWORDS:
                continue
            if key in RELAXED_CONSTRAINT_KEYWORDS:
                self.relaxations.append({"path": path, "keyword": key, "value": value})
                continue
            if key == "const":
                out["enum"] = [value]
            elif key == "properties":
                if not isinstance(value, dict):
                    raise StudySchemaError(f"properties at {path} is not an object")
                out["properties"] = {name: self.schema(child, f"{path}.{name}") for name, child in value.items()}
            elif key == "items":
                out["items"] = self.schema(value, f"{path}[]")
            elif key in PROVIDER_SCHEMA_KEYWORDS:
                out[key] = value
            else:
                raise StudySchemaError(f"Unsupported schema keyword {key} at {path}")
        if out.get("type") == "object" and out.get("additionalProperties") is not False:
            raise StudySchemaError(f"Object at {path} must set additionalProperties false")
        return out


def _project(raw: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    if raw.get("$id") != STUDY_INVESTIGATION_SCHEMA_ID:
        raise StudySchemaError("Schema file is not hive.study-investigation/1")
    defs = raw.get("$defs")
    if not isinstance(defs, dict):
        raise StudySchemaError("Schema is missing $defs")
    evidence = defs.get("evidence")
    if not isinstance(evidence, dict) or not isinstance(defs.get("formula"), dict):
        raise StudySchemaError("Schema is missing evidence or formula definitions")
    projection = _ProviderProjection(evidence)
    root = projection.schema({key: value for key, value in raw.items() if key != "$defs"}, "$")
    if schema_uses_defs_or_ref(root):
        raise StudySchemaError("Provider schema still contains $defs or $ref after transformation")
    return root, projection.relaxations


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
    return _project(raw)[0]


def provider_schema_relaxations(raw: dict[str, Any]) -> list[dict[str, Any]]:
    """Every canonical constraint the provider schema omits, as `{path, keyword, value}`."""
    return _project(raw)[1]


def load_canonical_study_investigation_schema() -> dict[str, Any]:
    path = _schema_source_path()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise StudySchemaError(f"Schema file not readable: {path}") from exc
    except json.JSONDecodeError as exc:
        raise StudySchemaError(f"Schema file is not valid JSON: {path}") from exc
    if not isinstance(raw, dict):
        raise StudySchemaError("Schema root must be an object")
    return raw


def load_study_investigation_structured_schema() -> dict[str, Any]:
    return prepare_study_investigation_structured_schema(load_canonical_study_investigation_schema())


def study_json_schema_response_format(schema: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "json_schema",
        "json_schema": {
            "name": STRUCTURED_OUTPUT_SCHEMA_NAME,
            "strict": True,
            "schema": copy.deepcopy(schema),
        },
    }
