from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

import model_json_parse
import v4_planner
from model_json_parse import parse_model_json_object
from v4_planner import MAX_REQUEST_BYTES, STUDY_AGENT_TOOL_NAMES, WRITER_AGENT_TOOL_NAMES, WRITER_COMPOSE_TOOL_NAMES, app

TOKEN = "planner-test-token"
LITELLM_URL = "http://hive-litellm:4000"
DIGEST = "sha256:" + "a" * 64


@pytest.fixture(autouse=True)
def planner_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLANNER_SERVICE_TOKEN", TOKEN)
    monkeypatch.setenv("PLANNER_LITELLM_BASE_URL", LITELLM_URL)
    monkeypatch.setenv("PLANNER_LITELLM_API_KEY", "sk-scoped-virtual-key")
    monkeypatch.setenv("PLANNER_LITELLM_ALIAS", "sorter")
    yield
    v4_planner._transport = None


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def body(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "contract_version": "planner-completion@1",
        "task": "intent",
        "prompt_id": "hive.intent-analysis/1",
        "prompt_digest": DIGEST,
        "system_prompt": "You turn requests into objectives.",
        "user_payload": {"task": "intent", "intents": [{"intentRequestId": "x", "intentText": "Compare"}]},
        "max_output_tokens": 4000,
    }
    payload.update(overrides)
    return payload


def completion(content: str, finish_reason: str = "stop") -> dict[str, object]:
    return {
        "model": "gpt-4o-mini-2024-07-18",
        "choices": [{"message": {"role": "assistant", "content": content}, "finish_reason": finish_reason}],
        "usage": {"prompt_tokens": 120, "completion_tokens": 80, "total_tokens": 200},
    }


def use_litellm(handler: Callable[[httpx.Request], httpx.Response]) -> list[httpx.Request]:
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    v4_planner._transport = httpx.MockTransport(record)
    return seen


def post(
    client: TestClient,
    payload: object,
    token: str | None = TOKEN,
    headers_run: str | None = None,
) -> httpx.Response:
    headers = {"x-correlation-id": "corr-1"}
    if headers_run:
        headers["x-study-run-id"] = headers_run
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    return client.post("/v1/plan-completion", content=json.dumps(payload), headers=headers)


def test_returns_parsed_json_with_forced_alias_and_usage(client: TestClient) -> None:
    seen = use_litellm(lambda _: httpx.Response(200, json=completion('{"objectives": []}')))
    response = post(client, body())
    assert response.status_code == 200
    data = response.json()
    assert data["contract_version"] == "planner-completion@1"
    assert data["task"] == "intent"
    assert data["model_alias"] == "sorter"
    assert data["resolved_model"] == "gpt-4o-mini-2024-07-18"
    assert data["content_json"] == {"objectives": []}
    assert data["usage"] == {"prompt_tokens": 120, "completion_tokens": 80, "total_tokens": 200}
    assert isinstance(data["latency_ms"], int)

    sent = json.loads(seen[0].content)
    assert str(seen[0].url) == f"{LITELLM_URL}/v1/chat/completions"
    assert seen[0].headers["authorization"] == "Bearer sk-scoped-virtual-key"
    assert sent["model"] == "sorter"
    assert sent["response_format"] == {"type": "json_object"}
    assert sent["messages"][0] == {"role": "system", "content": "You turn requests into objectives."}
    assert json.loads(sent["messages"][1]["content"])["task"] == "intent"


