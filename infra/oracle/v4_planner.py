"""
HiveForYou V4 — Planner (D-039).

Authenticated planning endpoint for Analyze. The web server sends one `planner-completion@1`
request per model stage (intent, domain, intelligence, plan, study, writer); the planner forwards it
to the private LiteLLM gateway with a fixed model alias and a scoped virtual key that never leaves
Oracle, and returns the parsed JSON completion plus usage metadata.

- Callers cannot choose the model. Preparation tasks use `TASK_MODEL_ALIASES[task]` when set,
  otherwise `PLANNER_LITELLM_ALIAS` (`sorter`). `study` and `writer` use
  `PLANNER_STUDY_LITELLM_ALIAS` / `PLANNER_WRITER_LITELLM_ALIAS` and fail closed when unset.
- Bearer `PLANNER_SERVICE_TOKEN` is compared in constant time; an unset token fails closed.
- Logs carry identifiers, codes, token counts and latency only — never prompts, page text,
  completions or credentials.
- Mirrors `packages/contracts/src/study-preparation/planner-wire-contracts.ts`.
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import re
import time
import uuid
from typing import Any, Literal

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from model_json_parse import ModelJsonParseError, parse_model_json_object
from study_investigation_schema import (
    StudySchemaError,
    load_study_investigation_structured_schema,
    study_json_schema_response_format,
)

logger = logging.getLogger("hive_planner")

CONTRACT_VERSION = "planner-completion@1"
ERROR_CONTRACT_VERSION = "planner-error@1"
TASK_PROMPT_IDS: dict[str, str] = {
    "intent": "hive.intent-analysis/1",
    "domain": "hive-domain/1",
    "intelligence": "hive-intent-intelligence/1",
    "plan": "hive-plan/1",
    "study": "hive-study-preview/1",
    "writer": "hive-writer/1",
}
DEFAULT_MODEL_ALIAS = "sorter"
# Per-task model override; preparation tasks not listed use PLANNER_LITELLM_ALIAS.
TASK_MODEL_ALIASES: dict[str, str] = {
    "intelligence": "sorter",
}
# Study and Writer need deep-analysis models: each must be configured explicitly (D-041) and never
# falls back to the classification alias. Unset fails closed with MODEL_UNAVAILABLE.
REQUIRED_TASK_ALIAS_ENV: dict[str, str] = {
    "study": "PLANNER_STUDY_LITELLM_ALIAS",
    "writer": "PLANNER_WRITER_LITELLM_ALIAS",
}
TASK_MAX_OUTPUT_TOKENS: dict[str, int] = {
    "intent": 4000,
    "domain": 4000,
    "intelligence": 12000,
    "plan": 12000,
    "study": 32000,
    "writer": 16000,
}
MAX_OUTPUT_TOKENS = max(TASK_MAX_OUTPUT_TOKENS.values())
TASK_MAX_REQUEST_BYTES: dict[str, int] = {
    "intent": 256 * 1024,
    "domain": 256 * 1024,
    "intelligence": 256 * 1024,
    "plan": 256 * 1024,
    "study": 1536 * 1024,
    "writer": 768 * 1024,
}
MAX_REQUEST_BYTES = max(TASK_MAX_REQUEST_BYTES.values())
TASK_MAX_SYSTEM_PROMPT_CHARS: dict[str, int] = {
    "intent": 64_000,
    "domain": 64_000,
    "intelligence": 64_000,
    "plan": 64_000,
    "study": 1_400_000,
    "writer": 96_000,
}
MAX_SYSTEM_PROMPT_CHARS = max(TASK_MAX_SYSTEM_PROMPT_CHARS.values())
LITELLM_TIMEOUT_SECONDS = 150.0
# Below the web server's 280 s client timeout and the 300 s Vercel function limit.
TASK_LITELLM_TIMEOUT_SECONDS: dict[str, float] = {"study": 270.0, "writer": 270.0}

DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
SAFE_TOKEN_RE = re.compile(r"^[A-Za-z0-9_.:/@+-]{1,128}$")
TRUNCATED_FINISH_REASONS = frozenset({"length", "max_tokens"})
JSON_ERROR_CATEGORY_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
STUDY_STRUCTURED_OUTPUT_ENV = "PLANNER_STUDY_STRUCTURED_OUTPUT"

# Tests replace this with httpx.MockTransport; production uses the default network transport.
_transport: httpx.AsyncBaseTransport | None = None

_study_structured_schema: dict[str, object] | None = None
_study_structured_schema_error: str | None = None


def _load_study_structured_schema_cache() -> None:
    global _study_structured_schema, _study_structured_schema_error
    try:
        _study_structured_schema = load_study_investigation_structured_schema()
        _study_structured_schema_error = None
    except StudySchemaError as exc:
        _study_structured_schema = None
        _study_structured_schema_error = str(exc)


_load_study_structured_schema_cache()


class PlannerCompletionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["planner-completion@1"]
    task: Literal["intent", "domain", "intelligence", "plan", "study", "writer"]
    prompt_id: str = Field(min_length=1, max_length=64)
    prompt_digest: str = Field(min_length=1, max_length=80)
    system_prompt: str = Field(min_length=1, max_length=MAX_SYSTEM_PROMPT_CHARS)
    user_payload: dict[str, Any]
    max_output_tokens: int = Field(ge=1, le=MAX_OUTPUT_TOKENS)


class PlannerError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        category: str,
        retryable: bool,
        message: str,
        diagnostic_reason: str,
        *,
        log_fields: dict[str, object] | None = None,
    ) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.category = category
        self.retryable = retryable
        self.message = message
        self.diagnostic_reason = diagnostic_reason
        self.log_fields = log_fields or {}


def _settings() -> dict[str, str]:
    return {
        "service_token": os.environ.get("PLANNER_SERVICE_TOKEN", "").strip(),
        "litellm_base_url": os.environ.get("PLANNER_LITELLM_BASE_URL", "").strip().rstrip("/"),
        "litellm_api_key": os.environ.get("PLANNER_LITELLM_API_KEY", "").strip(),
        "litellm_alias": os.environ.get("PLANNER_LITELLM_ALIAS", DEFAULT_MODEL_ALIAS).strip()
        or DEFAULT_MODEL_ALIAS,
        "study_structured_output": os.environ.get(STUDY_STRUCTURED_OUTPUT_ENV, "").strip().lower(),
        **{
            f"{task}_alias": os.environ.get(env_name, "").strip()
            for task, env_name in REQUIRED_TASK_ALIAS_ENV.items()
        },
    }


def _study_structured_output_enabled(settings: dict[str, str]) -> bool:
    raw = settings.get("study_structured_output", "")
    return raw in {"1", "true", "yes", "json_schema", "structured", "on"}


def _correlation_id(raw: str | None) -> str:
    trimmed = (raw or "").strip()
    if trimmed and len(trimmed) <= 128 and SAFE_TOKEN_RE.match(trimmed):
        return trimmed
    return str(uuid.uuid4())


def _log(event: str, **fields: object) -> None:
    """One JSON line. Default logging formatters print the message, not `extra`."""
    payload = {"event": event, **{key: value for key, value in fields.items() if value is not None}}
    line = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    if event.endswith("_failed"):
        logger.warning(line)
    else:
        logger.info(line)


def _error_response(
    error: PlannerError,
    correlation_id: str,
    processing_run_id: str | None,
    task: str | None,
) -> JSONResponse:
    content: dict[str, object] = {
        "contract_version": ERROR_CONTRACT_VERSION,
        "error_code": error.code,
        "category": error.category,
        "retryable": error.retryable,
        "message_safe": error.message,
        "correlation_id": correlation_id,
        "component": "planner",
        "operation": "plan_completion",
        "diagnostic_reason": error.diagnostic_reason,
    }
    if processing_run_id:
        content["processing_run_id"] = processing_run_id
    if task:
        content["task"] = task
    return JSONResponse(status_code=error.status, content=content)


def _authorize(header: str | None, expected: str) -> None:
    if not expected:
        raise PlannerError(503, "DEPENDENCY_UNAVAILABLE", "dependency", False, "Planner is not configured.", "planner_unconfigured")
    scheme, _, presented = (header or "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(presented.strip().encode(), expected.encode()):
        raise PlannerError(401, "AUTH_FAILED", "authorization", False, "Planner authentication failed.", "planner_auth_failed")


def _parse_request(body: bytes) -> PlannerCompletionRequest:
    if len(body) > MAX_REQUEST_BYTES:
        raise PlannerError(413, "INVALID_REQUEST", "validation", False, "Planner request is too large.", "planner_invalid_request")
    try:
        parsed = PlannerCompletionRequest.model_validate_json(body)
    except ValidationError as exc:
        raise PlannerError(400, "INVALID_REQUEST", "validation", False, "Planner request is invalid.", "planner_invalid_request") from exc
    if parsed.prompt_id != TASK_PROMPT_IDS[parsed.task]:
        raise PlannerError(400, "INVALID_REQUEST", "validation", False, "Prompt does not match the task.", "planner_invalid_request")
    if not DIGEST_RE.match(parsed.prompt_digest):
        raise PlannerError(400, "INVALID_REQUEST", "validation", False, "Prompt digest is invalid.", "planner_invalid_request")
    if parsed.max_output_tokens > TASK_MAX_OUTPUT_TOKENS[parsed.task]:
        raise PlannerError(400, "INVALID_REQUEST", "validation", False, "Output limit is too high for the task.", "planner_invalid_request")
    if len(body) > TASK_MAX_REQUEST_BYTES[parsed.task]:
        raise PlannerError(413, "INVALID_REQUEST", "validation", False, "Planner request is too large.", "planner_invalid_request")
    if len(parsed.system_prompt) > TASK_MAX_SYSTEM_PROMPT_CHARS[parsed.task]:
        raise PlannerError(400, "INVALID_REQUEST", "validation", False, "Planner request is invalid.", "planner_invalid_request")
    return parsed


def _model_alias(task: str, settings: dict[str, str]) -> str | None:
    if task in REQUIRED_TASK_ALIAS_ENV:
        alias = settings.get(f"{task}_alias", "")
        return alias if alias and SAFE_TOKEN_RE.match(alias) else None
    return TASK_MODEL_ALIASES.get(task) or settings["litellm_alias"]


def _count(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def _safe_token(value: Any) -> str | None:
    return value if isinstance(value, str) and SAFE_TOKEN_RE.match(value) else None


def _json_error_category(exc: ValueError) -> str | None:
    """Safe parser label for logs only; never includes model text."""
    if not isinstance(exc, json.JSONDecodeError):
        return "json_decode_error"
    mapping = {
        "Expecting value": "expecting_value",
        "Unterminated string": "unterminated_string",
        "Expecting property name": "expecting_property_name",
        "Expecting ',' delimiter": "expecting_delimiter",
        "Extra data": "extra_data",
        "Invalid control character": "invalid_control_character",
    }
    for prefix, category in mapping.items():
        if str(exc.msg).startswith(prefix):
            return category if JSON_ERROR_CATEGORY_RE.match(category) else None
    return "json_decode_error"


def _first_content_category(content: str) -> str:
    """Classify leading structure without logging body text."""
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
    """Classify trailing structure without logging body text."""
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


def _json_decode_diagnostics(exc: json.JSONDecodeError) -> dict[str, object]:
    return {
        "json_error_line": exc.lineno,
        "json_error_column": exc.colno,
        "json_error_position": exc.pos,
    }


def _output_failure_log(
    *,
    model_alias: str,
    response_format_mode: str,
    finish_reason: str | None,
    completion_tokens: int | None,
    content: str | None,
    json_error_category: str | None = None,
    json_decode_exc: json.JSONDecodeError | None = None,
) -> dict[str, object]:
    fields: dict[str, object] = {
        "model_alias": model_alias,
        "response_format_mode": response_format_mode,
    }
    if finish_reason:
        fields["finish_reason"] = finish_reason
    if completion_tokens is not None:
        fields["completion_tokens"] = completion_tokens
    if content is not None:
        fields["content_char_count"] = len(content)
        fields["content_start_category"] = _first_content_category(content)
        fields["content_end_category"] = _ending_structure_category(content)
    if json_error_category:
        fields["json_error_category"] = json_error_category
    if json_decode_exc is not None:
        fields.update(_json_decode_diagnostics(json_decode_exc))
    return fields


def _is_truncated(finish_reason: str | None) -> bool:
    return finish_reason in TRUNCATED_FINISH_REASONS


def _is_context_error(response: httpx.Response) -> bool:
    try:
        text = json.dumps(response.json()).lower()
    except ValueError:
        text = response.text.lower()
    return "context" in text and ("length" in text or "window" in text or "exceed" in text)


def _response_format_mode(task: str, settings: dict[str, str]) -> str:
    if task == "study" and _study_structured_output_enabled(settings):
        return "json_schema"
    return "json_object"


def _litellm_response_format(task: str, settings: dict[str, str]) -> dict[str, object]:
    if _response_format_mode(task, settings) == "json_schema":
        if _study_structured_schema is None:
            raise PlannerError(
                503,
                "MODEL_UNAVAILABLE",
                "dependency",
                False,
                "The Canonical Study structured output schema is not available.",
                "structured_output_schema_unavailable",
            )
        return study_json_schema_response_format(_study_structured_schema)
    return {"type": "json_object"}


def _is_structured_output_rejection(response: httpx.Response) -> bool:
    if response.status_code not in (400, 422):
        return False
    try:
        text = json.dumps(response.json()).lower()
    except ValueError:
        text = response.text.lower()
    markers = (
        "json_schema",
        "output_format",
        "output_config",
        "structured output",
        "structured_output",
        "response_format",
        "schema",
    )
    return any(marker in text for marker in markers)


def _parse_error_category(exc: ModelJsonParseError) -> str | None:
    if exc.category == "invalid_json":
        return "expecting_value"
    if exc.category == "surrounding_text":
        return "expecting_value"
    return None


def _parse_json_content_diagnostic(exc: ModelJsonParseError) -> str:
    if exc.category in {"not_object", "invalid_type", "wrapped_json"}:
        return "model_response_contract"
    if exc.category == "empty":
        return "model_content_missing"
    if exc.category in {"surrounding_text", "invalid_json"}:
        return "model_output_not_json"
    return "model_response_contract"


async def _complete(request: PlannerCompletionRequest, settings: dict[str, str]) -> dict[str, Any]:
    if not settings["litellm_base_url"] or not settings["litellm_api_key"]:
        raise PlannerError(503, "MODEL_UNAVAILABLE", "dependency", False, "Planning model is not configured.", "planner_unconfigured")

    alias = _model_alias(request.task, settings)
    if alias is None:
        raise PlannerError(503, "MODEL_UNAVAILABLE", "dependency", False, "The model for this task is not configured.", "model_alias_unconfigured")
    format_mode = _response_format_mode(request.task, settings)
    payload = {
        "model": alias,
        "messages": [
            {"role": "system", "content": request.system_prompt},
            {"role": "user", "content": json.dumps(request.user_payload, ensure_ascii=False)},
        ],
        "temperature": 0,
        "max_tokens": request.max_output_tokens,
        "response_format": _litellm_response_format(request.task, settings),
    }
    started = time.monotonic()
    try:
        timeout = TASK_LITELLM_TIMEOUT_SECONDS.get(request.task, LITELLM_TIMEOUT_SECONDS)
        async with httpx.AsyncClient(transport=_transport, timeout=timeout) as client:
            response = await client.post(
                f"{settings['litellm_base_url']}/v1/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {settings['litellm_api_key']}"},
            )
    except httpx.TimeoutException as exc:
        raise PlannerError(504, "MODEL_TIMEOUT", "dependency", True, "The planning model timed out.", "litellm_timeout") from exc
    except httpx.HTTPError as exc:
        raise PlannerError(503, "MODEL_UNAVAILABLE", "dependency", True, "The planning model is unavailable.", "litellm_network_error") from exc
    latency_ms = int((time.monotonic() - started) * 1000)

    if response.status_code >= 400:
        if response.status_code in (400, 413) and _is_context_error(response):
            raise PlannerError(422, "MODEL_CONTEXT_EXCEEDED", "model", False, "The planning request is too long.", "model_context_exceeded")
        if format_mode == "json_schema" and _is_structured_output_rejection(response):
            raise PlannerError(
                502,
                "MODEL_OUTPUT_INVALID",
                "model",
                False,
                "The planning model rejected the structured output schema.",
                "structured_output_schema_rejected",
                log_fields={"model_alias": alias, "response_format_mode": format_mode},
            )
        if response.status_code in (401, 403):
            raise PlannerError(503, "MODEL_UNAVAILABLE", "dependency", False, "The planning model rejected the planner.", "litellm_http_error")
        retryable = response.status_code == 429 or response.status_code >= 500
        raise PlannerError(503, "MODEL_UNAVAILABLE", "dependency", retryable, "The planning model is unavailable.", "litellm_http_error")

    try:
        data = response.json()
    except ValueError as exc:
        raise PlannerError(502, "MODEL_OUTPUT_INVALID", "model", True, "The planning model returned no answer.", "model_response_contract") from exc
    if not isinstance(data, dict):
        raise PlannerError(502, "MODEL_OUTPUT_INVALID", "model", True, "The planning model returned no answer.", "model_response_contract")
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise PlannerError(502, "MODEL_OUTPUT_INVALID", "model", True, "The planning model returned no answer.", "model_response_contract")
    choice = choices[0]
    message = choice.get("message")
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    completion_tokens = _count(usage.get("completion_tokens"))
    finish_reason = _safe_token(choice.get("finish_reason"))
    if not isinstance(message, dict) or "content" not in message:
        raise PlannerError(
            502,
            "MODEL_OUTPUT_INVALID",
            "model",
            False,
            "The planning model returned no answer.",
            "model_content_missing",
            log_fields=_output_failure_log(
                model_alias=alias,
                response_format_mode=format_mode,
                finish_reason=finish_reason,
                completion_tokens=completion_tokens,
                content=None,
            ),
        )
    content = message.get("content")
    if _is_truncated(finish_reason):
        content_len = len(content) if isinstance(content, str) else None
        raise PlannerError(
            502,
            "MODEL_OUTPUT_INVALID",
            "model",
            False,
            "The planning answer was cut off.",
            "model_output_truncated",
            log_fields=_output_failure_log(
                model_alias=alias,
                response_format_mode=format_mode,
                finish_reason=finish_reason,
                completion_tokens=completion_tokens,
                content=content if isinstance(content, str) else None,
            ),
        )
    if not isinstance(content, str) or not content.strip():
        raise PlannerError(
            502,
            "MODEL_OUTPUT_INVALID",
            "model",
            False,
            "The planning model returned no answer.",
            "model_content_missing",
            log_fields=_output_failure_log(
                model_alias=alias,
                response_format_mode=format_mode,
                finish_reason=finish_reason,
                completion_tokens=completion_tokens,
                content=content if isinstance(content, str) else None,
            ),
        )
    try:
        content_json = parse_model_json_object(content)
    except json.JSONDecodeError as exc:
        raise PlannerError(
            502,
            "MODEL_OUTPUT_INVALID",
            "model",
            False,
            "The planning answer was not JSON.",
            "model_output_not_json",
            log_fields=_output_failure_log(
                model_alias=alias,
                response_format_mode=format_mode,
                finish_reason=finish_reason,
                completion_tokens=completion_tokens,
                content=content,
                json_error_category=_json_error_category(exc),
                json_decode_exc=exc,
            ),
        ) from exc
    except ModelJsonParseError as exc:
        diagnostic = _parse_json_content_diagnostic(exc)
        parse_category = _parse_error_category(exc)
        log_fields = _output_failure_log(
            model_alias=alias,
            response_format_mode=format_mode,
            finish_reason=finish_reason,
            completion_tokens=completion_tokens,
            content=content,
            json_error_category=parse_category,
        )
        if diagnostic == "model_output_not_json" and parse_category == "expecting_value":
            log_fields.update({"json_error_line": 1, "json_error_column": 1, "json_error_position": 0})
        raise PlannerError(
            502,
            "MODEL_OUTPUT_INVALID",
            "model",
            False,
            "The planning answer was not JSON.",
            diagnostic,
            log_fields=log_fields,
        ) from exc

    return {
        "contract_version": CONTRACT_VERSION,
        "task": request.task,
        "model_alias": alias,
        "resolved_model": _safe_token(data.get("model")),
        "content_json": content_json,
        "usage": {
            "prompt_tokens": _count(usage.get("prompt_tokens")),
            "completion_tokens": _count(usage.get("completion_tokens")),
            "total_tokens": _count(usage.get("total_tokens")),
        },
        "latency_ms": latency_ms,
        "finish_reason": finish_reason,
    }


app = FastAPI(title="HiveForYou V4 Planner", version="0.1.0")


@app.get("/health")
async def health() -> dict[str, object]:
    settings = _settings()
    structured_enabled = _study_structured_output_enabled(settings)
    return {
        "status": "ok",
        "model_alias": settings["litellm_alias"],
        "task_model_aliases": {task: _model_alias(task, settings) for task in TASK_PROMPT_IDS},
        "task_aliases_configured": all(_model_alias(task, settings) for task in TASK_PROMPT_IDS),
        "litellm_configured": bool(settings["litellm_base_url"] and settings["litellm_api_key"]),
        "service_token_configured": bool(settings["service_token"]),
        "study_structured_output": {
            "enabled": structured_enabled,
            "response_format_mode": "json_schema" if structured_enabled else "json_object",
            "schema_loaded": _study_structured_schema is not None,
            "schema_error": _study_structured_schema_error,
        },
    }


@app.post("/v1/plan-completion")
async def plan_completion(request: Request) -> JSONResponse:
    correlation_id = _correlation_id(request.headers.get("x-correlation-id"))
    run_id = _safe_token((request.headers.get("x-study-run-id") or "").strip())
    settings = _settings()
    task: str | None = None
    started = time.monotonic()
    try:
        _authorize(request.headers.get("authorization"), settings["service_token"])
        parsed = _parse_request(await request.body())
        task = parsed.task
        result = await _complete(parsed, settings)
        usage = result["usage"]
        _log(
            "v4_plan_completion_succeeded",
            correlation_id=correlation_id,
            processing_run_id=run_id,
            task=task,
            component="planner",
            operation="plan_completion",
            prompt_id=parsed.prompt_id,
            model_alias=result["model_alias"],
            prompt_tokens=usage["prompt_tokens"],
            completion_tokens=usage["completion_tokens"],
            latency_ms=result["latency_ms"],
        )
        return JSONResponse(status_code=200, content=result)
    except PlannerError as error:
        _log(
            "v4_plan_completion_failed",
            correlation_id=correlation_id,
            processing_run_id=run_id,
            task=task,
            component="planner",
            operation="plan_completion",
            error_code=error.code,
            diagnostic_reason=error.diagnostic_reason,
            retryable=error.retryable,
            latency_ms=int((time.monotonic() - started) * 1000),
            **error.log_fields,
        )
        return _error_response(error, correlation_id, run_id, task)
