# V4 Planner — Docker (Oracle ARM64)

Container for `v4_planner.py` (D-039): the only path from the web server to the planning model. It forwards `planner-completion@1` requests to the private LiteLLM gateway with the fixed alias `sorter` and a scoped virtual key held only on Oracle. It does **not** modify or restart the V3 Reader, the V4 Reader or `hive-litellm`.

- **Network:** Docker bridge `oracle_default` (external, already used by `hive-litellm`). LiteLLM is reached privately at `http://hive-litellm:4000`. No host networking.
- **Host bind:** `127.0.0.1:8083` only. The existing Reader TLS proxy routes a path on the same HTTPS host to it.
- **Credentials:** `v4-planner.env` (gitignored, `chmod 600`). `PLANNER_SERVICE_TOKEN` is distinct from `READER_SERVICE_TOKEN`; `PLANNER_LITELLM_API_KEY` is a scoped virtual key, never the master key.
- **Per-task model (D-040):** `TASK_MODEL_ALIASES` in `v4_planner.py` overrides the alias for one task (code constant, no new variable). All four tasks (`intent`, `domain`, `intelligence`, `plan`) currently use `sorter`; to compare `harvester` for `intelligence`, change that entry, add `harvester` to the virtual key's `models`, rebuild and redeploy. `/health` reports `task_model_aliases`.
- **Study and Writer models (D-041, D-042):** the Study uses `PLANNER_STUDY_LITELLM_ALIAS` (approved: `heavy_lifter`) through `POST /v1/study-agent-turn` (`study-agent-turn@1`): one tool-calling turn per request, `tool_choice: required`, the model's tool calls returned unexecuted — the planner never runs Study tools. `writer` uses `PLANNER_WRITER_LITELLM_ALIAS` (approved: `harvester`) through `/v1/plan-completion`, which no longer accepts `task: study`. Both aliases are required and never fall back to `sorter`; when unset the call fails closed with `MODEL_UNAVAILABLE` and `/health` reports `task_aliases_configured: false`. Add both aliases to the virtual key's `models`.
- **Pipeline tasks:** `extract` (`hive-extract/1`), `canonicalize` (`hive-canonicalize/1`) and `write` (`hive-write/1`) are tool-free JSON completions on `/v1/plan-completion`. Each requires its own alias — `PLANNER_EXTRACT_LITELLM_ALIAS` (suggested `harvester`), `PLANNER_CANONICALIZE_LITELLM_ALIAS` (the frontier alias, suggested `heavy_lifter`), `PLANNER_WRITE_LITELLM_ALIAS` (suggested `harvester`) — and fails closed with `MODEL_UNAVAILABLE` when unset; `/health` then reports `task_aliases_configured: false`. Output caps: 12000 / 16000 / 8000 tokens. LiteLLM timeouts: 280 s / 280 s / 150 s (`TASK_LITELLM_TIMEOUT_SECONDS`); the web client waits 290 s for `extract` and `canonicalize` (offline measurement in V5-002..V5-004; production execution path decided in V5-005b, D-016).
- **Timeouts:** LiteLLM 150 s per preparation call and 270 s per `writer` call; each Study turn uses the caller's `timeout_seconds` (5–240 s; the web loop sends at most 145 s). The web client waits 160 s and 280 s respectively (Vercel limit 300 s). The proxy below must allow at least 290 s.
- **Request limits:** 256 KB for preparation tasks, 768 KB for `writer`, 1 MB per Study turn (system prompt with page index, tool definitions and the turn's message history); 1.5 MB for `extract`, 2 MB for `canonicalize`, 1 MB for `write`.

## 1. Create the scoped LiteLLM virtual key (founder approval)

On Oracle, with the LiteLLM master key available only in that shell:

```bash
curl -sS -X POST http://127.0.0.1:4000/key/generate \
  -H "Authorization: Bearer ${LITELLM_MASTER_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"models": ["sorter", "heavy_lifter", "harvester"], "key_alias": "hiveforyou-v4-planner", "max_budget": 5, "budget_duration": "30d"}'
```

Adjust the budget as approved. For an existing key, add the models with `POST /key/update` (`{"key": "<virtual key>", "models": ["sorter", "heavy_lifter", "harvester"]}`). Confirm the network name and the LiteLLM container name:

```bash
docker network ls | grep oracle_default
docker network inspect oracle_default --format '{{range .Containers}}{{.Name}} {{end}}'   # expect hive-litellm
```

## 2. Configure

```bash
cd infra/oracle
cp v4-planner.env.example v4-planner.env
# PLANNER_SERVICE_TOKEN: e.g. `openssl rand -hex 32`
# PLANNER_LITELLM_API_KEY: the virtual key from step 1
chmod 600 v4-planner.env
```

## 3. Build and start

```bash
cd infra/oracle
export DOCKER_BUILDKIT=1
docker compose -f compose.planner.yml build
docker compose -f compose.planner.yml up -d
docker compose -f compose.planner.yml ps
curl -sS http://127.0.0.1:8083/health
# Expect: status ok, model_alias sorter, task_model_aliases (preparation sorter, study heavy_lifter, writer harvester,
# extract harvester, canonicalize heavy_lifter, write harvester),
# task_aliases_configured true, litellm_configured true, service_token_configured true,
# contracts ["planner-completion@1", "study-agent-turn@1"]
```

## 4. TLS proxy route

Add a path route on the Reader's existing HTTPS host that strips the prefix and forwards to `127.0.0.1:8083`. Example (Caddy):

```caddy
handle_path /planner/* {
    reverse_proxy 127.0.0.1:8083
}
```

Example (nginx):

```nginx
location /planner/ {
    proxy_pass http://127.0.0.1:8083/;
    proxy_read_timeout 290s;
    client_max_body_size 2100k;
}
```

Then in Vercel: `PLANNER_BASE_URL=https://<reader-host>/planner`, `PLANNER_SERVICE_TOKEN=<same token as v4-planner.env>`.

## 5. Smoke test (first paid `sorter` call — founder approval)

```bash
curl -sS -X POST https://<reader-host>/planner/v1/plan-completion \
  -H "Authorization: Bearer ${PLANNER_SERVICE_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "x-correlation-id: planner-smoke-1" \
  -d '{"contract_version":"planner-completion@1","task":"intent","prompt_id":"hive-intent/1",
       "prompt_digest":"sha256:0000000000000000000000000000000000000000000000000000000000000000",
       "system_prompt":"Return {\"ok\": true} as JSON.","user_payload":{"task":"intent"},"max_output_tokens":50}'
# Expect HTTP 200 with model_alias "sorter" and content_json {"ok": true}
```

## 6. Rollback

```bash
cd infra/oracle
docker compose -f compose.planner.yml down        # LiteLLM, V3 and V4 Reader unaffected
export V4_PLANNER_IMAGE=hiveforyou-v4-planner:<previous-tag>
docker compose -f compose.planner.yml up -d
```

Revoke the virtual key with `POST /key/delete` if the planner is retired.

## Tests (host)

```bash
cd infra/oracle
python -m pytest test_v4_planner.py -q
```
