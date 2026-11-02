from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

import v4_planner
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
        "prompt_id": "hive-intent/1",
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


def post(client: TestClient, payload: object, token: str | None = TOKEN) -> httpx.Response:
    headers = {"x-correlation-id": "corr-1"}
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


def test_maps_timeout(client: TestClient) -> None:
    def timeout(_: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow")

    use_litellm(timeout)
    response = post(client, body())
    assert response.status_code == 504
    assert response.json() | {"correlation_id": None} == {
        "contract_version": "planner-error@1",
        "error_code": "MODEL_TIMEOUT",
        "category": "dependency",
        "retryable": True,
        "message_safe": "The planning model timed out.",
        "correlation_id": None,
    }


@pytest.mark.parametrize("status,retryable", [(500, True), (429, True), (401, False)])
def test_maps_upstream_failures(client: TestClient, status: int, retryable: bool) -> None:
    use_litellm(lambda _: httpx.Response(status, json={"error": {"message": "upstream"}}))
    response = post(client, body())
    assert response.status_code == 503
    assert response.json()["error_code"] == "MODEL_UNAVAILABLE"
    assert response.json()["retryable"] is retryable


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


def test_health_reveals_no_secrets(client: TestClient) -> None:
    data = client.get("/health").json()
    assert data == {
        "status": "ok",
        "model_alias": "sorter",
        "litellm_configured": True,
        "service_token_configured": True,
    }
