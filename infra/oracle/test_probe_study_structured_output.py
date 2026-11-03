from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

import probe_study_structured_output as probe
import v4_planner
from study_investigation_schema import (
    load_study_investigation_structured_schema,
    study_json_schema_response_format,
)


def test_reuses_exact_v4_planner_study_schema_transformation() -> None:
    from_probe = probe.load_planner_study_response_format()
    from_planner = v4_planner._litellm_response_format(
        "study",
        {"study_structured_output": "json_schema"},
    )
    from_schema_module = study_json_schema_response_format(
        load_study_investigation_structured_schema()
    )
    assert from_probe == from_planner
    assert from_probe == from_schema_module


def test_build_probe_request_uses_heavy_lifter_150_tokens_and_synthetic_prompt() -> None:
    req = probe.build_probe_request()
    assert req["model"] == "heavy_lifter"
    assert req["temperature"] == 0
    assert req["max_tokens"] == 150
    assert req["response_format"]["type"] == "json_schema"
    assert req["response_format"]["json_schema"]["name"] == "hive_study_investigation_v1"
    assert req["response_format"]["json_schema"]["strict"] is True

    messages = req["messages"]
    assert isinstance(messages, list) and len(messages) == 2
    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"

    serialized_messages = json.dumps(messages).lower()
    for forbidden in ("maya", "5a5a5a5a", "iep", "progressnov", "servicelog"):
        assert forbidden not in serialized_messages

    user_payload = json.loads(messages[1]["content"])
    assert user_payload["pages"] == []
    assert user_payload["processingRunId"] == "00000000-0000-4000-8000-000000000001"


def test_summarize_schema_complexity_reports_size_and_structure() -> None:
    response_format = probe.load_planner_study_response_format()
    summary = probe.summarize_schema_complexity(response_format)

    assert summary["schema_id"] == "hive.study-investigation/1"
    assert summary["schema_name"] == "hive_study_investigation_v1"
    assert summary["strict"] is True
    assert 2000 < summary["schema_json_bytes"] < 12_000
    assert summary["response_format_json_bytes"] > summary["schema_json_bytes"]
    assert summary["schema_sha256"].startswith("sha256:")
    assert len(summary["schema_sha256"]) == len("sha256:") + 64
    assert summary["object_count"] >= 15
    assert summary["array_count"] >= 15
    assert summary["property_count"] >= 60
    assert summary["optional_property_count"] == 9
    assert summary["additional_properties_false_count"] == summary["object_count"]
    assert summary["enum_count"] == 6
    assert summary["union_count"] == 0
    assert summary["unsupported_keywords"] == []
    assert set(summary["keywords_used"]) == {"type", "properties", "required", "additionalProperties", "items", "enum"}
    assert summary["schema_uses_defs_or_ref"] is False
    assert summary["provider_formula_depth"] == 3
    assert summary["formula_strategy"] == "shallow_fixed_depth"


def test_summarize_schema_complexity_flags_unsupported_keywords() -> None:
    response_format = probe.load_planner_study_response_format()
    response_format["json_schema"]["schema"]["properties"]["coverageNotes"]["items"]["maxLength"] = 600
    response_format["json_schema"]["schema"]["properties"]["extra"] = {"anyOf": [{"type": "string"}]}
    summary = probe.summarize_schema_complexity(response_format)
    assert summary["unsupported_keywords"] == ["anyOf", "maxLength"]
    assert summary["union_count"] == 1
    assert probe.summarize_schema_complexity(probe.load_planner_study_response_format())["unsupported_keywords"] == []


def test_summarize_relaxed_constraints_counts_canonical_keywords() -> None:
    assert probe.summarize_relaxed_constraints() == {
        "format": 7,
        "formula": 1,
        "maxLength": 23,
        "minItems": 5,
        "minLength": 5,
        "minimum": 8,
        "pattern": 1,
    }


