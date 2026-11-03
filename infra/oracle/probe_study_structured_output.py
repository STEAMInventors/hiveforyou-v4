"""
HiveForYou V4 — Standalone compatibility probe for Canonical Study structured output.

Verifies whether LiteLLM and the configured Study model (`heavy_lifter`, Claude Opus 4.6)
accept the provider-facing projection of `hive.study-investigation/1` via
`response_format.type = "json_schema"` without executing a full Study investigation.

Safety invariants:
- Sends the exact `response_format` `v4_planner.py` sends for `study` when
  `PLANNER_STUDY_STRUCTURED_OUTPUT=json_schema` (built by `study_investigation_schema.py`).
- Uses a minimal synthetic prompt with `max_tokens = 150` and zero Maya or customer data.
- Never prints or logs API keys, prompts, raw model completions, raw upstream error text, or documents.
- Does not modify LiteLLM, Oracle environment files, Supabase, or Vercel.
- Requires explicit `--execute` to perform the live network call; `--dry-run` is offline-only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable, Literal

from model_json_parse import ModelJsonParseError, parse_model_json_object
from study_investigation_schema import (
    PROVIDER_FORMULA_DEPTH,
    PROVIDER_SCHEMA_KEYWORDS,
    STRUCTURED_OUTPUT_SCHEMA_NAME,
    STUDY_INVESTIGATION_SCHEMA_ID,
    StudySchemaError,
    load_canonical_study_investigation_schema,
    prepare_study_investigation_structured_schema,
    provider_schema_relaxations,
    schema_uses_defs_or_ref,
    study_json_schema_response_format,
)

PROBE_CONTRACT_VERSION = "study-structured-output-probe@1"
DEFAULT_STUDY_MODEL_ALIAS = "heavy_lifter"
DEFAULT_HOST_LITELLM_BASE_URL = "http://127.0.0.1:4000"
DEFAULT_DOCKER_LITELLM_BASE_URL = "http://hive-litellm:4000"
PROBE_MAX_TOKENS = 150
PROBE_TIMEOUT_SECONDS = 90.0

SAFE_TOKEN_RE = re.compile(r"^[A-Za-z0-9_.:/@+-]{1,128}$")
TRUNCATED_FINISH_REASONS = frozenset({"length", "max_tokens"})

# Minimal synthetic probe inputs — no Maya identifiers, document text, or customer data.
SYNTHETIC_PROCESSING_RUN_ID = "00000000-0000-4000-8000-000000000001"
SYNTHETIC_SYSTEM_PROMPT = (
    "Synthetic schema compatibility probe only. Return a JSON object matching the "
    "hive.study-investigation/1 response schema."
)
SYNTHETIC_USER_PAYLOAD: dict[str, Any] = {
    "probe": "hive_study_structured_output_compatibility_v1",
    "processingRunId": SYNTHETIC_PROCESSING_RUN_ID,
    "planQuestions": [
        {
            "planQuestionId": "P1",
            "question": "Synthetic schema compatibility check with no source documents.",
        }
    ],
    "pages": [],
}

INTERPRETATION_NOTE = (
    "HTTP 200 with schema_accepted=true establishes that LiteLLM and the provider accepted "
    "the provider-facing hive.study-investigation/1 json_schema for this probe. It does not prove "
    "the model can generate a complete Canonical Study within 150 tokens. The provider schema omits "
    "value constraints that trusted verification still enforces on every Study output."
)

# Fixed allowlist of JSON Schema feature patterns that may be reported if a 400/422 error mentions them.
_KNOWN_SCHEMA_FEATURE_REGEXES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("$defs", re.compile(r"\$defs\b|(?<![a-z0-9_])defs(?![a-z0-9_])")),
    ("$ref", re.compile(r"\$ref\b|(?<![a-z0-9_])ref(?![a-z0-9_])")),
    ("additionalProperties", re.compile(r"(?<![a-z0-9_])additional_?properties(?![a-z0-9_])")),
    ("enum", re.compile(r"(?<![a-z0-9_])enum(?![a-z0-9_])")),
    ("format", re.compile(r"(?<![a-z0-9_])(?:format|uuid)(?![a-z0-9_])")),
    ("maxLength", re.compile(r"(?<![a-z0-9_])max_?length(?![a-z0-9_])")),
    ("maximum", re.compile(r"(?<![a-z0-9_])maximum(?![a-z0-9_])(?!\s+(?:branches|depth|size|states|tokens|context|length))")),
    ("minItems", re.compile(r"(?<![a-z0-9_])min_?items(?![a-z0-9_])")),
    ("minLength", re.compile(r"(?<![a-z0-9_])min_?length(?![a-z0-9_])")),
    ("minimum", re.compile(r"(?<![a-z0-9_])minimum(?![a-z0-9_])")),
    ("oneOf", re.compile(r"(?<![a-z0-9_])one_?of(?![a-z0-9_])")),
    ("pattern", re.compile(r"(?<![a-z0-9_])(?:pattern|regex)(?![a-z0-9_])")),
    ("recursive", re.compile(r"(?<![a-z0-9_])(?:recursive|recursion|cycle|circular)(?![a-z0-9_])")),
)


def load_planner_study_response_format(schema_path: Path | None = None) -> dict[str, Any]:
    """
    Return the exact `response_format` dictionary used by `v4_planner.py` when
    `PLANNER_STUDY_STRUCTURED_OUTPUT=json_schema` is enabled for the `study` task.
    """
    if schema_path is not None:
        try:
            raw = json.loads(schema_path.read_text(encoding="utf-8"))
        except OSError as exc:
            raise StudySchemaError(f"Schema file not readable: {schema_path}") from exc
        except json.JSONDecodeError as exc:
            raise StudySchemaError(f"Schema file is not valid JSON: {schema_path}") from exc
        if not isinstance(raw, dict):
            raise StudySchemaError("Schema root must be an object")
        transformed = prepare_study_investigation_structured_schema(raw)
        return study_json_schema_response_format(transformed)

    try:
        import v4_planner  # type: ignore[import-not-found]
    except ImportError:
        transformed = prepare_study_investigation_structured_schema(load_canonical_study_investigation_schema())
        return study_json_schema_response_format(transformed)

    return v4_planner._litellm_response_format(
        "study",
        {"study_structured_output": "json_schema"},
    )


def summarize_schema_complexity(response_format: dict[str, Any]) -> dict[str, Any]:
    """Compute deterministic size and structural complexity metrics for the transformed schema."""
    if response_format.get("type") != "json_schema":
        raise StudySchemaError("response_format.type must be json_schema")
    json_schema_block = response_format.get("json_schema")
    if not isinstance(json_schema_block, dict):
        raise StudySchemaError("response_format.json_schema must be an object")
    schema = json_schema_block.get("schema")
    if not isinstance(schema, dict):
        raise StudySchemaError("response_format.json_schema.schema must be an object")

    compact_schema_bytes = json.dumps(schema, separators=(",", ":"), sort_keys=True).encode("utf-8")
    compact_format_bytes = json.dumps(response_format, separators=(",", ":"), sort_keys=True).encode("utf-8")
    schema_sha256 = "sha256:" + hashlib.sha256(compact_schema_bytes).hexdigest()

    counts = {
        "object_count": 0,
        "array_count": 0,
        "property_count": 0,
        "required_property_count": 0,
        "optional_property_count": 0,
        "additional_properties_false_count": 0,
        "enum_count": 0,
        "union_count": 0,
    }
    keywords_used: set[str] = set()

    def walk(node: Any, depth: int) -> int:
        """Visits schema nodes only; property names are not mistaken for keywords."""
        if not isinstance(node, dict):
            return depth
        keywords_used.update(node.keys())
        node_type = node.get("type")
        if node_type == "object":
            counts["object_count"] += 1
        elif node_type == "array":
            counts["array_count"] += 1
        if isinstance(node_type, list) or any(key in node for key in ("oneOf", "anyOf", "allOf")):
            counts["union_count"] += 1
        if "enum" in node:
            counts["enum_count"] += 1
        if node.get("additionalProperties") is False:
            counts["additional_properties_false_count"] += 1

        children: list[Any] = []
        props = node.get("properties")
        if isinstance(props, dict):
            required = node.get("required") if isinstance(node.get("required"), list) else []
            counts["property_count"] += len(props)
            counts["required_property_count"] += len(required)
            counts["optional_property_count"] += len([name for name in props if name not in required])
            children.extend(props.values())
        if "items" in node:
            children.append(node["items"])
        for key in ("oneOf", "anyOf", "allOf"):
            if isinstance(node.get(key), list):
                children.extend(node[key])
        if isinstance(node.get("$defs"), dict):
            children.extend(node["$defs"].values())
        return max([depth, *(walk(child, depth + 1) for child in children)])

    max_depth = walk(schema, 1)

    return {
        "schema_id": STUDY_INVESTIGATION_SCHEMA_ID,
        "schema_name": str(json_schema_block.get("name", STRUCTURED_OUTPUT_SCHEMA_NAME)),
        "strict": bool(json_schema_block.get("strict", False)),
        "schema_json_bytes": len(compact_schema_bytes),
        "response_format_json_bytes": len(compact_format_bytes),
        "schema_sha256": schema_sha256,
        "max_depth": max_depth,
        **counts,
        "keywords_used": sorted(keywords_used),
        "unsupported_keywords": sorted(keywords_used - PROVIDER_SCHEMA_KEYWORDS),
        "schema_uses_defs_or_ref": schema_uses_defs_or_ref(schema),
        "provider_formula_depth": PROVIDER_FORMULA_DEPTH,
        "formula_strategy": "shallow_fixed_depth",
    }


def summarize_relaxed_constraints(schema_path: Path | None = None) -> dict[str, int]:
    """Count, by keyword, the canonical constraints the provider schema omits (enforced by trusted verification)."""
    if schema_path is not None:
        try:
            raw = json.loads(schema_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise StudySchemaError(f"Schema file not readable: {schema_path}") from exc
        if not isinstance(raw, dict):
            raise StudySchemaError("Schema root must be an object")
    else:
        raw = load_canonical_study_investigation_schema()
    tally: dict[str, int] = {}
    for item in provider_schema_relaxations(raw):
        tally[item["keyword"]] = tally.get(item["keyword"], 0) + 1
    return dict(sorted(tally.items()))


def build_probe_request(
    model_alias: str = DEFAULT_STUDY_MODEL_ALIAS,
    schema_path: Path | None = None,
) -> dict[str, Any]:
    """Construct the minimal LiteLLM `/v1/chat/completions` request payload."""
    alias = model_alias.strip()
    if not alias or not SAFE_TOKEN_RE.match(alias):
        raise ValueError("Invalid model alias")
    response_format = load_planner_study_response_format(schema_path=schema_path)
    return {
        "model": alias,
        "messages": [
            {"role": "system", "content": SYNTHETIC_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": json.dumps(SYNTHETIC_USER_PAYLOAD, separators=(",", ":"), sort_keys=True),
            },
        ],
        "temperature": 0,
        "max_tokens": PROBE_MAX_TOKENS,
        "response_format": response_format,
    }


def _safe_token(value: Any) -> str | None:
    return value if isinstance(value, str) and SAFE_TOKEN_RE.match(value) else None


def _count(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def _first_content_category(content: str) -> str:
    trimmed = content.lstrip("\ufeff \t\n\r")
    if not trimmed:
        return "empty"
    first = trimmed[0]
    if first == "{":
        return "json_object"
    if first == "`":
        return "markdown_fence"
    return "other"


def _ending_structure_category(content: str) -> str:
    trimmed = content.rstrip("\t\n\r ")
    if not trimmed:
        return "empty"
    if trimmed.endswith("```"):
        return "markdown_fence_close"
    if trimmed.endswith("}"):
        return "json_object_close"
    if trimmed.endswith("]"):
        return "json_array_close"
    return "other"


def _lower_error_text(raw_body: bytes | str | None) -> str:
    if raw_body is None:
        return ""
    if isinstance(raw_body, bytes):
        text = raw_body.decode("utf-8", errors="replace")
    else:
        text = raw_body
    try:
        parsed = json.loads(text)
        return json.dumps(parsed).lower()
    except ValueError:
        return text.lower()


def _detect_rejected_schema_features(lower_text: str) -> list[str]:
    detected: list[str] = []
    for canonical_name, pattern in _KNOWN_SCHEMA_FEATURE_REGEXES:
        if pattern.search(lower_text):
            detected.append(canonical_name)
    return detected


def _is_context_error_text(lower_text: str) -> bool:
    return "context" in lower_text and (
        "length" in lower_text or "window" in lower_text or "exceed" in lower_text
    )


def _is_structured_output_rejection_text(http_status: int, lower_text: str) -> bool:
    if http_status not in (400, 422):
        return False
    markers = (
        "json_schema",
        "output_format",
        "output_config",
        "structured output",
        "structured_output",
        "response_format",
        "schema",
        "grammar",
        "additionalproperties",
        "$ref",
        "$defs",
        "oneof",
    )
    return any(marker in lower_text for marker in markers)


def _classify_schema_rejection_category(lower_text: str, features: list[str]) -> str:
    complexity_markers = (
        "too complex",
        "complexity",
        "max depth",
        "maximum depth",
        "too large",
        "grammar",
        "too many",
        "branches",
        "states",
        "compilation",
    )
    if any(marker in lower_text for marker in complexity_markers):
        return "schema_too_complex_or_large"
    unsupported_model_markers = (
        "does not support response_format",
        "does not support structured",
        "does not support json_schema",
        "unsupported model",
        "not supported for this model",
    )
    if any(marker in lower_text for marker in unsupported_model_markers):
        return "structured_output_not_supported"
    if features:
        return "schema_unsupported_keyword"
    return "structured_output_schema_rejected"


def classify_probe_response(
    *,
    http_status: int | None,
    response_body: bytes | str | None,
    latency_ms: int,
    model_alias: str,
    schema_complexity: dict[str, Any],
    transport_error_kind: Literal["timeout", "network_error"] | None = None,
) -> dict[str, Any]:
    """
    Classify the gateway response without exposing raw model output, prompts, or error strings.
    """
    base_report: dict[str, Any] = {
        "probe_contract": PROBE_CONTRACT_VERSION,
        "model_alias": model_alias,
        "resolved_model": None,
        "response_format_type": "json_schema",
        "max_tokens": PROBE_MAX_TOKENS,
        "http_status": http_status,
        "schema_accepted": False,
        "response_truncated": False,
        "provider_error_category": None,
        "planner_diagnostic_reason": None,
        "rejected_schema_features_detected": [],
        "finish_reason": None,
        "usage": {
            "prompt_tokens": None,
            "completion_tokens": None,
            "total_tokens": None,
        },
        "content_summary": None,
        "latency_ms": max(0, int(latency_ms)),
        "schema_complexity": schema_complexity,
        "interpretation_note": INTERPRETATION_NOTE,
    }

    if transport_error_kind == "timeout":
        base_report["provider_error_category"] = "timeout"
        base_report["planner_diagnostic_reason"] = "litellm_timeout"
        return base_report

    if transport_error_kind == "network_error" or http_status is None:
        base_report["provider_error_category"] = "network_error"
        base_report["planner_diagnostic_reason"] = "litellm_network_error"
        return base_report

    if http_status >= 400:
        lower_text = _lower_error_text(response_body)
        if http_status in (400, 413) and _is_context_error_text(lower_text):
            base_report["provider_error_category"] = "model_context_exceeded"
            base_report["planner_diagnostic_reason"] = "model_context_exceeded"
            return base_report
        if _is_structured_output_rejection_text(http_status, lower_text):
            features = _detect_rejected_schema_features(lower_text)
            base_report["rejected_schema_features_detected"] = features
            base_report["provider_error_category"] = _classify_schema_rejection_category(lower_text, features)
            base_report["planner_diagnostic_reason"] = "structured_output_schema_rejected"
            return base_report
        if http_status in (401, 403):
            base_report["provider_error_category"] = "authentication_failed"
            base_report["planner_diagnostic_reason"] = "litellm_http_error"
            return base_report
        if http_status == 404:
            base_report["provider_error_category"] = "model_or_route_not_found"
            base_report["planner_diagnostic_reason"] = "litellm_http_error"
            return base_report
        if http_status == 429:
            base_report["provider_error_category"] = "rate_limited"
            base_report["planner_diagnostic_reason"] = "litellm_http_error"
            return base_report
        if http_status >= 500:
            base_report["provider_error_category"] = "upstream_server_error"
            base_report["planner_diagnostic_reason"] = "litellm_http_error"
            return base_report
        base_report["provider_error_category"] = "invalid_request_other"
        base_report["planner_diagnostic_reason"] = "litellm_http_error"
        return base_report

    if http_status != 200:
        base_report["provider_error_category"] = "unexpected_http_status"
        base_report["planner_diagnostic_reason"] = "model_response_contract"
        return base_report

    raw_text = (
        response_body.decode("utf-8", errors="replace")
        if isinstance(response_body, bytes)
        else (response_body or "")
    )
    try:
        data = json.loads(raw_text)
    except ValueError:
        base_report["provider_error_category"] = "invalid_gateway_envelope"
        base_report["planner_diagnostic_reason"] = "model_response_contract"
        return base_report

    if not isinstance(data, dict):
        base_report["provider_error_category"] = "invalid_gateway_envelope"
        base_report["planner_diagnostic_reason"] = "model_response_contract"
        return base_report

    choices = data.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        base_report["provider_error_category"] = "invalid_gateway_envelope"
        base_report["planner_diagnostic_reason"] = "model_response_contract"
        return base_report

    choice = choices[0]
    message = choice.get("message")
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    finish_reason = _safe_token(choice.get("finish_reason"))

    base_report["resolved_model"] = _safe_token(data.get("model"))
    base_report["finish_reason"] = finish_reason
    base_report["usage"] = {
        "prompt_tokens": _count(usage.get("prompt_tokens")),
        "completion_tokens": _count(usage.get("completion_tokens")),
        "total_tokens": _count(usage.get("total_tokens")),
    }

    if not isinstance(message, dict) or "content" not in message:
        base_report["provider_error_category"] = "invalid_gateway_envelope"
        base_report["planner_diagnostic_reason"] = "model_content_missing"
        return base_report

    content = message.get("content")
    truncated = finish_reason in TRUNCATED_FINISH_REASONS

    # HTTP 200 with a completion choice means LiteLLM and the provider accepted the json_schema request.
    base_report["schema_accepted"] = True
    base_report["response_truncated"] = truncated

    if not isinstance(content, str):
        base_report["content_summary"] = {
            "char_count": 0,
            "start_category": "empty",
            "end_category": "empty",
            "parsed_complete_json_object": False,
        }
        base_report["planner_diagnostic_reason"] = (
            "model_output_truncated" if truncated else "model_content_missing"
        )
        return base_report

    parsed_complete_object = False
    parse_diagnostic = "ok"
    if not content.strip():
        parse_diagnostic = "model_content_missing"
    else:
        try:
            parse_model_json_object(content)
            parsed_complete_object = True
        except json.JSONDecodeError:
            parse_diagnostic = "model_output_not_json"
        except ModelJsonParseError as exc:
            if exc.category in {"not_object", "invalid_type", "wrapped_json"}:
                parse_diagnostic = "model_response_contract"
            elif exc.category == "empty":
                parse_diagnostic = "model_content_missing"
            else:
                parse_diagnostic = "model_output_not_json"

    if truncated:
        base_report["planner_diagnostic_reason"] = "model_output_truncated"
    else:
        base_report["planner_diagnostic_reason"] = parse_diagnostic

    base_report["content_summary"] = {
        "char_count": len(content),
        "start_category": _first_content_category(content),
        "end_category": _ending_structure_category(content),
        "parsed_complete_json_object": parsed_complete_object,
    }
    return base_report


def _parse_env_file(path: Path) -> dict[str, str]:
    """Read key=value pairs from a dotenv file without mutating os.environ or printing secrets."""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        k = key.strip()
        v = value.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in {"'", '"'}:
            v = v[1:-1]
        if k:
            values[k] = v
    return values


def _can_resolve_host(hostname: str) -> bool:
    try:
        socket.getaddrinfo(hostname, None)
        return True
    except OSError:
        return False


def resolve_probe_settings(
    *,
    env: dict[str, str] | None = None,
    env_file: Path | None = None,
    base_url_override: str | None = None,
    model_alias_override: str | None = None,
    host_resolver: Callable[[str], bool] = _can_resolve_host,
) -> dict[str, str]:
    """
    Resolve LiteLLM URL, API key, and Study model alias from environment or `v4-planner.env`
    without modifying any files or environment variables.
    """
    source_env = dict(os.environ if env is None else env)
    default_env_path = Path(__file__).resolve().parent / "v4-planner.env"
    file_vars = _parse_env_file(env_file if env_file is not None else default_env_path)

    def get_var(name: str) -> str:
        from_env = source_env.get(name, "").strip()
        if from_env:
            return from_env
        return file_vars.get(name, "").strip()

    api_key = (
        get_var("PLANNER_LITELLM_API_KEY")
        or get_var("LITELLM_API_KEY")
        or get_var("LITELLM_MASTER_KEY")
    )
    model_alias = (
        (model_alias_override or "").strip()
        or get_var("PLANNER_STUDY_LITELLM_ALIAS")
        or DEFAULT_STUDY_MODEL_ALIAS
    )

    if base_url_override and base_url_override.strip():
        base_url = base_url_override.strip().rstrip("/")
    else:
        configured_url = get_var("PLANNER_LITELLM_BASE_URL").rstrip("/")
        if configured_url:
            parsed = urllib.parse.urlparse(configured_url)
            hostname = parsed.hostname or ""
            if hostname and hostname not in {"127.0.0.1", "localhost"} and not host_resolver(hostname):
                base_url = DEFAULT_HOST_LITELLM_BASE_URL
            else:
                base_url = configured_url
        else:
            base_url = DEFAULT_HOST_LITELLM_BASE_URL

    return {
        "litellm_base_url": base_url,
        "litellm_api_key": api_key,
        "model_alias": model_alias,
    }


def _default_http_sender(
    url: str,
    payload_bytes: bytes,
    headers: dict[str, str],
    timeout_seconds: float,
) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=payload_bytes, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
            return int(resp.status), resp.read()
    except urllib.error.HTTPError as exc:
        body = exc.read() if exc.fp is not None else b""
        return int(exc.code), body


def execute_probe(
    *,
    litellm_base_url: str,
    litellm_api_key: str,
    model_alias: str = DEFAULT_STUDY_MODEL_ALIAS,
    schema_path: Path | None = None,
    timeout_seconds: float = PROBE_TIMEOUT_SECONDS,
    http_sender: Callable[[str, bytes, dict[str, str], float], tuple[int, bytes]] = _default_http_sender,
) -> dict[str, Any]:
    """Build and send one minimal `heavy_lifter` structured-output compatibility probe."""
    if not litellm_base_url.strip() or not litellm_api_key.strip():
        raise ValueError("LiteLLM base URL and API key are required to execute the live probe.")

    request_payload = build_probe_request(model_alias=model_alias, schema_path=schema_path)
    schema_complexity = summarize_schema_complexity(request_payload["response_format"])
    payload_bytes = json.dumps(request_payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    url = f"{litellm_base_url.rstrip('/')}/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {litellm_api_key.strip()}",
        "Content-Type": "application/json",
    }

    started = time.monotonic()
    try:
        status, body = http_sender(url, payload_bytes, headers, timeout_seconds)
    except (TimeoutError, socket.timeout):
        latency_ms = int((time.monotonic() - started) * 1000)
        return classify_probe_response(
            http_status=None,
            response_body=None,
            latency_ms=latency_ms,
            model_alias=model_alias,
            schema_complexity=schema_complexity,
            transport_error_kind="timeout",
        )
    except (urllib.error.URLError, OSError):
        latency_ms = int((time.monotonic() - started) * 1000)
        return classify_probe_response(
            http_status=None,
            response_body=None,
            latency_ms=latency_ms,
            model_alias=model_alias,
            schema_complexity=schema_complexity,
            transport_error_kind="network_error",
        )

    latency_ms = int((time.monotonic() - started) * 1000)
    return classify_probe_response(
        http_status=status,
        response_body=body,
        latency_ms=latency_ms,
        model_alias=model_alias,
        schema_complexity=schema_complexity,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Standalone compatibility probe for HiveForYou V4 Canonical Study structured output "
            "(hive.study-investigation/1 via LiteLLM json_schema)."
        )
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate schema transformation and print size/complexity without calling LiteLLM.",
    )
    mode.add_argument(
        "--execute",
        action="store_true",
        help="Send one minimal 150-token heavy_lifter json_schema probe to LiteLLM.",
    )
    parser.add_argument(
        "--base-url",
        default=None,
        help="LiteLLM base URL override (defaults to PLANNER_LITELLM_BASE_URL or http://127.0.0.1:4000).",
    )
    parser.add_argument(
        "--env-file",
        type=Path,
        default=None,
        help="Path to v4-planner.env file (defaults to infra/oracle/v4-planner.env if present).",
    )
    parser.add_argument(
        "--model-alias",
        default=None,
        help="LiteLLM model alias override (defaults to PLANNER_STUDY_LITELLM_ALIAS or heavy_lifter).",
    )
    parser.add_argument(
        "--schema-path",
        type=Path,
        default=None,
        help="Optional explicit path to hive.study-investigation-1.schema.json.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=PROBE_TIMEOUT_SECONDS,
        help=f"HTTP timeout in seconds (default: {PROBE_TIMEOUT_SECONDS}).",
    )
    args = parser.parse_args(argv)

    try:
        settings = resolve_probe_settings(
            env_file=args.env_file,
            base_url_override=args.base_url,
            model_alias_override=args.model_alias,
        )
        request_payload = build_probe_request(
            model_alias=settings["model_alias"],
            schema_path=args.schema_path,
        )
        complexity = summarize_schema_complexity(request_payload["response_format"])

        if args.dry_run:
            report = {
                "probe_contract": PROBE_CONTRACT_VERSION,
                "mode": "dry_run",
                "model_alias": settings["model_alias"],
                "response_format_type": request_payload["response_format"]["type"],
                "max_tokens": request_payload["max_tokens"],
                "litellm_api_key_configured": bool(settings["litellm_api_key"]),
                "schema_complexity": complexity,
                "relaxed_canonical_constraints": summarize_relaxed_constraints(args.schema_path),
                "interpretation_note": INTERPRETATION_NOTE,
            }
            print(json.dumps(report, indent=2, sort_keys=True))
            return 0

        if not settings["litellm_api_key"]:
            error_report = {
                "probe_contract": PROBE_CONTRACT_VERSION,
                "mode": "execute",
                "error_code": "MISSING_API_KEY",
                "message_safe": (
                    "No LiteLLM API key found in PLANNER_LITELLM_API_KEY, LITELLM_API_KEY, "
                    "LITELLM_MASTER_KEY, or v4-planner.env."
                ),
            }
            print(json.dumps(error_report, indent=2, sort_keys=True))
            return 2

        report = execute_probe(
            litellm_base_url=settings["litellm_base_url"],
            litellm_api_key=settings["litellm_api_key"],
            model_alias=settings["model_alias"],
            schema_path=args.schema_path,
            timeout_seconds=args.timeout,
        )
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0 if report.get("schema_accepted") is True else 1
    except StudySchemaError:
        error_report = {
            "probe_contract": PROBE_CONTRACT_VERSION,
            "error_code": "SCHEMA_UNAVAILABLE",
            "diagnostic_reason": "structured_output_schema_unavailable",
            "message_safe": "The Canonical Study structured output schema could not be loaded.",
        }
        print(json.dumps(error_report, indent=2, sort_keys=True))
        return 2
    except ValueError:
        error_report = {
            "probe_contract": PROBE_CONTRACT_VERSION,
            "error_code": "PROBE_SETUP_INVALID",
            "diagnostic_reason": "invalid_probe_configuration",
            "message_safe": "The compatibility probe configuration is invalid.",
        }
        print(json.dumps(error_report, indent=2, sort_keys=True))
        return 2


if __name__ == "__main__":
    sys.exit(main())
