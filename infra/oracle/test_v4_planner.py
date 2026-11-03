from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

import model_json_parse
import v4_planner
from model_json_parse import parse_model_json_object
from v4_planner import MAX_REQUEST_BYTES, app

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
    assert data["study_structured_output"]["enabled"] is False
    assert data["study_structured_output"]["schema_loaded"] is True


def study_body(**overrides: object) -> dict[str, object]:
    return body(
        task="study",
        prompt_id="hive-study-preview/1",
        system_prompt="Investigate the pages.",
        user_payload={"task": "study"},
        max_output_tokens=32000,
    ) | overrides


def writer_body(**overrides: object) -> dict[str, object]:
    return body(
        task="writer",
        prompt_id="hive-writer/1",
        system_prompt="Write the report.",
        user_payload={"task": "writer", "audience": "CUSTOMER"},
        max_output_tokens=16000,
    ) | overrides


def test_study_and_writer_use_their_configured_aliases(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLANNER_STUDY_LITELLM_ALIAS", "heavy_lifter")
    monkeypatch.setenv("PLANNER_WRITER_LITELLM_ALIAS", "harvester")
    seen = use_litellm(lambda _: httpx.Response(200, json=completion('{"answers": []}')))
    study = post(client, study_body())
    writer = post(client, writer_body())
    assert study.status_code == 200 and study.json()["model_alias"] == "heavy_lifter"
    assert writer.status_code == 200 and writer.json()["model_alias"] == "harvester"
    assert [json.loads(request.content)["model"] for request in seen] == ["heavy_lifter", "harvester"]
    assert json.loads(seen[0].content)["max_tokens"] == 32000


@pytest.mark.parametrize("task_body", [study_body, writer_body])
def test_study_and_writer_fail_closed_without_alias(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, task_body: Callable[..., dict[str, object]]
) -> None:
    monkeypatch.delenv("PLANNER_STUDY_LITELLM_ALIAS", raising=False)
    monkeypatch.delenv("PLANNER_WRITER_LITELLM_ALIAS", raising=False)
    seen = use_litellm(lambda _: httpx.Response(200, json=completion("{}")))
    response = post(client, task_body())
    assert response.status_code == 503
    assert response.json()["error_code"] == "MODEL_UNAVAILABLE"
    assert response.json()["retryable"] is False
    assert seen == []
    assert client.get("/health").json()["task_aliases_configured"] is False


def test_study_accepts_large_pages_but_preparation_does_not(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLANNER_STUDY_LITELLM_ALIAS", "heavy_lifter")
    use_litellm(lambda _: httpx.Response(200, json=completion('{"answers": []}')))
    pages = "p" * (400 * 1024)
    assert post(client, study_body(system_prompt=pages)).status_code == 200
    assert post(client, body(user_payload={"blob": pages})).status_code == 413
    assert post(client, study_body(max_output_tokens=32001)).status_code == 400


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


def test_study_structured_output_sends_json_schema_when_enabled(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PLANNER_STUDY_LITELLM_ALIAS", "heavy_lifter")
    monkeypatch.setenv("PLANNER_STUDY_STRUCTURED_OUTPUT", "json_schema")
    seen = use_litellm(lambda _: httpx.Response(200, json=completion('{"answers": []}')))
    response = post(client, study_body())
    assert response.status_code == 200
    sent = json.loads(seen[0].content)
    assert sent["response_format"]["type"] == "json_schema"
    assert sent["response_format"]["json_schema"]["name"] == "hive_study_investigation_v1"
    assert sent["response_format"]["json_schema"]["strict"] is True
    assert sent["response_format"]["json_schema"]["schema"]["type"] == "object"
    schema = sent["response_format"]["json_schema"]["schema"]
    assert "$defs" not in schema
    formula = schema["properties"]["answers"]["items"]["properties"]["calculations"]["items"]["properties"]["formula"]
    assert formula["oneOf"][0] == {"type": "null"}
    assert formula["oneOf"][1]["oneOf"]
    assert sent["response_format"]["json_schema"]["schema"]["properties"]["schema"]["enum"] == [
        "hive.study-investigation/1"
    ]


def test_study_structured_output_fails_closed_on_schema_rejection(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PLANNER_STUDY_LITELLM_ALIAS", "heavy_lifter")
    monkeypatch.setenv("PLANNER_STUDY_STRUCTURED_OUTPUT", "json_schema")
    seen = use_litellm(
        lambda _: httpx.Response(
            400,
            json={"error": {"message": "Invalid json_schema for structured output"}},
        )
    )
    response = post(client, study_body())
    assert response.status_code == 502
    body_json = response.json()
    assert body_json["diagnostic_reason"] == "structured_output_schema_rejected"
    assert body_json["retryable"] is False
    assert len(seen) == 1


def test_writer_stays_json_object_when_study_structured_output_enabled(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PLANNER_STUDY_LITELLM_ALIAS", "heavy_lifter")
    monkeypatch.setenv("PLANNER_WRITER_LITELLM_ALIAS", "harvester")
    monkeypatch.setenv("PLANNER_STUDY_STRUCTURED_OUTPUT", "json_schema")
    seen = use_litellm(lambda _: httpx.Response(200, json=completion('{"sections": []}')))
    response = post(client, writer_body())
    assert response.status_code == 200
    assert json.loads(seen[0].content)["response_format"] == {"type": "json_object"}


def test_parse_model_json_object_unit() -> None:
    assert parse_model_json_object('{"a": 1}') == {"a": 1}
    assert parse_model_json_object('\ufeff{"a": 1}') == {"a": 1}
    assert parse_model_json_object('```json\n{"a": 1}\n```') == {"a": 1}
    with pytest.raises(model_json_parse.ModelJsonParseError):
        parse_model_json_object("Answer:\n{}")


def test_study_timeout_is_longer_and_retryable(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PLANNER_STUDY_LITELLM_ALIAS", "heavy_lifter")
    timeouts: list[object] = []

    def timeout(request: httpx.Request) -> httpx.Response:
        timeouts.append(request.extensions.get("timeout"))
        raise httpx.ReadTimeout("slow")

    use_litellm(timeout)
    response = post(client, study_body())
    assert response.status_code == 504
    assert response.json()["error_code"] == "MODEL_TIMEOUT"
    assert response.json()["retryable"] is True
    assert timeouts[0]["read"] == 270.0