@pytest.mark.parametrize("finish_reason", ["length", "max_tokens"])
def test_classifies_http_200_truncated_response_as_schema_accepted(finish_reason: str) -> None:
    complexity = probe.summarize_schema_complexity(probe.load_planner_study_response_format())
    secret_partial_json = '{"schema":"hive.study-investigation/1","processingRunId":"00000000-0000-4000-8000-000000000001","answers":[{"planQuestionId":"P1","answer":"SENSITIVE_TRUNCATED_TEXT'
    body = json.dumps(
        {
            "model": "claude-opus-4-6-20260201",
            "choices": [
                {
                    "message": {"role": "assistant", "content": secret_partial_json},
                    "finish_reason": finish_reason,
                }
            ],
            "usage": {"prompt_tokens": 950, "completion_tokens": 150, "total_tokens": 1100},
        }
    ).encode("utf-8")

    report = probe.classify_probe_response(
        http_status=200,
        response_body=body,
        latency_ms=1840,
        model_alias="heavy_lifter",
        schema_complexity=complexity,
    )
    assert report["http_status"] == 200
    assert report["schema_accepted"] is True
    assert report["response_truncated"] is True
    assert report["provider_error_category"] is None
    assert report["planner_diagnostic_reason"] == "model_output_truncated"
    assert report["finish_reason"] == finish_reason
    assert report["resolved_model"] == "claude-opus-4-6-20260201"
    assert report["usage"] == {"prompt_tokens": 950, "completion_tokens": 150, "total_tokens": 1100}
    assert report["content_summary"] == {
        "char_count": len(secret_partial_json),
        "start_category": "json_object",
        "end_category": "other",
        "parsed_complete_json_object": False,
    }
    assert "SENSITIVE_TRUNCATED_TEXT" not in json.dumps(report)


