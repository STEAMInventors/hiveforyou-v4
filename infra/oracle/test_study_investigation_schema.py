from __future__ import annotations

import copy
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import jsonschema
import pytest

from study_investigation_schema import (
    PROVIDER_FORMULA_DEPTH,
    PROVIDER_SCHEMA_KEYWORDS,
    STUDY_INVESTIGATION_SCHEMA_ID,
    StudySchemaError,
    load_study_investigation_structured_schema,
    prepare_study_investigation_structured_schema,
    provider_schema_relaxations,
    schema_uses_defs_or_ref,
    shallow_formula_schema,
)

_CANONICAL_SCHEMA_PATH = (
    Path(__file__).resolve().parent.parent.parent / "prompts" / "hive-study" / "hive.study-investigation-1.schema.json"
)
_CALCULATION_PATH = "$.answers[].calculations[]"
_FORMULA_PATH = f"{_CALCULATION_PATH}.formula"
_EVIDENCE_SITES = (
    "$.answers[].facts[].evidence[]",
    "$.answers[].calculations[].inputs[].evidence[]",
    "$.answers[].assessments[].criterionEvidence[]",
    "$.answers[].evidence[]",
    "$.answers[].conflicts[].evidence[]",
)


def _load_canonical_raw() -> dict[str, Any]:
    return json.loads(_CANONICAL_SCHEMA_PATH.read_text(encoding="utf-8"))


def _canonical_validator() -> jsonschema.Draft202012Validator:
    return jsonschema.Draft202012Validator(
        _load_canonical_raw(), format_checker=jsonschema.Draft202012Validator.FORMAT_CHECKER
    )


def _evidence(**overrides: Any) -> dict[str, Any]:
    return {
        "sourceDocumentId": "00000000-0000-4000-8000-000000000002",
        "pageNumber": 1,
        "quote": "Synthetic quote for schema validation.",
    } | overrides


def _study(*, formula: object | None = None) -> dict[str, Any]:
    calculation: dict[str, Any] = {
        "description": "Synthetic calculation",
        "inputs": [
            {"label": "A", "valueAsWritten": "10", "evidence": [_evidence()]},
            {"label": "B", "valueAsWritten": "4", "evidence": [_evidence()]},
        ],
        "arithmetic": "10 / 4 * 100",
        "result": "250",
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
                "facts": [{"statement": "Synthetic fact.", "evidence": [_evidence()]}],
                "calculations": [calculation],
                "assessments": [
                    {
                        "judgment": "Synthetic judgment.",
                        "criterion": "Synthetic criterion.",
                        "criterionSource": "GENERAL_KNOWLEDGE",
                        "criterionEvidence": [],
                        "factIndexes": [0],
                        "reasoning": "Synthetic reasoning.",
                        "strength": "MODERATE",
                        "wouldChangeIf": [],
                    }
                ],
                "uncertainties": [],
                "professionalDeterminations": [
                    {"determination": "Synthetic determination.", "bearingFacts": [0], "decidedBy": "Professional"}
                ],
                "evidence": [_evidence()],
                "conflicts": [{"description": "Synthetic conflict.", "evidence": [_evidence(), _evidence(pageNumber=2)]}],
                "limitations": [],
            }
        ],
        "coverageNotes": [],
        "instructionsIgnored": [
            {"sourceDocumentId": "00000000-0000-4000-8000-000000000002", "pageNumber": 1, "description": "Synthetic."}
        ],
    }


def _percentage_formula() -> dict[str, Any]:
    return {"op": "*", "args": [{"op": "/", "args": [{"input": 0}, {"input": 1}]}, {"value": "100"}]}


def _schema_nodes(node: dict[str, Any], path: str = "$") -> list[tuple[str, dict[str, Any]]]:
    """All schema nodes with JSON-path-like locations; property names are never treated as keywords."""
    found = [(path, node)]
    for name, child in node.get("properties", {}).items():
        found.extend(_schema_nodes(child, f"{path}.{name}"))
    if isinstance(node.get("items"), dict):
        found.extend(_schema_nodes(node["items"], f"{path}[]"))
    return found


