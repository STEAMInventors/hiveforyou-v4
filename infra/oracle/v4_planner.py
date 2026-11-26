"""
HiveForYou V4 — Planner (D-039, D-042, D-045).

Authenticated model relay for Analyze. Two contracts, both forwarded to the private LiteLLM gateway
with a fixed model alias and a scoped virtual key that never leaves Oracle:

- `planner-completion@1` (`POST /v1/plan-completion`): one JSON completion per preparation stage
  (intent, domain, intelligence, plan) or pipeline stage (extract, canonicalize, write). Returns the
  parsed JSON plus usage metadata.
- `study-agent-turn@1` (`POST /v1/study-agent-turn`): one native tool-calling turn of the Canonical
  Study investigation (`task: "study"`), Writer report generation (`task: "writer"`), or Domain Pack
  field mapping (`task: "mapping"`). Forwards the conversation and the fixed tool definitions and
  returns the model's tool calls unexecuted. The planner never runs a Hive tool; the web workflow does.

- Callers cannot choose the model. Preparation tasks use `TASK_MODEL_ALIASES[task]` when set,
  otherwise `PLANNER_LITELLM_ALIAS` (`sorter`). `study` and `mapping` turns use
  `PLANNER_STUDY_LITELLM_ALIAS`; `writer` turns use `PLANNER_WRITER_LITELLM_ALIAS`; `extract`,
  `canonicalize` and `write` use `PLANNER_{EXTRACT,CANONICALIZE,WRITE}_LITELLM_ALIAS`. Those aliases
  fail closed when unset. A mapping turn reuses the study alias. Before any case value is posted,
  the planner reads that alias from LiteLLM. A verified private runtime may proceed. The one
  approved external model may proceed only for a Hive id listed in
  `PLANNER_EXTERNAL_MAPPING_HIVE_IDS`. A synthetic label, `content_class`, or any other
  client claim is not authorization. Anything else is `provider_not_authorized` and is not
  called. `PLANNER_FIELD_MAPPING_LITELLM_ALIAS` is no longer a route.
- Bearer `PLANNER_SERVICE_TOKEN` is compared in constant time; an unset token fails closed.
- Logs carry identifiers, codes, token counts and latency only — never prompts, page text,
  messages, tool arguments, completions or credentials.
- Mirrors `packages/contracts/src/study-preparation/planner-wire-contracts.ts`.
"""

from __future__ import annotations

import hmac
import ipaddress
import json
import logging
import os
import re
import socket
import time
import uuid
from urllib.parse import urlparse
from typing import Annotated, Any, Literal, Union

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from model_json_parse import ModelJsonParseError, parse_model_json_object

logger = logging.getLogger("hive_planner")

CONTRACT_VERSION = "planner-completion@1"
STUDY_AGENT_CONTRACT_VERSION = "study-agent-turn@1"
ERROR_CONTRACT_VERSION = "planner-error@1"
TASK_PROMPT_IDS: dict[str, str] = {
    "intent": "hive.intent-analysis/1",
    "domain": "hive-domain/1",
    "intelligence": "hive-intent-intelligence/1",
    "plan": "hive-plan/1",
    "study": "hive-study-preview/1",
    "writer": "hive-writer/1",
    "extract": "hive-extract/1",
    "canonicalize": "hive-canonicalize/1",
    "write": "hive-write/1",
    "checklist_tailor": "checklist-tailor/1",
    "assistant_reply": "hive-assistant-reply/3",
}
PIPELINE_PROMPT_IDS_V2: dict[str, str] = {
    "canonicalize": "hive-canonicalize/2",
    "write": "hive-write/2",
    "assistant_reply": "hive-assistant-reply/2",
}
# Pinned rebuilds use this prompt on study-agent-turn task "mapping".
# Unpinned canonicalize stays on hive-canonicalize/1 and hive-canonicalize/2.
FIELD_MAPPING_PROMPT_ID = "hive.field-mapping-proposal/1"
FIELD_MAPPING_REQUEST_SCHEMA = "hive.field-mapping-request/1"
DOMAIN_INVESTIGATION_PROMPT_ID = "hive.domain-investigation/1"
FIELD_MAPPING_ALIAS_ENV = "PLANNER_FIELD_MAPPING_LITELLM_ALIAS"
# Server allowlist. Empty means no external mapping post. Client claims are not read.
EXTERNAL_MAPPING_HIVE_IDS_ENV = "PLANNER_EXTERNAL_MAPPING_HIVE_IDS"
HIVE_ID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
# Model id already configured as the study alias. Other Anthropic models stay unauthorized.
APPROVED_EXTERNAL_MODELS = {
    "anthropic/claude-opus-4-6": "api.anthropic.com",
}
# Prefix is the approved runtime. A private address is required as well, then a live model listing.
APPROVED_PRIVATE_PROVIDERS = (
    ("ollama_chat/", "ollama"),
    ("ollama/", "ollama"),
    ("hosted_vllm/", "vllm"),
)
PRIVATE_PROBE_TIMEOUT_SECONDS = 10.0
PRIVATE_MODEL_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@+/-]{0,199}$")
# A public provider prefix means the fact values would leave for that provider.
PUBLIC_MODEL_PREFIXES = (
    "anthropic/",
    "openai/",
    "azure/",
    "azure_ai/",
    "vertex_ai/",
    "vertex_ai_beta/",
    "gemini/",
    "google/",
    "groq/",
    "mistral/",
    "cohere/",
    "bedrock/",
    "fireworks_ai/",
    "together_ai/",
    "openrouter/",
    "perplexity/",
    "deepseek/",
    "xai/",
    "voyage/",
    "sagemaker/",
    "huggingface/",
    "replicate/",
    "ai21/",
    "palm/",
)


def _prompt_id_allowed(task: str, prompt_id: str) -> bool:
    if prompt_id in (FIELD_MAPPING_PROMPT_ID, DOMAIN_INVESTIGATION_PROMPT_ID):
        return False
    if prompt_id == TASK_PROMPT_IDS.get(task):
        return True
    return PIPELINE_PROMPT_IDS_V2.get(task) == prompt_id


