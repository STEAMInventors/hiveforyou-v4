from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import jsonschema
import pytest

from study_investigation_schema import (
    PROVIDER_FORMULA_MAX_DEPTH,
    STUDY_INVESTIGATION_SCHEMA_ID,
    StudySchemaError,
    bounded_formula_schema,
    load_study_investigation_structured_schema,
    prepare_study_investigation_structured_schema,
    schema_uses_defs_or_ref,
)

_CANONICAL_SCHEMA_PATH = (
    Path(__file__).resolve().parent.parent.parent / "prompts" / "hive-study" / "hive.study-investigation-1.schema.json"
)


def _load_canonical_raw() -> dict[str, Any]:
    return json.loads(_CANONICAL_SCHEMA_PATH.read_text(encoding="utf-8"))


def _minimal_valid_study(*, formula: object | None = None) -> dict[str, Any]:
    evidence = {
        "sourceDocumentId": "00000000-0000-4000-8000-000000000002",
        "pageNumber": 1,
        "quote": "Synthetic quote for schema validation.",
    }
    calculation: dict[str, Any] = {
        "description": "Synthetic calculation",
        "inputs": [{"label": "A", "valueAsWritten": "10", "evidence": [evidence]}],
        "arithmetic": "10 - 3",
        "result": "7",
    }
    if formula is not None:
        calculation["formula"] = formula
    return {
        "schema": STUDY_INVESTIGATION_SCHEMA_ID,
        "processingRunId": "00000000-0000-4000-8000-000000000001",
        "answers": [
            {
                "planQuestionId": "P1",
                "status": "ANSWERED",
                "answer": "Synthetic answer.",
                "facts": [],
                "calculations": [calculation],
                "assessments": [],
                "uncertainties": [],
                "professionalDeterminations": [],
                "evidence": [],
                "conflicts": [],
                "limitations": [],
            }
        ],
        "coverageNotes": [],
        "instructionsIgnored": [],
    }


def _deep_formula(depth: int) -> dict[str, Any]:
    node: dict[str, Any] = {"value": "1"}
    for _ in range(depth - 1):
        node = {"op": "+", "args": [node, {"value": "0"}]}
    return node


def test_transformed_schema_has_no_defs_or_ref() -> None:
    schema = load_study_investigation_structured_schema()
    assert schema_uses_defs_or_ref(schema) is False
    assert schema["type"] == "object"
    assert schema["properties"]["schema"]["enum"] == [STUDY_INVESTIGATION_SCHEMA_ID]
    assert schema["required"] == [
        "schema",
        "processingRunId",
        "answers",
        "coverageNotes",
        "instructionsIgnored",
    ]


def test_evidence_refs_are_inlined() -> None:
    schema = load_study_investigation_structured_schema()
    facts_items = schema["properties"]["answers"]["items"]["properties"]["facts"]["items"]
    evidence = facts_items["properties"]["evidence"]["items"]
    assert evidence["type"] == "object"
    assert evidence["required"] == ["sourceDocumentId", "pageNumber", "quote"]
    assert schema_uses_defs_or_ref(evidence) is False


def test_formula_is_bounded_unroll_not_recursive_ref() -> None:
    schema = load_study_investigation_structured_schema()
    formula = schema["properties"]["answers"]["items"]["properties"]["calculations"]["items"]["properties"][
        "formula"
    ]["oneOf"][1]
    assert formula == bounded_formula_schema()
    assert schema_uses_defs_or_ref(formula) is False


def test_bounded_formula_depth_matches_verification_cap() -> None:
    assert PROVIDER_FORMULA_MAX_DEPTH == 12
    shallow = bounded_formula_schema(2)
    assert len(shallow["oneOf"]) == 3
    leaf_only = bounded_formula_schema(1)
    assert len(leaf_only["oneOf"]) == 2


def test_provider_schema_validates_minimal_study_output() -> None:
    schema = load_study_investigation_structured_schema()
    instance = _minimal_valid_study(
        formula={"op": "-", "args": [{"input": 0}, {"value": "3"}]},
    )
    jsonschema.validate(instance=instance, schema=schema)


def test_provider_schema_rejects_formula_deeper_than_unroll_depth() -> None:
    schema = load_study_investigation_structured_schema()
    too_deep = _minimal_valid_study(formula=_deep_formula(PROVIDER_FORMULA_MAX_DEPTH + 1))
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(instance=too_deep, schema=schema)


def test_provider_schema_accepts_formula_at_max_unroll_depth() -> None:
    schema = load_study_investigation_structured_schema()
    at_max = _minimal_valid_study(formula=_deep_formula(PROVIDER_FORMULA_MAX_DEPTH))
    jsonschema.validate(instance=at_max, schema=schema)


def test_canonical_schema_file_still_uses_recursive_formula_def() -> None:
    raw = _load_canonical_raw()
    assert raw["$id"] == STUDY_INVESTIGATION_SCHEMA_ID
    formula_def = raw["$defs"]["formula"]
    assert json.dumps(formula_def).count("#/$defs/formula") >= 1
    calc = raw["properties"]["answers"]["items"]["properties"]["calculations"]["items"]
    assert "description" in calc["properties"]
    assert "description" in calc["required"]


def test_prepare_rejects_missing_defs() -> None:
    raw = _load_canonical_raw()
    del raw["$defs"]
    with pytest.raises(StudySchemaError, match="missing"):
        prepare_study_investigation_structured_schema(raw)