def _canonical_shape(node: dict[str, Any], defs: dict[str, Any]) -> dict[str, Any]:
    """Canonical structure (types, properties, required, enums) with evidence refs resolved."""
    if node.get("$ref") == "#/$defs/evidence":
        node = defs["evidence"]
    shape: dict[str, Any] = {}
    if "type" in node:
        shape["type"] = node["type"]
    if "const" in node:
        shape["enum"] = [node["const"]]
    if "enum" in node:
        shape["enum"] = node["enum"]
    if "required" in node:
        shape["required"] = node["required"]
    if "properties" in node:
        shape["properties"] = {name: _canonical_shape(child, defs) for name, child in node["properties"].items()}
    if "items" in node:
        shape["items"] = _canonical_shape(node["items"], defs)
    return shape


def _provider_shape(node: dict[str, Any]) -> dict[str, Any]:
    shape = {key: node[key] for key in ("type", "enum", "required") if key in node}
    if "properties" in node:
        shape["properties"] = {name: _provider_shape(child) for name, child in node["properties"].items()}
    if "items" in node:
        shape["items"] = _provider_shape(node["items"])
    return shape


def _calculation_schema(schema: dict[str, Any]) -> dict[str, Any]:
    return schema["properties"]["answers"]["items"]["properties"]["calculations"]["items"]


# --- Provider compatibility -------------------------------------------------------------------


def test_provider_schema_uses_only_allowlisted_keywords() -> None:
    schema = load_study_investigation_structured_schema()
    assert schema_uses_defs_or_ref(schema) is False
    for path, node in _schema_nodes(schema):
        assert set(node) <= PROVIDER_SCHEMA_KEYWORDS, path
        assert not isinstance(node.get("type"), list), path


def test_every_provider_object_is_closed() -> None:
    schema = load_study_investigation_structured_schema()
    objects = [(path, node) for path, node in _schema_nodes(schema) if node.get("type") == "object"]
    assert len(objects) >= 15
    for path, node in objects:
        assert node.get("additionalProperties") is False, path


def test_provider_schema_is_compact() -> None:
    schema = load_study_investigation_structured_schema()
    nodes = _schema_nodes(schema)
    optional = sum(
        len([name for name in node.get("properties", {}) if name not in node.get("required", [])]) for _, node in nodes
    )
    assert len(json.dumps(schema, separators=(",", ":"))) < 12_000
    assert optional == 9
    assert max(path.count(".") + path.count("[]") for path, _ in nodes) == 10


def test_formula_is_optional_shallow_and_nonrecursive() -> None:
    schema = load_study_investigation_structured_schema()
    calculation = _calculation_schema(schema)
    assert "formula" not in calculation["required"]
    formula = calculation["properties"]["formula"]
    assert formula == shallow_formula_schema()
    assert formula["required"] == ["op", "args"]
    operation_or_leaf = formula["properties"]["args"]["items"]
    leaf = operation_or_leaf["properties"]["args"]["items"]
    assert set(leaf["properties"]) == {"input", "value"}
    assert "args" not in leaf["properties"]
    assert PROVIDER_FORMULA_DEPTH == 3


# --- Structure preserved ----------------------------------------------------------------------


def test_provider_structure_matches_canonical_except_formula() -> None:
    raw = _load_canonical_raw()
    canonical = _canonical_shape({key: value for key, value in raw.items() if key != "$defs"}, raw["$defs"])
    provider = _provider_shape(load_study_investigation_structured_schema())
    del _calculation_schema(canonical)["properties"]["formula"]
    del _calculation_schema(provider)["properties"]["formula"]
    assert provider == canonical


def test_required_identifiers_and_enums_are_kept() -> None:
    schema = load_study_investigation_structured_schema()
    assert schema["required"] == ["schema", "processingRunId", "answers", "coverageNotes", "instructionsIgnored"]
    assert schema["properties"]["schema"] == {"enum": [STUDY_INVESTIGATION_SCHEMA_ID]}
    answer = schema["properties"]["answers"]["items"]
    assert answer["required"][:2] == ["planQuestionId", "status"]
    assert answer["properties"]["status"]["enum"] == ["ANSWERED", "PARTIALLY_ANSWERED", "MISSING_EVIDENCE", "CONFLICTING"]
    for site in _EVIDENCE_SITES:
        evidence = dict(_schema_nodes(schema))[site]
        assert evidence["required"] == ["sourceDocumentId", "pageNumber", "quote"], site