def _payload_schema(payload: dict[str, Any]) -> str | None:
    schema = payload.get("schema")
    return schema if isinstance(schema, str) else None


def _validate_canonicalize_prompt(parsed: PlannerCompletionRequest) -> None:
    if parsed.prompt_id == FIELD_MAPPING_PROMPT_ID or _payload_schema(parsed.user_payload) == FIELD_MAPPING_REQUEST_SCHEMA:
        raise _invalid_request("Field mapping uses a study-agent turn.")
WRITER_SEMANTIC_REVIEW_PROMPT_ID = "hive.writer-semantic-review/1"
DEFAULT_MODEL_ALIAS = "sorter"
# Per-task model override; preparation tasks not listed use PLANNER_LITELLM_ALIAS.
TASK_MODEL_ALIASES: dict[str, str] = {
    "intelligence": "sorter",
    "checklist_tailor": "sorter",
}
# Study and Writer need deep-analysis models: each must be configured explicitly (D-041) and never
# falls back to the classification alias. Unset fails closed with MODEL_UNAVAILABLE.
REQUIRED_TASK_ALIAS_ENV: dict[str, str] = {
    "study": "PLANNER_STUDY_LITELLM_ALIAS",
    "writer": "PLANNER_WRITER_LITELLM_ALIAS",
    "extract": "PLANNER_EXTRACT_LITELLM_ALIAS",
    "canonicalize": "PLANNER_CANONICALIZE_LITELLM_ALIAS",
    "write": "PLANNER_WRITE_LITELLM_ALIAS",
    "assistant_reply": "PLANNER_ASSISTANT_LITELLM_ALIAS",
}
# `study` (D-042) and `writer` (D-045) run through /v1/study-agent-turn.
# `extract`, `canonicalize` and `write` are tool-free JSON completions on /v1/plan-completion.
TASK_MAX_OUTPUT_TOKENS: dict[str, int] = {
    "intent": 4000,
    "domain": 4000,
    "intelligence": 12000,
    "plan": 12000,
    "extract": 16000,
    "canonicalize": 16000,
    "write": 8000,
    "checklist_tailor": 4000,
    "assistant_reply": 1500,
}
MAX_OUTPUT_TOKENS = max(TASK_MAX_OUTPUT_TOKENS.values())
TASK_MAX_REQUEST_BYTES: dict[str, int] = {
    "intent": 256 * 1024,
    "domain": 256 * 1024,
    "intelligence": 256 * 1024,
    "plan": 256 * 1024,
    "extract": 1536 * 1024,
    "canonicalize": 2048 * 1024,
    "write": 1024 * 1024,
    "checklist_tailor": 256 * 1024,
    "assistant_reply": 192 * 1024,
}
MAX_REQUEST_BYTES = max(TASK_MAX_REQUEST_BYTES.values())
TASK_MAX_SYSTEM_PROMPT_CHARS: dict[str, int] = {
    "intent": 64_000,
    "domain": 64_000,
    "intelligence": 64_000,
    "plan": 64_000,
    "extract": 64_000,
    "canonicalize": 64_000,
    "write": 64_000,
    "checklist_tailor": 64_000,
    "assistant_reply": 64_000,
}
MAX_SYSTEM_PROMPT_CHARS = max(TASK_MAX_SYSTEM_PROMPT_CHARS.values())
LITELLM_TIMEOUT_SECONDS = 150.0
# Per-task override; tasks not listed use LITELLM_TIMEOUT_SECONDS. Web client waits 270 s (10 s above these).
TASK_LITELLM_TIMEOUT_SECONDS: dict[str, float] = {
    "extract": 260.0,
    "canonicalize": 600.0,
    "write": 260.0,
    "assistant_reply": 40.0,
}

# study-agent-turn@1 ceilings; the web budget stays below them.
STUDY_AGENT_LEGACY_TOOL_NAMES = frozenset(
    {
        "search_case",
        "read_pages",
        "record_evidence",
        "record_fact",
        "record_calculation",
        "record_assessment",
        "record_professional_determination",
        "flag_conflict",
        "report_ignored_instruction",
        "finish_question",
        "finish_study",
    }
)
STUDY_AGENT_DOCUMENT_TOOL_NAMES = frozenset(
    {
        "record_document",
        "record_document_finding",
    }
)
STUDY_AGENT_TOOL_NAMES = STUDY_AGENT_LEGACY_TOOL_NAMES | STUDY_AGENT_DOCUMENT_TOOL_NAMES
STUDY_ALLOWED_TOOL_SETS: tuple[frozenset[str], ...] = (
    STUDY_AGENT_LEGACY_TOOL_NAMES,
    STUDY_AGENT_TOOL_NAMES,
)
WRITER_AGENT_TOOL_NAMES = frozenset(
    {
        "set_report_outline",
        "record_section",
        "record_scenario",
        "record_view_component",
        "finish_report",
    }
)
WRITER_COMPOSE_TOOL_NAMES = frozenset(
    {
        "compose_writer_report",
        "apply_writer_correction",
    }
)
WRITER_EDITORIAL_TOOL_NAMES = frozenset(
    {
        "submit_editorial_plan",
        "patch_editorial_plan",
    }
)
WRITER_ALLOWED_TOOL_SETS: tuple[frozenset[str], ...] = (
    WRITER_COMPOSE_TOOL_NAMES,
    WRITER_AGENT_TOOL_NAMES,
    WRITER_COMPOSE_TOOL_NAMES | WRITER_AGENT_TOOL_NAMES,
    WRITER_EDITORIAL_TOOL_NAMES,
    WRITER_EDITORIAL_TOOL_NAMES | WRITER_AGENT_TOOL_NAMES,
    WRITER_EDITORIAL_TOOL_NAMES | WRITER_COMPOSE_TOOL_NAMES,
    WRITER_EDITORIAL_TOOL_NAMES | WRITER_COMPOSE_TOOL_NAMES | WRITER_AGENT_TOOL_NAMES,
)
MAPPING_AGENT_TOOL_NAMES = frozenset({"propose_field", "propose_relationship", "finish_mapping"})
INVESTIGATION_AGENT_TOOL_NAMES = frozenset({
    "search_case",
    "read_pages",
    "propose_field",
    "propose_relationship",
    "propose_document_role",
    "propose_measurement",
    "propose_assessment",
    "propose_determination",
    "propose_conflict",
    "propose_gap",
    "propose_answer",
    "finish_investigation",
})
AGENT_TASK_TOOLS: dict[str, frozenset[str]] = {
    "study": STUDY_AGENT_TOOL_NAMES,
    "writer": WRITER_AGENT_TOOL_NAMES,
    "mapping": MAPPING_AGENT_TOOL_NAMES,
    "investigation": INVESTIGATION_AGENT_TOOL_NAMES,
}
STUDY_AGENT_MAX_REQUEST_BYTES = 1024 * 1024
STUDY_AGENT_MAX_SYSTEM_PROMPT_CHARS = 200_000
STUDY_AGENT_MAX_USER_CONTENT_CHARS = 800_000
STUDY_AGENT_MAX_OUTPUT_TOKENS = 8000
STUDY_AGENT_MAX_MESSAGES = 600
STUDY_AGENT_MAX_TOOL_CALLS = 32
STUDY_AGENT_MAX_ARGUMENT_CHARS = 32_000
STUDY_AGENT_MAX_CONTENT_CHARS = 32_000
STUDY_AGENT_MAX_TOOL_RESULT_CHARS = 70_000

DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
SAFE_TOKEN_RE = re.compile(r"^[A-Za-z0-9_.:/@+-]{1,128}$")
TOOL_CALL_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
TOOL_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
TRUNCATED_FINISH_REASONS = frozenset({"length", "max_tokens"})
JSON_ERROR_CATEGORY_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")

# Tests replace this with httpx.MockTransport; production uses the default network transport.
_transport: httpx.AsyncBaseTransport | None = None


class PlannerCompletionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contract_version: Literal["planner-completion@1"]
    task: Literal[
        "intent",
        "domain",
        "intelligence",
        "plan",
        "extract",
        "canonicalize",
        "write",
        "checklist_tailor",
        "assistant_reply",
    ]
    prompt_id: str = Field(min_length=1, max_length=64)
    prompt_digest: str = Field(min_length=1, max_length=80)
    system_prompt: str = Field(min_length=1, max_length=MAX_SYSTEM_PROMPT_CHARS)
    user_payload: dict[str, Any]
    max_output_tokens: int = Field(ge=1, le=MAX_OUTPUT_TOKENS)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _ToolCallFunction(_Strict):
    name: str = Field(pattern=TOOL_NAME_RE.pattern)
    arguments: str = Field(max_length=STUDY_AGENT_MAX_ARGUMENT_CHARS)


class _ToolCall(_Strict):
    id: str = Field(pattern=TOOL_CALL_ID_RE.pattern)
    type: Literal["function"]
    function: _ToolCallFunction


class _UserMessage(_Strict):
    role: Literal["user"]
    content: str = Field(min_length=1, max_length=STUDY_AGENT_MAX_USER_CONTENT_CHARS)


class _AssistantMessage(_Strict):
    role: Literal["assistant"]
    content: str | None = Field(default=None, max_length=STUDY_AGENT_MAX_CONTENT_CHARS)
    tool_calls: list[_ToolCall] = Field(max_length=STUDY_AGENT_MAX_TOOL_CALLS)


class _ToolMessage(_Strict):
    role: Literal["tool"]
    tool_call_id: str = Field(pattern=TOOL_CALL_ID_RE.pattern)
    content: str = Field(min_length=1, max_length=STUDY_AGENT_MAX_TOOL_RESULT_CHARS)


_Message = Annotated[Union[_UserMessage, _AssistantMessage, _ToolMessage], Field(discriminator="role")]


class _ToolDefinitionFunction(_Strict):
    name: str
    description: str = Field(min_length=1, max_length=2000)
    parameters: dict[str, Any]


class _ToolDefinition(_Strict):
    type: Literal["function"]
    function: _ToolDefinitionFunction


class StudyAgentTurnRequest(_Strict):
    contract_version: Literal["study-agent-turn@1"]
    task: Literal["study", "writer", "mapping", "investigation"] = "study"
    prompt_id: str = Field(min_length=1, max_length=64)
    prompt_digest: str = Field(min_length=1, max_length=80)
    system_prompt: str = Field(min_length=1, max_length=STUDY_AGENT_MAX_SYSTEM_PROMPT_CHARS)
    messages: list[_Message] = Field(min_length=1, max_length=STUDY_AGENT_MAX_MESSAGES)
    tools: list[_ToolDefinition] = Field(min_length=0, max_length=len(STUDY_AGENT_TOOL_NAMES))
    max_output_tokens: int = Field(ge=1, le=STUDY_AGENT_MAX_OUTPUT_TOKENS)
    timeout_seconds: int = Field(ge=5, le=240)
    # Server-known Hive id. Not a synthetic claim. Study and Writer turns ignore it.
    hive_id: str | None = Field(default=None, pattern=HIVE_ID_RE.pattern)


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


def _invalid_request(message: str, status: int = 400) -> PlannerError:
    return PlannerError(status, "INVALID_REQUEST", "validation", False, message, "planner_invalid_request")


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
        "field_mapping_alias": os.environ.get(FIELD_MAPPING_ALIAS_ENV, "").strip(),
        "external_mapping_hive_ids": os.environ.get(EXTERNAL_MAPPING_HIVE_IDS_ENV, "").strip(),
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
    operation: str = "plan_completion",
) -> JSONResponse:
    content: dict[str, object] = {
        "contract_version": ERROR_CONTRACT_VERSION,
        "error_code": error.code,
        "category": error.category,
        "retryable": error.retryable,
        "message_safe": error.message,
        "correlation_id": correlation_id,
        "component": "planner",
        "operation": operation,
        "diagnostic_reason": error.diagnostic_reason,
    }
    if processing_run_id:
        content["processing_run_id"] = processing_run_id
    if task:
        content["task"] = task
    headers = {
        "x-planner-error-code": error.code,
        "x-planner-diagnostic-reason": error.diagnostic_reason,
        "x-planner-retryable": "true" if error.retryable else "false",
    }
    return JSONResponse(status_code=error.status, content=content, headers=headers)


