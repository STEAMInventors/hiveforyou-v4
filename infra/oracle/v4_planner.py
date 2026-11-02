"""
HiveForYou V4 — Planner (D-039).

Authenticated planning endpoint for Analyze / Prompt Preview. The web server sends one
`planner-completion@1` request per planning stage (intent, domain, plan); the planner forwards it
to the private LiteLLM gateway with a fixed model alias and a scoped virtual key that never leaves
Oracle, and returns the parsed JSON completion plus usage metadata.

- Callers cannot choose the model: the alias comes only from `PLANNER_LITELLM_ALIAS` (`sorter`).
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
    "intent": "hive-intent/1",
    "domain": "hive-domain/1",
    "plan": "hive-plan/1",
}
DEFAULT_MODEL_ALIAS = "sorter"
MAX_OUTPUT_TOKENS = 4000
MAX_REQUEST_BYTES = 256 * 1024
MAX_SYSTEM_PROMPT_CHARS = 64_000
LITELLM_TIMEOUT_SECONDS = 90.0

DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
SAFE_TOKEN_RE = re.compile(r"^[A-Za-z0-9_.:/@+-]{1,128}$")

# Tests replace this with httpx.MockTransport; production uses the default network transport.
_transport: httpx.AsyncBaseTransport | None = None


class PlannerCompletionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["planner-completion@1"]
    task: Literal["intent", "domain", "plan"]
    prompt_id: str = Field(min_length=1, max_length=64)
    prompt_digest: str = Field(min_length=1, max_length=80)
    system_prompt: str = Field(min_length=1, max_length=MAX_SYSTEM_PROMPT_CHARS)
    user_payload: dict[str, Any]
    max_output_tokens: int = Field(ge=1, le=MAX_OUTPUT_TOKENS)


class PlannerError(Exception):
    def __init__(self, status: int, code: str, category: str, retryable: bool, message: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.category = category
        self.retryable = retryable
        self.message = message


def _settings() -> dict[str, str]:
    return {
        "service_token": os.environ.get("PLANNER_SERVICE_TOKEN", "").strip(),
        "litellm_base_url": os.environ.get("PLANNER_LITELLM_BASE_URL", "").strip().rstrip("/"),
        "litellm_api_key": os.environ.get("PLANNER_LITELLM_API_KEY", "").strip(),
        "litellm_alias": os.environ.get("PLANNER_LITELLM_ALIAS", DEFAULT_MODEL_ALIAS).strip()
        or DEFAULT_MODEL_ALIAS,
    }


def _correlation_id(raw: str | None) -> str:
    trimmed = (raw or "").strip()
    if trimmed and len(trimmed) <= 128 and SAFE_TOKEN_RE.match(trimmed):
        return trimmed
    return str(uuid.uuid4())


def _error_response(error: PlannerError, correlation_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=error.status,
        content={
            "contract_version": ERROR_CONTRACT_VERSION,
            "error_code": error.code,
            "category": error.category,
            "retryable": error.retryable,
            "message_safe": error.message,
            "correlation_id": correlation_id,
        },
    )


def _authorize(header: str | None, expected: str) -> None:
    if not expected:
        raise PlannerError(503, "DEPENDENCY_UNAVAILABLE", "dependency", False, "Planner is not configured.")
    scheme, _, presented = (header or "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(presented.strip().encode(), expected.encode()):
        raise PlannerError(401, "AUTH_FAILED", "authorization", False, "Planner authentication failed.")


def _parse_request(body: bytes) -> PlannerCompletionRequest:
    if len(body) > MAX_REQUEST_BYTES:
        raise PlannerError(413, "INVALID_REQUEST", "validation", False, "Planner request is too large.")
    try:
        parsed = PlannerCompletionRequest.model_validate_json(body)
    except ValidationError as exc:
        raise PlannerError(400, "INVALID_REQUEST", "validation", False, "Planner request is invalid.") from exc
    if parsed.prompt_id != TASK_PROMPT_IDS[parsed.task]:
        raise PlannerError(400, "INVALID_REQUEST", "validation", False, "Prompt does not match the task.")
    if not DIGEST_RE.match(parsed.prompt_digest):
        raise PlannerError(400, "INVALID_REQUEST", "validation", False, "Prompt digest is invalid.")
    return parsed


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
        raise PlannerError(503, "MODEL_UNAVAILABLE", "dependency", False, "Planning model is not configured.")

    payload = {
        "model": settings["litellm_alias"],
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
        async with httpx.AsyncClient(transport=_transport, timeout=LITELLM_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{settings['litellm_base_url']}/v1/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {settings['litellm_api_key']}"},
            )
    except httpx.TimeoutException as exc:
        raise PlannerError(504, "MODEL_TIMEOUT", "dependency", True, "The planning model timed out.") from exc
    except httpx.HTTPError as exc:
        raise PlannerError(503, "MODEL_UNAVAILABLE", "dependency", True, "The planning model is unavailable.") from exc
    latency_ms = int((time.monotonic() - started) * 1000)

    if response.status_code >= 400:
        if response.status_code in (400, 413) and _is_context_error(response):
            raise PlannerError(422, "MODEL_CONTEXT_EXCEEDED", "model", False, "The planning request is too long.")
        if response.status_code in (401, 403):
            raise PlannerError(503, "MODEL_UNAVAILABLE", "dependency", False, "The planning model rejected the planner.")
        retryable = response.status_code == 429 or response.status_code >= 500
        raise PlannerError(503, "MODEL_UNAVAILABLE", "dependency", retryable, "The planning model is unavailable.")

    try:
        data = response.json()
        choice = data["choices"][0]
        content = choice["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise PlannerError(502, "MODEL_OUTPUT_INVALID", "model", True, "The planning model returned no answer.") from exc

    finish_reason = _safe_token(choice.get("finish_reason"))
    if finish_reason == "length":
        raise PlannerError(502, "MODEL_OUTPUT_INVALID", "model", True, "The planning answer was cut off.")
    if not isinstance(content, str):
        raise PlannerError(502, "MODEL_OUTPUT_INVALID", "model", True, "The planning model returned no answer.")
    try:
        content_json = json.loads(content)
    except ValueError as exc:
        raise PlannerError(502, "MODEL_OUTPUT_INVALID", "model", True, "The planning answer was not JSON.") from exc
    if not isinstance(content_json, dict):
        raise PlannerError(502, "MODEL_OUTPUT_INVALID", "model", True, "The planning answer was not a JSON object.")

    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    return {
        "contract_version": CONTRACT_VERSION,
        "task": request.task,
        "model_alias": settings["litellm_alias"],
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
        logger.info(
            "v4_plan_completion_succeeded",
            extra={
                "correlation_id": correlation_id,
                "processing_run_id": run_id,
                "task": task,
                "prompt_id": parsed.prompt_id,
                "model_alias": result["model_alias"],
                "prompt_tokens": usage["prompt_tokens"],
                "completion_tokens": usage["completion_tokens"],
                "latency_ms": result["latency_ms"],
            },
        )
        return JSONResponse(status_code=200, content=result)
    except PlannerError as error:
        logger.warning(
            "v4_plan_completion_failed",
            extra={
                "correlation_id": correlation_id,
                "processing_run_id": run_id,
                "task": task,
                "error_code": error.code,
                "retryable": error.retryable,
                "latency_ms": int((time.monotonic() - started) * 1000),
            },
        )
        return _error_response(error, correlation_id)