# --- Relaxations are explicit and complete ----------------------------------------------------


def test_relaxations_are_exactly_the_reviewed_list() -> None:
    relaxed = {(item["path"], item["keyword"]) for item in provider_schema_relaxations(_load_canonical_raw())}
    expected = {
        ("$.processingRunId", "format"),
        ("$.answers[].planQuestionId", "pattern"),
        ("$.answers[].answer", "maxLength"),
        ("$.answers[].facts[].statement", "maxLength"),
        ("$.answers[].facts[].evidence", "minItems"),
        ("$.answers[].calculations[].description", "maxLength"),
        ("$.answers[].calculations[].inputs", "minItems"),
        ("$.answers[].calculations[].inputs[].label", "maxLength"),
        ("$.answers[].calculations[].inputs[].valueAsWritten", "maxLength"),
        ("$.answers[].calculations[].inputs[].evidence", "minItems"),
        ("$.answers[].calculations[].arithmetic", "maxLength"),
        ("$.answers[].calculations[].result", "maxLength"),
        (_FORMULA_PATH, "formula"),
        ("$.answers[].assessments[].judgment", "maxLength"),
        ("$.answers[].assessments[].criterion", "maxLength"),
        ("$.answers[].assessments[].factIndexes", "minItems"),
        ("$.answers[].assessments[].factIndexes[]", "minimum"),
        ("$.answers[].assessments[].reasoning", "maxLength"),
        ("$.answers[].assessments[].wouldChangeIf[]", "maxLength"),
        ("$.answers[].uncertainties[]", "maxLength"),
        ("$.answers[].professionalDeterminations[].determination", "maxLength"),
        ("$.answers[].professionalDeterminations[].bearingFacts[]", "minimum"),
        ("$.answers[].professionalDeterminations[].decidedBy", "maxLength"),
        ("$.answers[].conflicts[].description", "maxLength"),
        ("$.answers[].conflicts[].evidence", "minItems"),
        ("$.answers[].limitations[]", "maxLength"),
        ("$.coverageNotes[]", "maxLength"),
        ("$.instructionsIgnored[].sourceDocumentId", "format"),
        ("$.instructionsIgnored[].pageNumber", "minimum"),
        ("$.instructionsIgnored[].description", "maxLength"),
    }
    for site in _EVIDENCE_SITES:
        expected |= {
            (f"{site}.sourceDocumentId", "format"),
            (f"{site}.pageNumber", "minimum"),
            (f"{site}.quote", "minLength"),
            (f"{site}.quote", "maxLength"),
        }
    assert relaxed == expected


# --- Fail closed on unreviewed canonical changes ----------------------------------------------


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda raw: raw.pop("$defs"), "missing"),
        (lambda raw: raw.update({"$id": "other/1"}), "not hive.study-investigation/1"),
        (lambda raw: raw["properties"]["coverageNotes"].update({"uniqueItems": True}), "Unsupported schema keyword"),
        (lambda raw: raw["properties"].update({"extra": {"anyOf": [{"type": "string"}]}}), "Unsupported schema keyword"),
        (lambda raw: raw["properties"].update({"extra": {"$ref": "#/$defs/formula"}}), "Unsupported \\$ref"),
        (lambda raw: raw["properties"].update({"extra": {"oneOf": [{"type": "string"}]}}), "Unsupported oneOf"),
        (lambda raw: raw["$defs"]["evidence"].pop("additionalProperties"), "additionalProperties false"),
    ],
)
def test_prepare_fails_closed_on_unreviewed_schema(mutate: Callable[[dict[str, Any]], object], message: str) -> None:
    raw = _load_canonical_raw()
    mutate(raw)
    with pytest.raises(StudySchemaError, match=message):
        prepare_study_investigation_structured_schema(raw)


# --- Canonical validation stays separate and complete -----------------------------------------