def _authorize(header: str | None, expected: str) -> None:
    if not expected:
        raise PlannerError(503, "DEPENDENCY_UNAVAILABLE", "dependency", False, "Planner is not configured.", "planner_unconfigured")
    scheme, _, presented = (header or "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(presented.strip().encode(), expected.encode()):
        raise PlannerError(401, "AUTH_FAILED", "authorization", False, "Planner authentication failed.", "planner_auth_failed")


def _parse_request(body: bytes) -> PlannerCompletionRequest:
    if len(body) > MAX_REQUEST_BYTES:
        raise _invalid_request("Planner request is too large.", 413)
    try:
        parsed = PlannerCompletionRequest.model_validate_json(body)
    except ValidationError as exc:
        raise _invalid_request("Planner request is invalid.") from exc
    if not _prompt_id_allowed(parsed.task, parsed.prompt_id):
        raise _invalid_request("Prompt does not match the task.")
    if parsed.task == "canonicalize":
        _validate_canonicalize_prompt(parsed)
    if not DIGEST_RE.match(parsed.prompt_digest):
        raise _invalid_request("Prompt digest is invalid.")
    if parsed.max_output_tokens > TASK_MAX_OUTPUT_TOKENS[parsed.task]:
        raise _invalid_request("Output limit is too high for the task.")
    if len(body) > TASK_MAX_REQUEST_BYTES[parsed.task]:
        raise _invalid_request("Planner request is too large.", 413)
    if len(parsed.system_prompt) > TASK_MAX_SYSTEM_PROMPT_CHARS[parsed.task]:
        raise _invalid_request("Planner request is invalid.")
    return parsed


def _parse_agent_request(body: bytes) -> StudyAgentTurnRequest:
    if len(body) > STUDY_AGENT_MAX_REQUEST_BYTES:
        raise _invalid_request("Planner request is too large.", 413)
    try:
        parsed = StudyAgentTurnRequest.model_validate_json(body)
    except ValidationError as exc:
        raise _invalid_request("Planner request is invalid.") from exc
    if not DIGEST_RE.match(parsed.prompt_digest):
        raise _invalid_request("Prompt digest is invalid.")
    if parsed.task == "mapping":
        if parsed.prompt_id != FIELD_MAPPING_PROMPT_ID:
            raise _invalid_request("Prompt does not match the task.")
    elif parsed.task == "investigation":
        if parsed.prompt_id != DOMAIN_INVESTIGATION_PROMPT_ID:
            raise _invalid_request("Prompt does not match the task.")
    elif parsed.prompt_id == WRITER_SEMANTIC_REVIEW_PROMPT_ID:
        if parsed.task != "writer":
            raise _invalid_request("Semantic review requires task writer.")
        if len(parsed.tools) != 0:
            raise _invalid_request("Semantic review turns must not include tools.")
        if len(parsed.messages) != 1 or not isinstance(parsed.messages[0], _UserMessage):
            raise _invalid_request("Semantic review requires a single user message.")
    elif parsed.prompt_id != TASK_PROMPT_IDS[parsed.task]:
        raise _invalid_request("Prompt does not match the task.")
    expected_tools = AGENT_TASK_TOOLS[parsed.task]
    names = [tool.function.name for tool in parsed.tools]
    name_set = set(names)
    if parsed.prompt_id != WRITER_SEMANTIC_REVIEW_PROMPT_ID and len(parsed.tools) == 0:
        raise _invalid_request("Tool-calling turns require at least one tool.")
    if parsed.prompt_id == WRITER_SEMANTIC_REVIEW_PROMPT_ID:
        pass
    elif parsed.task == "writer":
        if len(names) != len(name_set) or name_set not in WRITER_ALLOWED_TOOL_SETS:
            raise _invalid_request("Tools do not match the writer tool set.")
    elif parsed.task == "study":
        if len(names) != len(name_set) or name_set not in STUDY_ALLOWED_TOOL_SETS:
            raise _invalid_request("Tools do not match the study tool set.")
    elif parsed.task == "mapping":
        if len(names) != len(name_set) or name_set != MAPPING_AGENT_TOOL_NAMES:
            raise _invalid_request("Tools do not match the mapping tool set.")
    elif parsed.task == "investigation":
        if len(names) != len(name_set) or name_set != INVESTIGATION_AGENT_TOOL_NAMES:
            raise _invalid_request("Tools do not match the investigation tool set.")
    elif len(names) != len(expected_tools) or name_set != expected_tools:
        raise _invalid_request(f"Tools do not match the {parsed.task} tool set.")
    for tool in parsed.tools:
        params = tool.function.parameters
        if (
            params.get("type") != "object"
            or params.get("additionalProperties") is not False
            or not isinstance(params.get("properties"), dict)
            or ("required" in params and not isinstance(params.get("required"), list))
        ):
            raise _invalid_request("Tool parameters must be a closed object schema.")
    if not isinstance(parsed.messages[0], _UserMessage):
        raise _invalid_request("The conversation must start with a user message.")
    pending: set[str] = set()
    for message in parsed.messages:
        if isinstance(message, _AssistantMessage):
            pending = {call.id for call in message.tool_calls}
        elif isinstance(message, _ToolMessage):
            if message.tool_call_id not in pending:
                raise _invalid_request("A tool result does not answer the preceding tool calls.")
            pending.discard(message.tool_call_id)
    return parsed


def _model_alias(task: str, settings: dict[str, str]) -> str | None:
    if task in ("mapping", "investigation"):
        return _model_alias("study", settings)
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
    finish_reason: str | None,
    completion_tokens: int | None,
    content: str | None,
    json_error_category: str | None = None,
    json_decode_exc: json.JSONDecodeError | None = None,
) -> dict[str, object]:
    fields: dict[str, object] = {"model_alias": model_alias}
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


