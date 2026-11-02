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

# Tests replace this with httpx.MockTransport; production uses the default network transport.
_transport: httpx.AsyncBaseTransport | None = None


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
    ) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.category = category
        self.retryable = retryable
        self.message = message
        self.diagnostic_reason = diagnostic_reason


def _settings() -> dict[str, str]:
    return {
        "service_token": os.environ.get("PLANNER_SERVICE_TOKEN", "").strip(),
        "litellm_base_url": os.environ.get("PLANNER_LITELLM_BASE_URL", "").strip().rstrip("/"),
        "litellm_api_key": os.environ.get("PLANNER_LITELLM_API_KEY", "").strip(),
        "litellm_alias": os.environ.get("PLANNER_LITELLM_ALIAS", DEFAULT_MODEL_ALIAS).strip()
        or DEFAULT_MODEL_ALIAS,
        **{
            f"{task}_alias": os.environ.get(env_name, "").strip()
            for task, env_name in REQUIRED_TASK_ALIAS_ENV.items()
        },
    }


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


def _is_context_error(response: httpx.Response) -> bool:
    try:
        text = json.dumps(response.json()).lower()
    except ValueError:
        text = response.text.lower()
    return "context" in text and ("length" in text or "window" in text or "exceed" in text)


async def _complete(request: PlannerCompletionRequest, settings: dict[str, str]) -> dict[str, Any]:
    if not settings["litellm_base_url"] or not settings["litellm_api_key"]:
        raise PlannerError(503, "MODEL_UNAVAILABLE", "dependency", False, "Planning model is not configured.", "planner_unconfigured")

    alias = _model_alias(request.task, settings)
    if alias is None:
        raise PlannerError(503, "MODEL_UNAVAILABLE", "dependency", False, "The model for this task is not configured.", "model_alias_unconfigured")
    payload = {
        "model": alias,
        "messages": [
            {"role": "system", "content": request.system_prompt},
            {"role": "user", "content": json.dumps(request.user_payload, ensure_ascii=False)},
        ],
        "temperature": 0,
        "max_tokens": request.max_output_tokens,
        "response_format": {"type": "json_object"},
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
    if not isinstance(message, dict) or "content" not in message:
        raise PlannerError(502, "MODEL_OUTPUT_INVALID", "model", True, "The planning model returned no answer.", "model_content_missing")
    content = message.get("content")
    finish_reason = _safe_token(choice.get("finish_reason"))
    if finish_reason == "length":
        raise PlannerError(502, "MODEL_OUTPUT_INVALID", "model", True, "The planning answer was cut off.", "model_output_truncated")
    if not isinstance(content, str) or not content.strip():
        raise PlannerError(502, "MODEL_OUTPUT_INVALID", "model", True, "The planning model returned no answer.", "model_content_missing")
    try:
        content_json = json.loads(content)
    except ValueError as exc:
        raise PlannerError(502, "MODEL_OUTPUT_INVALID", "model", True, "The planning answer was not JSON.", "model_output_not_json") from exc
    if not isinstance(content_json, dict):
        raise PlannerError(502, "MODEL_OUTPUT_INVALID", "model", True, "The planning answer was not a JSON object.", "model_response_contract")

    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
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
    return {
        "status": "ok",
        "model_alias": settings["litellm_alias"],
        "task_model_aliases": {task: _model_alias(task, settings) for task in TASK_PROMPT_IDS},
        "task_aliases_configured": all(_model_alias(task, settings) for task in TASK_PROMPT_IDS),
        "litellm_configured": bool(settings["litellm_base_url"] and settings["litellm_api_key"]),
        "service_token_configured": bool(settings["service_token"]),
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
        )
        return _error_response(error, correlation_id, run_id, task)