def test_canonical_schema_file_is_unchanged_in_kind() -> None:
    raw = _load_canonical_raw()
    assert raw["$id"] == STUDY_INVESTIGATION_SCHEMA_ID
    assert json.dumps(raw["$defs"]["formula"]).count("#/$defs/formula") == 1
    assert raw["$defs"]["evidence"]["properties"]["quote"] == {"type": "string", "minLength": 1, "maxLength": 600}


def test_provider_schema_never_mutates_canonical_input() -> None:
    raw = _load_canonical_raw()
    before = copy.deepcopy(raw)
    prepare_study_investigation_structured_schema(raw)
    assert raw == before


def test_valid_study_passes_both_schemas() -> None:
    instance = _study(formula=_percentage_formula())
    jsonschema.validate(instance=instance, schema=load_study_investigation_structured_schema())
    _canonical_validator().validate(instance)
    jsonschema.validate(instance=_study(), schema=load_study_investigation_structured_schema())


def _set(path: tuple[Any, ...], value: Any) -> Callable[[dict[str, Any]], None]:
    def apply(instance: dict[str, Any]) -> None:
        target: Any = instance
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = value

    return apply


A0 = ("answers", 0)


@pytest.mark.parametrize(
    "mutate",
    [
        pytest.param(_set(("processingRunId",), "not-a-uuid"), id="run-id-format"),
        pytest.param(_set((*A0, "planQuestionId"), "Q1"), id="plan-question-pattern"),
        pytest.param(_set((*A0, "answer"), "x" * 4001), id="answer-max-length"),
        pytest.param(_set((*A0, "facts", 0, "evidence"), []), id="fact-evidence-min-items"),
        pytest.param(_set((*A0, "facts", 0, "evidence", 0, "sourceDocumentId"), "doc-1"), id="evidence-uuid"),
        pytest.param(_set((*A0, "facts", 0, "evidence", 0, "pageNumber"), 0), id="evidence-page-minimum"),
        pytest.param(_set((*A0, "facts", 0, "evidence", 0, "quote"), ""), id="quote-min-length"),
        pytest.param(_set((*A0, "evidence", 0, "quote"), "q" * 601), id="quote-max-length"),
        pytest.param(_set((*A0, "calculations", 0, "inputs"), []), id="calculation-inputs-min-items"),
        pytest.param(_set((*A0, "assessments", 0, "factIndexes"), []), id="fact-indexes-min-items"),
        pytest.param(_set((*A0, "assessments", 0, "factIndexes"), [-1]), id="fact-index-minimum"),
        pytest.param(_set((*A0, "professionalDeterminations", 0, "bearingFacts"), [-1]), id="bearing-fact-minimum"),
        pytest.param(_set((*A0, "conflicts", 0, "evidence"), [_evidence()]), id="conflict-evidence-min-items"),
        pytest.param(_set(("instructionsIgnored", 0, "pageNumber"), 0), id="instruction-page-minimum"),
        pytest.param(_set((*A0, "calculations", 0, "formula"), {"op": "+", "args": [{"value": "1,000"}]}), id="formula-literal"),
        pytest.param(
            _set((*A0, "calculations", 0, "formula"), {"op": "round", "args": [{"input": 0}], "places": 7}),
            id="formula-places",
        ),
        pytest.param(_set((*A0, "calculations", 0, "formula"), {"op": "+", "args": []}), id="formula-args-min-items"),
        pytest.param(_set((*A0, "calculations", 0, "formula"), {"op": "+", "args": [{}]}), id="formula-empty-leaf"),
    ],
)
def test_provider_accepts_but_canonical_rejects_relaxed_constraint(mutate: Callable[[dict[str, Any]], None]) -> None:
    instance = _study(formula=_percentage_formula())
    mutate(instance)
    jsonschema.validate(instance=instance, schema=load_study_investigation_structured_schema())
    assert list(_canonical_validator().iter_errors(instance)), "canonical schema must reject this output"


def test_formula_deeper_than_provider_depth_is_canonical_only() -> None:
    deep = {"op": "round", "places": 2, "args": [_percentage_formula()]}
    instance = _study(formula=deep)
    _canonical_validator().validate(instance)
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(instance=instance, schema=load_study_investigation_structured_schema())