def _no_answer(diagnostic_reason: str = "model_response_contract", *, retryable: bool = True, **log: object) -> PlannerError:
    return PlannerError(
        422, "MODEL_OUTPUT_INVALID", "model", retryable, "The planning model returned no answer.", diagnostic_reason, log_fields=log or None
    )


async def _post_litellm(settings: dict[str, str], payload: dict[str, object], timeout: float) -> tuple[dict[str, Any], dict[str, Any], int]:
    """POSTs one chat completion; returns (response, first choice, latency) or raises a safe PlannerError."""
    started = time.monotonic()
    try:
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
        raise _no_answer() from exc
    if not isinstance(data, dict):
        raise _no_answer()
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise _no_answer()
    return data, choices[0], latency_ms


def _usage(data: dict[str, Any]) -> dict[str, int | None]:
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    return {
        "prompt_tokens": _count(usage.get("prompt_tokens")),
        "completion_tokens": _count(usage.get("completion_tokens")),
        "total_tokens": _count(usage.get("total_tokens")),
    }


def _require_litellm(settings: dict[str, str]) -> None:
    if not settings["litellm_base_url"] or not settings["litellm_api_key"]:
        raise PlannerError(503, "MODEL_UNAVAILABLE", "dependency", False, "Planning model is not configured.", "planner_unconfigured")


def _require_alias(task: str, settings: dict[str, str]) -> str:
    alias = _model_alias(task, settings)
    if alias is None:
        raise PlannerError(503, "MODEL_UNAVAILABLE", "dependency", False, "The model for this task is not configured.", "model_alias_unconfigured")
    return alias


def _provider_not_authorized() -> PlannerError:
    return PlannerError(
        503,
        "MODEL_UNAVAILABLE",
        "dependency",
        False,
        "This provider is not authorized for this hive.",
        "provider_not_authorized",
    )


def _private_route_unavailable() -> PlannerError:
    return PlannerError(
        503,
        "MODEL_UNAVAILABLE",
        "dependency",
        False,
        "Private processing could not be confirmed.",
        "private_route_unverified",
    )


def _field_mapping_alias(settings: dict[str, str]) -> str | None:
    alias = settings.get("field_mapping_alias", "")
    return alias if alias and SAFE_TOKEN_RE.match(alias) else None