def test_classifies_http_200_complete_json_response() -> None:
    complexity = probe.summarize_schema_complexity(probe.load_planner_study_response_format())
    complete_json = json.dumps(
        {
            "schema": "hive.study-investigation/1",
            "processingRunId": "00000000-0000-4000-8000-000000000001",
            "answers": [],
            "coverageNotes": ["DO_NOT_PRINT_THIS_NOTE"],
            "instructionsIgnored": [],
        }
    )
    body = json.dumps(
        {
            "model": "claude-opus-4-6",
            "choices": [
                {
                    "message": {"role": "assistant", "content": complete_json},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 900, "completion_tokens": 45, "total_tokens": 945},
        }
    ).encode("utf-8")

    report = probe.classify_probe_response(
        http_status=200,
        response_body=body,
        latency_ms=1200,
        model_alias="heavy_lifter",
        schema_complexity=complexity,
    )
    assert report["http_status"] == 200
    assert report["schema_accepted"] is True
    assert report["response_truncated"] is False
    assert report["provider_error_category"] is None
    assert report["planner_diagnostic_reason"] == "ok"
    assert report["content_summary"]["parsed_complete_json_object"] is True
    assert "DO_NOT_PRINT_THIS_NOTE" not in json.dumps(report)


@pytest.mark.parametrize(
    ("status", "error_message", "expected_category", "expected_reason", "expected_features"),
    [
        (
            400,
            "Invalid json_schema: keyword 'minItems' and 'format' are not supported in output_format",
            "schema_unsupported_keyword",
            "structured_output_schema_rejected",
            ["format", "minItems"],
        ),
        (
            400,
            "Structured output schema is too complex: grammar compilation exceeded maximum branches",
            "schema_too_complex_or_large",
            "structured_output_schema_rejected",
            [],
        ),
        (
            400,
            "This model does not support response_format type json_schema",
            "structured_output_not_supported",
            "structured_output_schema_rejected",
            [],
        ),
        (
            422,
            "Invalid response_format payload for structured output",
            "structured_output_schema_rejected",
            "structured_output_schema_rejected",
            [],
        ),
        (
            400,
            "This model's maximum context length is exceeded",
            "model_context_exceeded",
            "model_context_exceeded",
            [],
        ),
        (
            401,
            "Authentication Error: invalid bearer key sk-secret-12345",
            "authentication_failed",
            "litellm_http_error",
            [],
        ),
        (
            429,
            "Rate limit reached for heavy_lifter",
            "rate_limited",
            "litellm_http_error",
            [],
        ),
        (
            502,
            "Bad gateway from upstream provider",
            "upstream_server_error",
            "litellm_http_error",
            [],
        ),
    ],
)
def test_classifies_error_responses_without_leaking_upstream_text(
    status: int,
    error_message: str,
    expected_category: str,
    expected_reason: str,
    expected_features: list[str],
) -> None:
    complexity = probe.summarize_schema_complexity(probe.load_planner_study_response_format())
    raw_error = json.dumps({"error": {"message": f"{error_message} SECRET_UPSTREAM_DETAIL"}}).encode("utf-8")

    report = probe.classify_probe_response(
        http_status=status,
        response_body=raw_error,
        latency_ms=320,
        model_alias="heavy_lifter",
        schema_complexity=complexity,
    )
    assert report["http_status"] == status
    assert report["schema_accepted"] is False
    assert report["response_truncated"] is False
    assert report["provider_error_category"] == expected_category
    assert report["planner_diagnostic_reason"] == expected_reason
    assert report["rejected_schema_features_detected"] == expected_features
    assert "SECRET_UPSTREAM_DETAIL" not in json.dumps(report)
    assert "sk-secret-12345" not in json.dumps(report)


def test_execute_probe_sends_expected_request_and_redacts_secrets() -> None:
    captured: dict[str, Any] = {}

    def fake_sender(
        url: str,
        payload_bytes: bytes,
        headers: dict[str, str],
        timeout_seconds: float,
    ) -> tuple[int, bytes]:
        captured["url"] = url
        captured["payload"] = json.loads(payload_bytes.decode("utf-8"))
        captured["headers"] = headers
        captured["timeout"] = timeout_seconds
        return (
            200,
            json.dumps(
                {
                    "model": "claude-opus-4-6",
                    "choices": [
                        {
                            "message": {"role": "assistant", "content": '{"schema":"hive.study-investigation/1"'},
                            "finish_reason": "length",
                        }
                    ],
                    "usage": {"prompt_tokens": 800, "completion_tokens": 150, "total_tokens": 950},
                }
            ).encode("utf-8"),
        )

    secret_key = "sk-super-secret-virtual-key-do-not-print"
    report = probe.execute_probe(
        litellm_base_url="http://hive-litellm:4000",
        litellm_api_key=secret_key,
        model_alias="heavy_lifter",
        http_sender=fake_sender,
    )

    assert captured["url"] == "http://hive-litellm:4000/v1/chat/completions"
    assert captured["headers"]["Authorization"] == f"Bearer {secret_key}"
    assert captured["payload"]["model"] == "heavy_lifter"
    assert captured["payload"]["max_tokens"] == 150
    assert captured["payload"]["response_format"]["type"] == "json_schema"
    assert report["schema_accepted"] is True
    assert report["response_truncated"] is True

    serialized_report = json.dumps(report)
    assert secret_key not in serialized_report
    assert probe.SYNTHETIC_SYSTEM_PROMPT not in serialized_report


def test_execute_probe_handles_timeout_and_network_errors() -> None:
    def timeout_sender(url: str, payload: bytes, headers: dict[str, str], timeout: float) -> tuple[int, bytes]:
        raise TimeoutError("timed out")

    def offline_sender(url: str, payload: bytes, headers: dict[str, str], timeout: float) -> tuple[int, bytes]:
        raise OSError("connection refused")

    timeout_report = probe.execute_probe(
        litellm_base_url="http://127.0.0.1:4000",
        litellm_api_key="sk-test",
        http_sender=timeout_sender,
    )
    assert timeout_report["http_status"] is None
    assert timeout_report["schema_accepted"] is False
    assert timeout_report["provider_error_category"] == "timeout"
    assert timeout_report["planner_diagnostic_reason"] == "litellm_timeout"

    network_report = probe.execute_probe(
        litellm_base_url="http://127.0.0.1:4000",
        litellm_api_key="sk-test",
        http_sender=offline_sender,
    )
    assert network_report["http_status"] is None
    assert network_report["schema_accepted"] is False
    assert network_report["provider_error_category"] == "network_error"
    assert network_report["planner_diagnostic_reason"] == "litellm_network_error"


def test_resolve_probe_settings_falls_back_to_host_loopback_when_docker_dns_unresolvable(
    tmp_path: Path,
) -> None:
    env_file = tmp_path / "v4-planner.env"
    env_file.write_text(
        "PLANNER_LITELLM_BASE_URL=http://hive-litellm:4000\n"
        "PLANNER_LITELLM_API_KEY=sk-from-env-file\n"
        "PLANNER_STUDY_LITELLM_ALIAS=heavy_lifter\n",
        encoding="utf-8",
    )
    host_settings = probe.resolve_probe_settings(
        env={},
        env_file=env_file,
        host_resolver=lambda _: False,
    )
    assert host_settings["litellm_base_url"] == "http://127.0.0.1:4000"
    assert host_settings["litellm_api_key"] == "sk-from-env-file"
    assert host_settings["model_alias"] == "heavy_lifter"

    docker_settings = probe.resolve_probe_settings(
        env={},
        env_file=env_file,
        host_resolver=lambda _: True,
    )
    assert docker_settings["litellm_base_url"] == "http://hive-litellm:4000"


def test_cli_dry_run_prints_safe_complexity_summary_without_network(
    capsys: pytest.CaptureFixture[str],
) -> None:
    exit_code = probe.main(["--dry-run"])
    assert exit_code == 0
    out = json.loads(capsys.readouterr().out)
    assert out["mode"] == "dry_run"
    assert out["model_alias"] == "heavy_lifter"
    assert out["response_format_type"] == "json_schema"
    assert out["max_tokens"] == 150
    assert out["schema_complexity"]["schema_id"] == "hive.study-investigation/1"
    assert out["schema_complexity"]["unsupported_keywords"] == []
    assert out["relaxed_canonical_constraints"]["maxLength"] == 23