def test_intelligence_task_uses_its_own_model_alias(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(v4_planner.TASK_MODEL_ALIASES, "intelligence", "harvester")
    seen = use_litellm(lambda _: httpx.Response(200, json=completion('{"questions": []}')))
    intelligence = post(
        client,
        body(
            task="intelligence",
            prompt_id="hive-intent-intelligence/1",
            user_payload={"task": "intelligence"},
            max_output_tokens=12000,
        ),
    )
    plan = post(client, body(task="plan", prompt_id="hive-plan/1", user_payload={"task": "plan"}))
    assert intelligence.status_code == 200
    assert intelligence.json()["model_alias"] == "harvester"
    assert plan.json()["model_alias"] == "sorter"
    assert [json.loads(request.content)["model"] for request in seen] == ["harvester", "sorter"]
    assert json.loads(seen[0].content)["max_tokens"] == 12000


def test_caller_cannot_choose_the_model(client: TestClient) -> None:
    use_litellm(lambda _: httpx.Response(200, json=completion("{}")))
    assert post(client, body(model="gpt-4o")).status_code == 400


@pytest.mark.parametrize("token", [None, "wrong-token"])
def test_rejects_missing_or_wrong_token(client: TestClient, token: str | None) -> None:
    seen = use_litellm(lambda _: httpx.Response(200, json=completion("{}")))
    response = post(client, body(), token=token)
    assert response.status_code == 401
    assert response.json()["error_code"] == "AUTH_FAILED"
    assert seen == []


def test_fails_closed_without_configured_token(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLANNER_SERVICE_TOKEN", "")
    response = post(client, body(), token="")
    assert response.status_code == 503


@pytest.mark.parametrize(
    "overrides",
    [
        {"task": "extract"},
        {"prompt_id": "hive-plan/1"},
        {"prompt_digest": "md5:abc"},
        {"max_output_tokens": 9000},
        {"task": "intelligence", "prompt_id": "hive-intent-intelligence/1", "max_output_tokens": 12001},
        {"task": "intelligence", "prompt_id": "hive-plan/1"},
        {"contract_version": "planner-completion@2"},
    ],
)
def test_rejects_invalid_requests(client: TestClient, overrides: dict[str, object]) -> None:
    seen = use_litellm(lambda _: httpx.Response(200, json=completion("{}")))
    response = post(client, body(**overrides))
    assert response.status_code == 400
    assert response.json()["error_code"] == "INVALID_REQUEST"
    assert seen == []


def test_rejects_oversized_body(client: TestClient) -> None:
    response = post(client, body(system_prompt="x", user_payload={"blob": "y" * (MAX_REQUEST_BYTES + 10)}))
    assert response.status_code == 413


@pytest.mark.parametrize(
    "content,finish_reason",
    [("not json at all", "stop"), ('["a list"]', "stop"), ('{"objectives": [', "length")],
)
def test_rejects_non_object_or_truncated_completion(client: TestClient, content: str, finish_reason: str) -> None:
    use_litellm(lambda _: httpx.Response(200, json=completion(content, finish_reason)))
    response = post(client, body())
    assert response.status_code == 502
    assert response.json()["error_code"] == "MODEL_OUTPUT_INVALID"


def test_maps_timeout(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    def timeout(_: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow")

    use_litellm(timeout)
    with caplog.at_level("WARNING", logger="hive_planner"):
        response = post(client, body(), headers_run="325193b3-826e-4583-897e-71d1086530a0")
    assert response.status_code == 504
    assert response.json() == {
        "contract_version": "planner-error@1",
        "error_code": "MODEL_TIMEOUT",
        "category": "dependency",
        "retryable": True,
        "message_safe": "The planning model timed out.",
        "correlation_id": "corr-1",
        "processing_run_id": "325193b3-826e-4583-897e-71d1086530a0",
        "task": "intent",
        "component": "planner",
        "operation": "plan_completion",
        "diagnostic_reason": "litellm_timeout",
    }
    assert "v4_plan_completion_failed" in caplog.text
    assert "corr-1" in caplog.text
    assert "litellm_timeout" in caplog.text
    assert "325193b3-826e-4583-897e-71d1086530a0" in caplog.text


@pytest.mark.parametrize("status,retryable", [(500, True), (429, True), (401, False)])
def test_maps_upstream_failures(client: TestClient, status: int, retryable: bool) -> None:
    use_litellm(lambda _: httpx.Response(status, json={"error": {"message": "upstream"}}))
    response = post(client, body())
    assert response.status_code == 503
    assert response.json()["error_code"] == "MODEL_UNAVAILABLE"
    assert response.json()["retryable"] is retryable
    assert response.json()["diagnostic_reason"] == "litellm_http_error"
    assert "upstream" not in response.text


@pytest.mark.parametrize(
    ("content", "finish_reason", "reason"),
    [
        (None, "stop", "model_content_missing"),
        ("", "stop", "model_content_missing"),
        ("not json at all", "stop", "model_output_not_json"),
        ('{"objectives": [', "length", "model_output_truncated"),
        ('["a list"]', "stop", "model_response_contract"),
    ],
)
def test_distinguishes_completion_failures(
    client: TestClient, content: str | None, finish_reason: str, reason: str
) -> None:
    payload = completion("{}", finish_reason)
    choice = payload["choices"][0]
    assert isinstance(choice, dict)
    message = choice["message"]
    assert isinstance(message, dict)
    message["content"] = content
    use_litellm(lambda _: httpx.Response(200, json=payload))
    response = post(client, body())
    assert response.status_code == 502
    assert response.json()["error_code"] == "MODEL_OUTPUT_INVALID"
    assert response.json()["diagnostic_reason"] == reason
    assert response.json()["retryable"] is False


def test_max_tokens_finish_reason_is_truncated(client: TestClient) -> None:
    use_litellm(lambda _: httpx.Response(200, json=completion('{"schema":', "max_tokens")))
    response = post(client, body())
    assert response.status_code == 502
    assert response.json()["diagnostic_reason"] == "model_output_truncated"


def test_model_output_failure_logs_safe_diagnostics(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    payload = completion("not json", "stop")
    payload["usage"] = {"prompt_tokens": 1, "completion_tokens": 99, "total_tokens": 100}
    use_litellm(lambda _: httpx.Response(200, json=payload))
    with caplog.at_level("WARNING", logger="hive_planner"):
        response = post(client, body())
    assert response.json()["diagnostic_reason"] == "model_output_not_json"
    assert "not json" not in caplog.text
    assert "content_char_count" in caplog.text
    assert "completion_tokens" in caplog.text
    assert "json_error_category" in caplog.text
    assert "finish_reason" in caplog.text
    assert "content_start_category" in caplog.text
    assert "content_end_category" in caplog.text
    assert "json_error_line" in caplog.text
    assert "json_error_column" in caplog.text
    assert "json_error_position" in caplog.text


@pytest.mark.parametrize(
    ("content", "start", "end"),
    [
        ('{"schema": "hive.study-investigation/1"}', "json_object", "json_object_close"),
        ("```json\n{}\n```", "markdown_fence", "markdown_fence_close"),
        ("# Canonical Study\n\nAnswer in prose.", "other", "other"),
    ],
)
def test_json_failure_content_categories(content: str, start: str, end: str) -> None:
    assert v4_planner._first_content_category(content) == start
    assert v4_planner._ending_structure_category(content) == end


def test_network_failure_is_not_an_http_failure(client: TestClient) -> None:
    def offline(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    use_litellm(offline)
    response = post(client, body())
    assert response.status_code == 503
    assert response.json()["error_code"] == "MODEL_UNAVAILABLE"
    assert response.json()["diagnostic_reason"] == "litellm_network_error"


def test_non_json_gateway_body_is_a_contract_error(client: TestClient) -> None:
    use_litellm(lambda _: httpx.Response(200, content=b"not-json"))
    response = post(client, body())
    assert response.json()["diagnostic_reason"] == "model_response_contract"


def test_maps_context_length_errors(client: TestClient) -> None:
    use_litellm(
        lambda _: httpx.Response(400, json={"error": {"message": "This model's maximum context length is exceeded"}})
    )
    assert post(client, body()).json()["error_code"] == "MODEL_CONTEXT_EXCEEDED"


def test_unconfigured_litellm_is_unavailable(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLANNER_LITELLM_API_KEY", "")
    response = post(client, body())
    assert response.status_code == 503
    assert response.json()["error_code"] == "MODEL_UNAVAILABLE"


def test_health_reveals_no_secrets(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLANNER_STUDY_LITELLM_ALIAS", "heavy_lifter")
    monkeypatch.setenv("PLANNER_WRITER_LITELLM_ALIAS", "harvester")
    data = client.get("/health").json()
    assert data["status"] == "ok"
    assert data["model_alias"] == "sorter"
    assert data["task_model_aliases"] == {
        "intent": "sorter",
        "domain": "sorter",
        "intelligence": "sorter",
        "plan": "sorter",
        "study": "heavy_lifter",
        "writer": "harvester",
    }
    assert data["task_aliases_configured"] is True
    assert data["litellm_configured"] is True
    assert data["service_token_configured"] is True
    assert data["contracts"] == ["planner-completion@1", "study-agent-turn@1"]
    assert "study_structured_output" not in data
    assert "sk-scoped-virtual-key" not in json.dumps(data)


def test_plan_completion_no_longer_runs_the_study_or_writer(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLANNER_STUDY_LITELLM_ALIAS", "heavy_lifter")
    monkeypatch.setenv("PLANNER_WRITER_LITELLM_ALIAS", "harvester")
    seen = use_litellm(lambda _: httpx.Response(200, json=completion('{"answers": []}')))
    study = body(task="study", prompt_id="hive-study-preview/1", user_payload={"task": "study"}, max_output_tokens=4000)
    writer = body(task="writer", prompt_id="hive-writer/1", user_payload={"task": "writer"}, max_output_tokens=4000)
    for invalid in (study, writer):
        response = post(client, invalid)
        assert response.status_code == 400
        assert response.json()["diagnostic_reason"] == "planner_invalid_request"
    assert seen == []
    pages = "p" * (400 * 1024)
    assert post(client, body(user_payload={"blob": pages})).status_code == 413


@pytest.mark.parametrize(
    "content",
    [
        '{"objectives": []}',
        '\ufeff{"objectives": []}',
        '```json\n{"objectives": []}\n```',
        '  {"objectives": []}  ',
    ],
)
def test_accepts_strict_json_shapes(client: TestClient, content: str) -> None:
    use_litellm(lambda _: httpx.Response(200, json=completion(content)))
    response = post(client, body())
    assert response.status_code == 200
    assert response.json()["content_json"] == {"objectives": []}


@pytest.mark.parametrize(
    "content,reason",
    [
        ('Here is JSON:\n{"objectives": []}', "model_response_contract"),
        ('{"objectives": []}\nThanks.', "model_output_not_json"),
        ('{"a":1}{"b":2}', "model_output_not_json"),
        ("```json\n{}\n```\nextra", "model_response_contract"),
        ("```json\n{}\n```\n```json\n{}\n```", "model_response_contract"),
        ("```json\n{", "model_output_not_json"),
    ],
)
def test_rejects_non_strict_json_shapes(client: TestClient, content: str, reason: str) -> None:
    use_litellm(lambda _: httpx.Response(200, json=completion(content)))
    response = post(client, body())
    assert response.status_code == 502
    assert response.json()["diagnostic_reason"] == reason


def test_parse_model_json_object_unit() -> None:
    assert parse_model_json_object('{"a": 1}') == {"a": 1}
    assert parse_model_json_object('\ufeff{"a": 1}') == {"a": 1}
    assert parse_model_json_object('```json\n{"a": 1}\n```') == {"a": 1}
    with pytest.raises(model_json_parse.ModelJsonParseError):
        parse_model_json_object("Answer:\n{}")


# ---------------------------------------------------------------------------
# study-agent-turn@1 (D-042, D-045): relay only; the planner never executes a Hive tool.
# ---------------------------------------------------------------------------
SECRET_PAGE = "CONFIDENTIAL PAGE TEXT 4242"


def agent_tools(names: frozenset[str] = STUDY_AGENT_TOOL_NAMES) -> list[dict[str, object]]:
    return [
        {
            "type": "function",
            "function": {
                "name": name,
                "description": f"Tool {name}.",
                "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
            },
        }
        for name in sorted(names)
    ]


def agent_body(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "contract_version": "study-agent-turn@1",
        "prompt_id": "hive-study-preview/1",
        "prompt_digest": DIGEST,
        "system_prompt": "Investigate the case with the tools.",
        "messages": [
            {"role": "user", "content": "Begin."},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {"id": "toolu_1", "type": "function", "function": {"name": "read_pages", "arguments": '{"documentId":"d","fromPage":1,"toPage":1}'}}
                ],
            },
            {"role": "tool", "tool_call_id": "toolu_1", "content": json.dumps({"ok": True, "pages": [{"text": SECRET_PAGE}]})},
        ],
        "tools": agent_tools(),
        "max_output_tokens": 8000,
        "timeout_seconds": 120,
    }
    payload.update(overrides)
    return payload


def tool_completion(tool_calls: list[dict[str, object]] | None, finish_reason: str = "tool_calls", content: str | None = None) -> dict[str, object]:
    message: dict[str, object] = {"role": "assistant", "content": content}
    if tool_calls is not None:
        message["tool_calls"] = tool_calls
    return {
        "model": "claude-synthetic",
        "choices": [{"message": message, "finish_reason": finish_reason}],
        "usage": {"prompt_tokens": 900, "completion_tokens": 60, "total_tokens": 960},
    }


def wire_call(call_id: str = "toolu_2", name: str = "record_evidence", arguments: str = '{"quote":"x"}') -> dict[str, object]:
    return {"id": call_id, "type": "function", "function": {"name": name, "arguments": arguments}}


def post_agent(client: TestClient, payload: object, token: str | None = TOKEN) -> httpx.Response:
    headers = {"x-correlation-id": "corr-2", "x-study-run-id": "325193b3-826e-4583-897e-71d1086530a0"}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    return client.post("/v1/study-agent-turn", content=json.dumps(payload), headers=headers)


@pytest.fixture
def study_alias(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLANNER_STUDY_LITELLM_ALIAS", "heavy_lifter")


def test_agent_turn_relays_tools_and_returns_unexecuted_tool_calls(
    client: TestClient, study_alias: None, caplog: pytest.LogCaptureFixture
) -> None:
    seen = use_litellm(lambda _: httpx.Response(200, json=tool_completion([wire_call()])))
    with caplog.at_level("INFO", logger="hive_planner"):
        response = post_agent(client, agent_body())
    assert response.status_code == 200
    assert response.json() == {
        "contract_version": "study-agent-turn@1",
        "model_alias": "heavy_lifter",
        "resolved_model": "claude-synthetic",
        "message": {"content": None, "tool_calls": [{"id": "toolu_2", "name": "record_evidence", "arguments": '{"quote":"x"}'}]},
        "usage": {"prompt_tokens": 900, "completion_tokens": 60, "total_tokens": 960},
        "latency_ms": response.json()["latency_ms"],
        "finish_reason": "tool_calls",
    }
    assert len(seen) == 1
    sent = json.loads(seen[0].content)
    assert sent["model"] == "heavy_lifter"
    assert sent["tool_choice"] == "required"
    assert sent["temperature"] == 0
    assert sent["max_tokens"] == 8000
    assert "response_format" not in sent
    assert {tool["function"]["name"] for tool in sent["tools"]} == STUDY_AGENT_TOOL_NAMES
    assert sent["messages"][0] == {"role": "system", "content": "Investigate the case with the tools."}
    assert sent["messages"][2]["tool_calls"][0]["id"] == "toolu_1"
    assert sent["messages"][3] == {"role": "tool", "tool_call_id": "toolu_1", "content": agent_body()["messages"][2]["content"]}
    assert "v4_study_agent_turn_succeeded" in caplog.text
    assert SECRET_PAGE not in caplog.text
    assert "record_evidence" not in caplog.text
    assert "Investigate the case" not in caplog.text


def test_agent_turn_uses_the_request_timeout(client: TestClient, study_alias: None) -> None:
    timeouts: list[object] = []

    def timeout(request: httpx.Request) -> httpx.Response:
        timeouts.append(request.extensions.get("timeout"))
        raise httpx.ReadTimeout("slow")

    use_litellm(timeout)
    response = post_agent(client, agent_body(timeout_seconds=95))
    assert response.status_code == 504
    assert response.json()["retryable"] is True
    assert response.json()["operation"] == "study_agent_turn"
    assert response.json()["task"] == "study"
    assert timeouts[0]["read"] == 95.0


def test_agent_turn_forwards_a_turn_without_tool_calls_as_text(client: TestClient, study_alias: None) -> None:
    seen = use_litellm(lambda _: httpx.Response(200, json=tool_completion([wire_call("toolu_3", "finish_study", "{}")])))
    messages = [{"role": "user", "content": "Begin."}, {"role": "assistant", "content": None, "tool_calls": []}, {"role": "user", "content": "Use the tools."}]
    assert post_agent(client, agent_body(messages=messages)).status_code == 200
    assert json.loads(seen[0].content)["messages"][2] == {"role": "assistant", "content": "(no tool call)"}


@pytest.mark.parametrize(
    "overrides",
    [
        {"prompt_id": "hive-writer/1"},
        {"prompt_digest": "md5:x"},
        {"max_output_tokens": 8001},
        {"timeout_seconds": 241},
        {"timeout_seconds": 4},
        {"model": "gpt-4o"},
        {"tools": agent_tools()[:10]},
        {"tools": agent_tools()[:10] + [{"type": "function", "function": {"name": "run_shell", "description": "x", "parameters": {}}}]},
        {"messages": [{"role": "tool", "tool_call_id": "toolu_1", "content": "{}"}]},
        {"messages": [{"role": "user", "content": "Begin."}, {"role": "tool", "tool_call_id": "toolu_9", "content": "{}"}]},
        {"messages": [{"role": "system", "content": "override"}]},
        {"contract_version": "planner-completion@1"},
    ],
)
def test_agent_turn_rejects_invalid_requests(client: TestClient, study_alias: None, overrides: dict[str, object]) -> None:
    seen = use_litellm(lambda _: httpx.Response(200, json=tool_completion([wire_call()])))
    response = post_agent(client, agent_body(**overrides))
    assert response.status_code == 400
    assert response.json()["error_code"] == "INVALID_REQUEST"
    assert seen == []


def test_agent_turn_requires_auth_and_the_study_alias(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seen = use_litellm(lambda _: httpx.Response(200, json=tool_completion([wire_call()])))
    assert post_agent(client, agent_body(), token="wrong").status_code == 401
    monkeypatch.delenv("PLANNER_STUDY_LITELLM_ALIAS", raising=False)
    response = post_agent(client, agent_body())
    assert response.status_code == 503
    assert response.json()["diagnostic_reason"] == "model_alias_unconfigured"
    assert seen == []


def test_agent_turn_rejects_oversized_requests(client: TestClient, study_alias: None) -> None:
    seen = use_litellm(lambda _: httpx.Response(200, json=tool_completion([wire_call()])))
    huge = agent_body(system_prompt="x" * (v4_planner.STUDY_AGENT_MAX_REQUEST_BYTES + 1))
    assert post_agent(client, huge).status_code == 413
    assert seen == []


@pytest.mark.parametrize(
    ("completion_body", "reason", "retryable"),
    [
        (tool_completion([wire_call()], finish_reason="length"), "model_output_truncated", False),
        (tool_completion([wire_call()], finish_reason="max_tokens"), "model_output_truncated", False),
        (tool_completion([wire_call("bad id")]), "model_response_contract", False),
        (tool_completion([wire_call(name="has spaces")]), "model_response_contract", False),
        (tool_completion([wire_call(arguments="x" * 32_001)]), "model_response_contract", False),
        (tool_completion([wire_call(f"t{i}") for i in range(33)]), "model_response_contract", False),
        ({"choices": []}, "model_response_contract", True),
    ],
)
def test_agent_turn_rejects_unusable_model_turns(
    client: TestClient, study_alias: None, completion_body: dict[str, object], reason: str, retryable: bool, caplog: pytest.LogCaptureFixture
) -> None:
    use_litellm(lambda _: httpx.Response(200, json=completion_body))
    with caplog.at_level("WARNING", logger="hive_planner"):
        response = post_agent(client, agent_body())
    assert response.status_code == 502
    assert response.json()["diagnostic_reason"] == reason
    assert response.json()["retryable"] is retryable
    assert "v4_study_agent_turn_failed" in caplog.text
    assert SECRET_PAGE not in caplog.text


def test_agent_turn_passes_unknown_tool_names_through_for_the_ledger(client: TestClient, study_alias: None) -> None:
    use_litellm(lambda _: httpx.Response(200, json=tool_completion([wire_call(name="delete_case", arguments="")])))
    response = post_agent(client, agent_body())
    assert response.status_code == 200
    assert response.json()["message"]["tool_calls"] == [{"id": "toolu_2", "name": "delete_case", "arguments": ""}]


@pytest.mark.parametrize("status,retryable", [(500, True), (429, True), (401, False)])
def test_agent_turn_maps_upstream_failures_without_bodies(client: TestClient, study_alias: None, status: int, retryable: bool) -> None:
    use_litellm(lambda _: httpx.Response(status, json={"error": {"message": f"upstream {SECRET_PAGE}"}}))
    response = post_agent(client, agent_body())
    assert response.status_code == 503
    assert response.json()["retryable"] is retryable
    assert SECRET_PAGE not in response.text


def writer_agent_body(**overrides: object) -> dict[str, object]:
    return agent_body(
        task="writer",
        prompt_id="hive-writer/1",
        system_prompt="Write the report with the five tools.",
        messages=[{"role": "user", "content": '{"task":"writer","audience":"CUSTOMER"}'}],
        tools=agent_tools(WRITER_AGENT_TOOL_NAMES),
    ) | overrides


def test_writer_agent_turn_relays_writer_tools_with_configured_alias(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv("PLANNER_WRITER_LITELLM_ALIAS", "harvester")
    seen = use_litellm(
        lambda _: httpx.Response(
            200,
            json=tool_completion([wire_call("toolu_w1", "set_report_outline", '{"title":"Report","summary":[]}')]),
        )
    )
    with caplog.at_level("INFO", logger="hive_planner"):
        response = post_agent(client, writer_agent_body())
    assert response.status_code == 200
    assert response.json()["model_alias"] == "harvester"
    assert response.json()["message"]["tool_calls"] == [
        {"id": "toolu_w1", "name": "set_report_outline", "arguments": '{"title":"Report","summary":[]}'}
    ]
    sent = json.loads(seen[0].content)
    assert sent["model"] == "harvester"
    assert sent["tool_choice"] == "required"
    assert {tool["function"]["name"] for tool in sent["tools"]} == WRITER_AGENT_TOOL_NAMES
    assert "v4_study_agent_turn_succeeded" in caplog.text
    assert '"task":"writer"' in caplog.text


def test_writer_agent_turn_fails_closed_without_writer_alias_and_validates_writer_tools(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("PLANNER_WRITER_LITELLM_ALIAS", raising=False)
    seen = use_litellm(lambda _: httpx.Response(200, json=tool_completion([wire_call()])))
    unconfigured = post_agent(client, writer_agent_body())
    assert unconfigured.status_code == 503
    assert unconfigured.json()["diagnostic_reason"] == "model_alias_unconfigured"
    assert unconfigured.json()["task"] == "writer"

    monkeypatch.setenv("PLANNER_WRITER_LITELLM_ALIAS", "harvester")
    # Rejects Study tools on task="writer", wrong prompt_id, or non-closed parameter schemas.
    assert post_agent(client, writer_agent_body(tools=agent_tools(STUDY_AGENT_TOOL_NAMES))).status_code == 400
    assert post_agent(client, writer_agent_body(prompt_id="hive-study-preview/1")).status_code == 400
    unclosed_tools = agent_tools(WRITER_AGENT_TOOL_NAMES)
    unclosed_tools[0] = {
        "type": "function",
        "function": {
            "name": sorted(WRITER_AGENT_TOOL_NAMES)[0],
            "description": "Unclosed schema.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": True},
        },
    }
    assert post_agent(client, writer_agent_body(tools=unclosed_tools)).status_code == 400
    assert seen == []

    # Accepts the D-047 compose tool set and combined tool set.
    seen_compose = use_litellm(
        lambda _: httpx.Response(
            200,
            json=tool_completion([wire_call("toolu_c1", "compose_writer_report", '{"title":"Report"}')]),
        )
    )
    assert post_agent(client, writer_agent_body(tools=agent_tools(WRITER_COMPOSE_TOOL_NAMES))).status_code == 200
    assert post_agent(client, writer_agent_body(tools=agent_tools(WRITER_COMPOSE_TOOL_NAMES | WRITER_AGENT_TOOL_NAMES))).status_code == 200
    assert len(seen_compose) == 2


def test_writer_agent_turn_accepts_real_multi_question_claim_catalog_over_32k_chars(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PLANNER_WRITER_LITELLM_ALIAS", "harvester")
    seen = use_litellm(
        lambda _: httpx.Response(
            200,
            json=tool_completion([wire_call("toolu_w1", "set_report_outline", '{"title":"Report","summary":[]}')]),
        )
    )
    large_claims = [
        {
            "id": f"P{(i % 6) + 1}.F{i}",
            "kind": "FACT",
            "text": f"Documented finding {i} regarding service minutes and progress measurement: " + ("x" * 240),
            "quotes": [
                f"Verbatim quotation {i}a from the authorized record page: " + ("q" * 260),
                f"Verbatim quotation {i}b from the authorized record page: " + ("r" * 260),
            ],
            "pages": ["Maya IEP 2025.pdf p.1", "Speech service log.xlsx p.1"],
        }
        for i in range(60)
    ]
    user_payload_json = json.dumps(
        {
            "task": "writer",
            "audience": "CUSTOMER",
            "audienceProfile": {
                "role": "Parent",
                "status": "STATED",
                "tone": "Plain, calm and practical",
                "detailLevel": "PLAIN",
                "guidance": ["Explain progress and service minutes clearly."],
            },
            "requests": [{"intentRequestId": "5a5a5a5a-0000-4000-8000-0000000000a1", "text": "Prepare for the IEP meeting"}],
            "domain": {"label": "Special education", "uncertain": False},
            "coverage": {"complete": True, "notes": []},
            "claims": large_claims,
        }
    )
    assert len(user_payload_json) > v4_planner.STUDY_AGENT_MAX_CONTENT_CHARS
    assert len(user_payload_json) < v4_planner.STUDY_AGENT_MAX_USER_CONTENT_CHARS

    response = post_agent(
        client,
        writer_agent_body(messages=[{"role": "user", "content": user_payload_json}]),
    )
    assert response.status_code == 200
    assert len(seen) == 1

    # Still fails closed if a user message exceeds STUDY_AGENT_MAX_USER_CONTENT_CHARS.
    too_long_user = "u" * (v4_planner.STUDY_AGENT_MAX_USER_CONTENT_CHARS + 1)
    rejected = post_agent(
        client,
        writer_agent_body(messages=[{"role": "user", "content": too_long_user}]),
    )
    assert rejected.status_code == 400
    assert rejected.json()["diagnostic_reason"] == "planner_invalid_request"