def _address_is_approved_private(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if address.is_loopback:
        return True
    if address.is_multicast or address.is_unspecified or address.is_reserved or address.is_link_local:
        return False
    return bool(address.is_private)


def _host_resolves_to_private_addresses(hostname: str) -> bool:
    host = hostname.lower().strip("[]").rstrip(".")
    if not host:
        return False
    if host == "localhost":
        return True
    try:
        return _address_is_approved_private(ipaddress.ip_address(host))
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return False
    found = False
    for info in infos:
        raw = str(info[4][0]).split("%", 1)[0]
        try:
            address = ipaddress.ip_address(raw)
        except ValueError:
            return False
        if not _address_is_approved_private(address):
            return False
        found = True
    return found


def _api_base_is_reachable_privately(api_base: str) -> bool:
    parsed = urlparse(api_base.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return False
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        return False
    return _host_resolves_to_private_addresses(parsed.hostname)


def _approved_private_model(model: str) -> tuple[str, str] | None:
    """Approved runtime prefix plus model id. A private host is not a provider."""
    stripped = model.strip()
    lowered = stripped.lower()
    if not lowered or any(lowered.startswith(prefix) for prefix in PUBLIC_MODEL_PREFIXES):
        return None
    for prefix, kind in APPROVED_PRIVATE_PROVIDERS:
        if lowered.startswith(prefix):
            model_id = stripped[len(prefix) :]
            if PRIVATE_MODEL_ID_RE.match(model_id):
                return kind, model_id
            return None
    return None


def _probe_url(kind: str, api_base: str) -> str:
    parsed = urlparse(api_base.strip())
    host = parsed.hostname or ""
    if ":" in host:
        host = f"[{host}]"
    port = f":{parsed.port}" if parsed.port else ""
    origin = f"{parsed.scheme}://{host}{port}"
    if kind == "ollama":
        return origin + "/api/tags"
    return origin + "/v1/models"


def _probe_confirms_model(kind: str, model_id: str, payload: object) -> bool:
    if not isinstance(payload, dict):
        return False
    if kind == "ollama":
        rows = payload.get("models")
        if not isinstance(rows, list):
            return False
        for row in rows:
            if not isinstance(row, dict):
                continue
            for key in ("name", "model"):
                value = row.get(key)
                if isinstance(value, str) and (value == model_id or value.startswith(model_id + ":")):
                    return True
        return False
    rows = payload.get("data")
    if not isinstance(rows, list):
        return False
    return any(isinstance(row, dict) and row.get("id") == model_id for row in rows)


async def _read_model_info(settings: dict[str, str]) -> dict[str, Any]:
    payload: dict[str, Any] | None = None
    try:
        async with httpx.AsyncClient(transport=_transport, timeout=PRIVATE_PROBE_TIMEOUT_SECONDS, follow_redirects=False) as client:
            for path in ("/v1/model/info", "/model/info"):
                response = await client.get(
                    f"{settings['litellm_base_url']}{path}",
                    headers={"Authorization": f"Bearer {settings['litellm_api_key']}"},
                )
                if response.status_code == 404:
                    continue
                if response.status_code != 200:
                    raise _private_route_unavailable()
                try:
                    parsed = response.json()
                except ValueError as exc:
                    raise _private_route_unavailable() from exc
                if not isinstance(parsed, dict):
                    raise _private_route_unavailable()
                payload = parsed
                break
    except PlannerError:
        raise
    except httpx.HTTPError as exc:
        raise _private_route_unavailable() from exc
    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise _private_route_unavailable()
    return payload


async def _probe_private_endpoint(kind: str, model_id: str, api_base: str) -> None:
    """Confirms the runtime lists this model. Sends no case text and no LiteLLM key."""
    try:
        async with httpx.AsyncClient(transport=_transport, timeout=PRIVATE_PROBE_TIMEOUT_SECONDS, follow_redirects=False) as client:
            response = await client.get(_probe_url(kind, api_base))
    except httpx.HTTPError as exc:
        raise _private_route_unavailable() from exc
    if response.status_code != 200:
        raise _private_route_unavailable()
    try:
        body = response.json()
    except ValueError as exc:
        raise _private_route_unavailable() from exc
    if not _probe_confirms_model(kind, model_id, body):
        raise _private_route_unavailable()


def _designated_external_mapping_hives(settings: dict[str, str]) -> frozenset[str]:
    """UUIDs from the server allowlist only. A non-UUID token, including the word synthetic, is dropped."""
    found: set[str] = set()
    for part in settings.get("external_mapping_hive_ids", "").split(","):
        hive_id = part.strip().lower()
        if HIVE_ID_RE.match(hive_id):
            found.add(hive_id)
    return frozenset(found)


def _approved_external_route(model: str, api_base: object) -> bool:
    """Official Anthropic host, or LiteLLM's default when no api_base is set. No other host."""
    expected_host = APPROVED_EXTERNAL_MODELS.get(model.strip())
    if expected_host is None:
        return False
    if not isinstance(api_base, str) or not api_base.strip():
        return True
    parsed = urlparse(api_base.strip())
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.query or parsed.fragment:
        return False
    if (parsed.hostname or "").lower() != expected_host:
        return False
    return parsed.path.rstrip("/") in {"", "/v1"}


def _classify_mapping_deployment(row: dict[str, Any]) -> tuple[str, tuple[str, str, str] | None]:
    params = row.get("litellm_params") if isinstance(row.get("litellm_params"), dict) else {}
    model = params.get("model")
    api_base = params.get("api_base")
    if not isinstance(model, str) or not model.strip():
        raise _provider_not_authorized()
    private = _approved_private_model(model)
    if private is not None:
        if not isinstance(api_base, str) or not _api_base_is_reachable_privately(api_base):
            raise _private_route_unavailable()
        kind, model_id = private
        return "private", (kind, model_id, api_base)
    if _approved_external_route(model, api_base):
        return "external", None
    raise _provider_not_authorized()


async def _assert_mapping_provider(settings: dict[str, str], alias: str, hive_id: str | None) -> None:
    """Classifies the study alias before any fact value is posted. Does not read content_class or a synthetic flag."""
    payload = await _read_model_info(settings)
    matches = [row for row in payload["data"] if isinstance(row, dict) and row.get("model_name") == alias]
    if not matches:
        raise _provider_not_authorized()
    kinds: list[str] = []
    private_targets: list[tuple[str, str, str]] = []
    for row in matches:
        kind, target = _classify_mapping_deployment(row)
        kinds.append(kind)
        if target is not None:
            private_targets.append(target)
    if len(set(kinds)) != 1:
        raise _provider_not_authorized()
    if kinds[0] == "private":
        for kind, model_id, api_base in private_targets:
            await _probe_private_endpoint(kind, model_id, api_base)
        return
    normalized = (hive_id or "").strip().lower()
    if normalized not in _designated_external_mapping_hives(settings):
        raise _provider_not_authorized()


async def _complete(request: PlannerCompletionRequest, settings: dict[str, str]) -> dict[str, Any]:
    _require_litellm(settings)
    alias = _require_alias(request.task, settings)
    payload: dict[str, object] = {
        "model": alias,
        "messages": [
            {"role": "system", "content": request.system_prompt},
            {"role": "user", "content": json.dumps(request.user_payload, ensure_ascii=False)},
        ],
        "temperature": 0,
        "max_tokens": request.max_output_tokens,
        "response_format": {"type": "json_object"},
    }
    timeout = TASK_LITELLM_TIMEOUT_SECONDS.get(request.task, LITELLM_TIMEOUT_SECONDS)
    data, choice, latency_ms = await _post_litellm(settings, payload, timeout)
    message = choice.get("message")
    usage = _usage(data)
    completion_tokens = usage["completion_tokens"]
    finish_reason = _safe_token(choice.get("finish_reason"))
    if not isinstance(message, dict) or "content" not in message:
        raise _no_answer(
            "model_content_missing",
            retryable=False,
            **_output_failure_log(model_alias=alias, finish_reason=finish_reason, completion_tokens=completion_tokens, content=None),
        )
    content = message.get("content")
    if _is_truncated(finish_reason):
        raise PlannerError(
            422,
            "MODEL_OUTPUT_INVALID",
            "model",
            False,
            "The planning answer was cut off.",
            "model_output_truncated",
            log_fields=_output_failure_log(
                model_alias=alias,
                finish_reason=finish_reason,
                completion_tokens=completion_tokens,
                content=content if isinstance(content, str) else None,
            ),
        )
    if not isinstance(content, str) or not content.strip():
        raise _no_answer(
            "model_content_missing",
            retryable=False,
            **_output_failure_log(
                model_alias=alias,
                finish_reason=finish_reason,
                completion_tokens=completion_tokens,
                content=content if isinstance(content, str) else None,
            ),
        )
    try:
        content_json = parse_model_json_object(content)
    except json.JSONDecodeError as exc:
        raise PlannerError(
            422,
            "MODEL_OUTPUT_INVALID",
            "model",
            False,
            "The planning answer was not JSON.",
            "model_output_not_json",
            log_fields=_output_failure_log(
                model_alias=alias,
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
            finish_reason=finish_reason,
            completion_tokens=completion_tokens,
            content=content,
            json_error_category=parse_category,
        )
        if diagnostic == "model_output_not_json" and parse_category == "expecting_value":
            log_fields.update({"json_error_line": 1, "json_error_column": 1, "json_error_position": 0})
        raise PlannerError(
            422,
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
        "usage": usage,
        "latency_ms": latency_ms,
        "finish_reason": finish_reason,
    }


def _dump_message(message: _UserMessage | _AssistantMessage | _ToolMessage) -> dict[str, object]:
    dumped = message.model_dump()
    if isinstance(message, _AssistantMessage) and not message.tool_calls:
        return {"role": "assistant", "content": message.content or "(no tool call)"}
    return dumped


async def _agent_json_content_turn(request: StudyAgentTurnRequest, settings: dict[str, str]) -> dict[str, Any]:
    """One Writer semantic-review turn: JSON completion in message content, no tools (V4-005)."""
    _require_litellm(settings)
    alias = _require_alias(request.task, settings)
    user = request.messages[0]
    if not isinstance(user, _UserMessage):
        raise _invalid_request("Semantic review requires a single user message.")
    payload: dict[str, object] = {
        "model": alias,
        "messages": [{"role": "system", "content": request.system_prompt}, {"role": "user", "content": user.content}],
        "temperature": 0,
        "max_tokens": request.max_output_tokens,
        "response_format": {"type": "json_object"},
    }
    data, choice, latency_ms = await _post_litellm(settings, payload, float(request.timeout_seconds))
    usage = _usage(data)
    completion_tokens = usage["completion_tokens"]
    finish_reason = _safe_token(choice.get("finish_reason"))
    if _is_truncated(finish_reason):
        raise PlannerError(
            422, "MODEL_OUTPUT_INVALID", "model", False, "The planning answer was cut off.", "model_output_truncated",
            log_fields=_output_failure_log(model_alias=alias, finish_reason=finish_reason, completion_tokens=completion_tokens, content=None),
        )
    message = choice.get("message")
    if not isinstance(message, dict):
        raise _no_answer(retryable=False, model_alias=alias, finish_reason=finish_reason, completion_tokens=completion_tokens)
    content = message.get("content")
    if not isinstance(content, str) or not content.strip() or len(content) > STUDY_AGENT_MAX_CONTENT_CHARS:
        raise _no_answer(
            "model_content_missing",
            retryable=False,
            model_alias=alias,
            finish_reason=finish_reason,
            completion_tokens=completion_tokens,
            content=content if isinstance(content, str) else None,
        )
    try:
        parse_model_json_object(content)
    except (json.JSONDecodeError, ModelJsonParseError) as exc:
        diagnostic = _parse_json_content_diagnostic(exc) if isinstance(exc, ModelJsonParseError) else "model_output_not_json"
        raise PlannerError(
            422,
            "MODEL_OUTPUT_INVALID",
            "model",
            False,
            "The planning answer was not JSON.",
            diagnostic,
            log_fields=_output_failure_log(
                model_alias=alias,
                finish_reason=finish_reason,
                completion_tokens=completion_tokens,
                content=content,
            ),
        ) from exc
    return {
        "contract_version": STUDY_AGENT_CONTRACT_VERSION,
        "model_alias": alias,
        "resolved_model": _safe_token(data.get("model")),
        "message": {"content": content.strip(), "tool_calls": []},
        "usage": usage,
        "latency_ms": latency_ms,
        "finish_reason": finish_reason,
    }


async def _agent_turn(request: StudyAgentTurnRequest, settings: dict[str, str]) -> dict[str, Any]:
    """Relays one Study, Writer, or mapping tool-calling turn. Returns the model's tool calls; never executes them."""
    _require_litellm(settings)
    alias = _require_alias(request.task, settings)
    if request.task in ("mapping", "investigation"):
        await _assert_mapping_provider(settings, alias, request.hive_id)
    payload: dict[str, object] = {
        "model": alias,
        "messages": [{"role": "system", "content": request.system_prompt}, *(_dump_message(m) for m in request.messages)],
        "tools": [tool.model_dump() for tool in request.tools],
        "tool_choice": "required",
        "temperature": 0,
        "max_tokens": request.max_output_tokens,
    }
    data, choice, latency_ms = await _post_litellm(settings, payload, float(request.timeout_seconds))
    usage = _usage(data)
    finish_reason = _safe_token(choice.get("finish_reason"))
    log = {"model_alias": alias, "finish_reason": finish_reason, "completion_tokens": usage["completion_tokens"]}
    if _is_truncated(finish_reason):
        raise PlannerError(
            422, "MODEL_OUTPUT_INVALID", "model", False, "The planning answer was cut off.", "model_output_truncated", log_fields=log
        )
    message = choice.get("message")
    if not isinstance(message, dict):
        raise _no_answer("model_content_missing", retryable=False, **log)
    content = message.get("content")
    if content is not None and (not isinstance(content, str) or len(content) > STUDY_AGENT_MAX_CONTENT_CHARS):
        raise _no_answer(retryable=False, **log)
    raw_calls = message.get("tool_calls") or []
    if not isinstance(raw_calls, list) or len(raw_calls) > STUDY_AGENT_MAX_TOOL_CALLS:
        raise _no_answer(retryable=False, **log, tool_call_count=len(raw_calls) if isinstance(raw_calls, list) else None)
    tool_calls: list[dict[str, str]] = []
    for raw in raw_calls:
        function = raw.get("function") if isinstance(raw, dict) else None
        call_id = raw.get("id") if isinstance(raw, dict) else None
        name = function.get("name") if isinstance(function, dict) else None
        arguments = function.get("arguments") if isinstance(function, dict) else None
        if arguments is None:
            arguments = ""
        if (
            not isinstance(call_id, str)
            or not TOOL_CALL_ID_RE.match(call_id)
            or not isinstance(name, str)
            or not TOOL_NAME_RE.match(name)
            or not isinstance(arguments, str)
            or len(arguments) > STUDY_AGENT_MAX_ARGUMENT_CHARS
        ):
            raise _no_answer(retryable=False, **log)
        tool_calls.append({"id": call_id, "name": name, "arguments": arguments})
    return {
        "contract_version": STUDY_AGENT_CONTRACT_VERSION,
        "model_alias": alias,
        "resolved_model": _safe_token(data.get("model")),
        "message": {"content": content if isinstance(content, str) and content.strip() else None, "tool_calls": tool_calls},
        "usage": usage,
        "latency_ms": latency_ms,
        "finish_reason": finish_reason,
    }


app = FastAPI(title="HiveForYou V4 Planner", version="0.2.0")


def _planner_job_workers() -> int:
    raw = os.environ.get("PLANNER_JOB_WORKERS", "").strip()
    try:
        workers = int(raw) if raw else 4
    except ValueError:
        workers = 4
    return max(1, min(workers, 32))


def _ensure_planner_job_store() -> None:
    from planner_jobs import ensure_job_store

    async def _run(request: PlannerCompletionRequest) -> dict[str, Any]:
        settings = _settings()
        return await _complete(request, settings)

    ensure_job_store(_run, max_workers=_planner_job_workers())


@app.get("/health")
async def health() -> dict[str, object]:
    settings = _settings()
    return {
        "status": "ok",
        "model_alias": settings["litellm_alias"],
        "task_model_aliases": {task: _model_alias(task, settings) for task in TASK_PROMPT_IDS},
        "task_aliases_configured": all(_model_alias(task, settings) for task in TASK_PROMPT_IDS),
        "field_mapping_alias": _field_mapping_alias(settings),
        "external_mapping_hive_count": len(_designated_external_mapping_hives(settings)),
        "litellm_configured": bool(settings["litellm_base_url"] and settings["litellm_api_key"]),
        "service_token_configured": bool(settings["service_token"]),
        "contracts": [CONTRACT_VERSION, STUDY_AGENT_CONTRACT_VERSION, "planner-job@1"],
    }


@app.post("/v1/jobs")
async def create_planner_job(request: Request) -> JSONResponse:
    from planner_jobs import JOB_CONTRACT_VERSION, job_store

    _ensure_planner_job_store()
    correlation_id = _correlation_id(request.headers.get("x-correlation-id"))
    run_id = _safe_token((request.headers.get("x-study-run-id") or "").strip())
    task: str | None = None
    started = time.monotonic()
    try:
        _authorize(request.headers.get("authorization"), _settings()["service_token"])
        parsed = _parse_request(await request.body())
        task = parsed.task
        job_id = await job_store().submit(parsed)
        _log(
            "v4_planner_job_submitted",
            correlation_id=correlation_id,
            processing_run_id=run_id,
            task=task,
            component="planner",
            operation="planner_job_submit",
            prompt_id=parsed.prompt_id,
            job_id=job_id,
        )
        return JSONResponse(status_code=202, content={"contract_version": JOB_CONTRACT_VERSION, "job_id": job_id})
    except PlannerError as error:
        _log(
            "v4_planner_job_submit_failed",
            correlation_id=correlation_id,
            processing_run_id=run_id,
            task=task,
            component="planner",
            operation="planner_job_submit",
            error_code=error.code,
            diagnostic_reason=error.diagnostic_reason,
            retryable=error.retryable,
            latency_ms=int((time.monotonic() - started) * 1000),
            **error.log_fields,
        )
        return _error_response(error, correlation_id, run_id, task)


@app.get("/v1/jobs/{job_id}")
async def get_planner_job(job_id: str, request: Request) -> JSONResponse:
    from planner_jobs import job_store

    _ensure_planner_job_store()
    correlation_id = _correlation_id(request.headers.get("x-correlation-id"))
    run_id = _safe_token((request.headers.get("x-study-run-id") or "").strip())
    try:
        _authorize(request.headers.get("authorization"), _settings()["service_token"])
        safe_id = _safe_token(job_id.strip())
        if not safe_id:
            raise PlannerError(404, "DEPENDENCY_UNAVAILABLE", "validation", False, "Job not found.", "planner_job_not_found")
        snapshot = job_store().snapshot(safe_id)
        if snapshot is None:
            raise PlannerError(404, "DEPENDENCY_UNAVAILABLE", "validation", False, "Job not found.", "planner_job_not_found")
        return JSONResponse(status_code=200, content=snapshot)
    except PlannerError as error:
        return _error_response(error, correlation_id, run_id, None, "planner_job_poll")


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
            finish_reason=result["finish_reason"],
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


@app.post("/v1/study-agent-turn")
async def study_agent_turn(request: Request) -> JSONResponse:
    correlation_id = _correlation_id(request.headers.get("x-correlation-id"))
    run_id = _safe_token((request.headers.get("x-study-run-id") or "").strip())
    settings = _settings()
    task = "study"
    started = time.monotonic()
    try:
        _authorize(request.headers.get("authorization"), settings["service_token"])
        raw_body = await request.body()
        try:
            peek = json.loads(raw_body)
            if isinstance(peek, dict) and peek.get("task") in ("study", "writer", "mapping", "investigation"):
                task = str(peek["task"])
        except ValueError:
            pass
        parsed = _parse_agent_request(raw_body)
        task = parsed.task
        if parsed.prompt_id == WRITER_SEMANTIC_REVIEW_PROMPT_ID:
            result = await _agent_json_content_turn(parsed, settings)
        else:
            result = await _agent_turn(parsed, settings)
        usage = result["usage"]
        _log(
            "v4_study_agent_turn_succeeded",
            correlation_id=correlation_id,
            processing_run_id=run_id,
            task=task,
            component="planner",
            operation="study_agent_turn",
            prompt_id=parsed.prompt_id,
            model_alias=result["model_alias"],
            message_count=len(parsed.messages),
            tool_call_count=len(result["message"]["tool_calls"]),
            prompt_tokens=usage["prompt_tokens"],
            completion_tokens=usage["completion_tokens"],
            finish_reason=result["finish_reason"],
            latency_ms=result["latency_ms"],
        )
        return JSONResponse(status_code=200, content=result)
    except PlannerError as error:
        _log(
            "v4_study_agent_turn_failed",
            correlation_id=correlation_id,
            processing_run_id=run_id,
            task=task,
            component="planner",
            operation="study_agent_turn",
            error_code=error.code,
            diagnostic_reason=error.diagnostic_reason,
            retryable=error.retryable,
            latency_ms=int((time.monotonic() - started) * 1000),
            **error.log_fields,
        )
        return _error_response(error, correlation_id, run_id, task, "study_agent_turn")
