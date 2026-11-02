# V4 Reader — Docker (Oracle ARM64)

Minimal container for the V4 Reader wrapper (`v4_reader_wrapper.py`) with **unmodified** V3 `hive_reader` source baked into the image. Does **not** replace the existing V3 Reader systemd service or the `hive-litellm` container.

- **Host bind:** `127.0.0.1:8082`
- **Credentials:** copy `v4-reader.env.example` → `v4-reader.env` (gitignored). Never bake secrets into the image.
- **LiteLLM:** leave `LITELLM_*` and `READER_OCR_LITELLM_ALIAS` unset; the wrapper fails closed if LiteLLM OCR is configured.

## Prerequisites

- Docker with BuildKit (`DOCKER_BUILDKIT=1`)
- **ARM64** host (Oracle Ampere) or `docker buildx` targeting `linux/arm64`
- For **local packaging:** sibling clone `hiveforyou-v3` with `apps/reader` at the path in `compose.reader.yml` (default: `../../../hiveforyou-v3/apps/reader` relative to this directory)
- For **Git revision packaging:** approved `HIVE_READER_V3_GIT_URL` and `HIVE_READER_V3_GIT_REF` (commit SHA or tag)

Set `READER_GIT_SHA` in `v4-reader.env` to the same V3 revision you packaged (provenance only).

### LibreOffice version pin

`v4-reader.env.example` pins `7.6.7.2` for host installs. Debian Bookworm’s `libreoffice-writer` in this image is typically **7.4.x**. Either:

- Set `READER_LIBREOFFICE_VERSION_PIN` to the major.minor prefix reported by `soffice --version` inside the container, or
- Leave `READER_LIBREOFFICE_VERSION_PIN` empty to skip the pin (DOCX still renders; reproducibility label differs from the pinned host bundle).

## 1. Configure environment (once)

```bash
cd infra/oracle
cp v4-reader.env.example v4-reader.env
# Edit v4-reader.env: READER_SUPABASE_*, READER_SERVICE_TOKEN, READER_GIT_SHA, LibreOffice pin (see above)
chmod 600 v4-reader.env
```

## 2. Build

### Option A — Local V3 checkout (default compose target)

Pin the V3 tree to an approved revision **before** build:

```bash
cd /path/to/hiveforyou-v3
git fetch origin
git checkout <approved-v3-reader-sha>
git rev-parse --short HEAD   # record in READER_GIT_SHA
```

Build from V4:

```bash
cd /path/to/hiveforyou-v4/infra/oracle
export DOCKER_BUILDKIT=1
export HIVE_READER_V3_LOCAL_PATH="/path/to/hiveforyou-v3/apps/reader"   # optional override

docker compose -f compose.reader.yml build
```

Equivalent plain `docker build`:

```bash
cd /path/to/hiveforyou-v4/infra/oracle
docker build -f Dockerfile.reader \
  --platform linux/arm64 \
  --build-context v3_reader=/path/to/hiveforyou-v3/apps/reader \
  -t hiveforyou-v4-reader:local \
  .
```

### Option B — Fetch V3 `apps/reader` from Git at build time (no V3 clone on Oracle)

```bash
cd /path/to/hiveforyou-v4/infra/oracle
export DOCKER_BUILDKIT=1
export FETCH_V3_FROM_GIT=1
export V4_READER_BUILD_TARGET=runtime-git
export HIVE_READER_V3_GIT_URL="https://github.com/<org>/hiveforyou-v3.git"
export HIVE_READER_V3_GIT_REF="<approved-commit-sha>"

docker compose -f compose.reader.yml build
```

Plain `docker build`:

```bash
docker build -f Dockerfile.reader \
  --platform linux/arm64 \
  --target runtime-git \
  --build-arg FETCH_V3_FROM_GIT=1 \
  --build-arg HIVE_READER_V3_GIT_URL="https://github.com/<org>/hiveforyou-v3.git" \
  --build-arg HIVE_READER_V3_GIT_REF="<approved-commit-sha>" \
  -t hiveforyou-v4-reader:<approved-commit-sha> \
  infra/oracle
```

Tag the image explicitly when rolling forward (`V4_READER_IMAGE=hiveforyou-v4-reader:<sha>`).

## 3. Start

```bash
cd infra/oracle
docker compose -f compose.reader.yml up -d
```

V3 Reader and `hive-litellm` are unchanged; this stack is a **separate** compose project (`hiveforyou-v4-reader`).

## 4. Verify

```bash
# Container health
docker compose -f compose.reader.yml ps

# HTTP health (host loopback)
curl -sS http://127.0.0.1:8082/health | python -m json.tool
# Expect: status ok, litellm_ocr_enabled false, ai_extraction_enabled false

# Logs (no secrets logged by default)
docker compose -f compose.reader.yml logs --tail=50 v4-reader
```

Authenticated read smoke test (requires valid `READER_SERVICE_TOKEN` and Supabase-backed object):

```bash
curl -sS -X POST http://127.0.0.1:8082/v1/read-document \
  -H "Authorization: Bearer ${READER_SERVICE_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "x-correlation-id: docker-smoke-1" \
  -d @/path/to/fixture-read-request.json
```

Point V4 web `READER_BASE_URL` at the host-facing URL (e.g. `http://127.0.0.1:8082` on Oracle behind your TLS proxy).

## 5. Rollback

```bash
cd infra/oracle

# Stop current container (V3 / hive-litellm unaffected)
docker compose -f compose.reader.yml down

# Run previous image tag (example)
export V4_READER_IMAGE=hiveforyou-v4-reader:<previous-sha>
docker compose -f compose.reader.yml up -d

# Optional: remove a bad image after confirming rollback
docker image rm hiveforyou-v4-reader:<bad-sha>
```

Keep the previous image tag on disk until a rollback window passes.

## Build context hygiene

- Context directory: `infra/oracle` only (see `.dockerignore`).
- Excludes: `.env`, `v4-reader.env`, `.git`, caches, tests, and the rest of the monorepo.
- V3 source enters only via BuildKit context `v3_reader` or the `runtime-git` fetch stage—never commit V3 into V4.

## Resource limits

Defaults in `compose.reader.yml`: **2 CPUs**, **2 GiB RAM**, **256 PIDs**. Override with `V4_READER_CPU_LIMIT` / `V4_READER_MEM_LIMIT` in the shell or a untracked `.env` file next to the compose file (do not commit).
