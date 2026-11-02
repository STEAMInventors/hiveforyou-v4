"""
HiveForYou V4 — Thin FastAPI Reader Wrapper over unmodified V3 `hive_reader`.

- Preserves the V3 repository (`hiveforyou-v3/apps/reader`) 100% unchanged.
- Does NOT monkey-patch Pydantic `model_fields`.
- Accepts V4's private bucket `hive-source-documents` via a clean Pydantic subclass
  and delegates byte verification, PDF native extraction, local Tesseract OCR,
  LibreOffice `docx_render_v1` rendering, quality heuristics, `read_fingerprint`,
  and tool provenance to V3's `hive_reader` functions.
- Enforces process-level isolation: clears LiteLLM OCR / reasoning environment variables
  and does NOT mount `/v1/extract-candidates`.
"""

from __future__ import annotations

import logging
import os
import uuid
from typing import Literal

from fastapi import Depends, FastAPI, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Strictly disable LiteLLM OCR and reasoning env vars in the V4 Reader process
# before importing or running hive_reader pipelines.
for _litellm_var in (
    "LITELLM_BASE_URL",
    "LITELLM_API_KEY",
    "READER_OCR_LITELLM_ALIAS",
    "READER_P2_REASONING_LITELLM_ALIAS",
):
    os.environ.pop(_litellm_var, None)

from hive_reader.auth import ServiceAuthError, require_service_token  # noqa: E402
from hive_reader.errors import error_response  # noqa: E402
from hive_reader.models import (  # noqa: E402
    HIVE_SOURCE_DOCUMENTS_BUCKET as V3_SOURCE_DOCUMENTS_BUCKET,
    ReaderReadDocumentOptions,
    ReaderReadDocumentRequest,
    ReaderReadDocumentResponse,
    ReaderReadDocumentSource,
)
from hive_reader.pipeline.ocr_litellm import litellm_configured  # noqa: E402
from hive_reader.pipeline.router import ExtractionError  # noqa: E402
from hive_reader.service import read_document as v3_read_document  # noqa: E402
from hive_reader.storage import (  # noqa: E402
    StorageError,
    assert_storage_path_allowed,
    download_storage_object,
)

logger = logging.getLogger("hive_reader.v4_wrapper")

HIVE_V4_SOURCE_DOCUMENTS_BUCKET = "hive-source-documents"


class V4ReaderReadDocumentSource(ReaderReadDocumentSource):
    """Subclass of V3 ReaderReadDocumentSource scoped to V4's private bucket."""

    storage_bucket: Literal["hive-source-documents"]


class V4ReaderReadDocumentOptions(ReaderReadDocumentOptions):
    """V4 Step 1 options: local OCR only ('selective' or 'never') and reproducible_v1 DOCX."""

    ocr_mode: Literal["selective", "never"] = "selective"


class V4ReaderReadDocumentRequest(BaseModel):
    contract_version: Literal["reader-document-read@1"]
    source: V4ReaderReadDocumentSource
    options: V4ReaderReadDocumentOptions | None = None
    extraction_schema: dict | None = None


class V4ReaderReadDocumentResponse(ReaderReadDocumentResponse):
    source: V4ReaderReadDocumentSource


def _ensure_litellm_disabled() -> None:
    for var in (
        "LITELLM_BASE_URL",
        "LITELLM_API_KEY",
        "READER_OCR_LITELLM_ALIAS",
        "READER_P2_REASONING_LITELLM_ALIAS",
    ):
        os.environ.pop(var, None)
    if litellm_configured():
        raise ExtractionError(
            "INVALID_REQUEST",
            "LiteLLM OCR must remain disabled in the V4 Reader process.",
        )


def _correlation_id(raw: str | None) -> str:
    trimmed = (raw or "").strip()
    if trimmed and len(trimmed) <= 128:
        return trimmed
    return str(uuid.uuid4())


async def read_v4_document(
    request: V4ReaderReadDocumentRequest,
    *,
    content_override: bytes | None = None,
) -> V4ReaderReadDocumentResponse:
    _ensure_litellm_disabled()

    if request.extraction_schema is not None:
        raise ExtractionError(
            "INVALID_REQUEST",
            "Schema-driven extraction is not supported in V4 Reader.",
        )

    assert_storage_path_allowed(
        request.source.storage_path,
        request.source.owner_user_id,
        request.source.hive_id,
    )

    if content_override is not None:
        content = content_override
    else:
        content = await download_storage_object(
            request.source.storage_bucket,
            request.source.storage_path,
        )

    v3_source = ReaderReadDocumentSource(
        source_document_id=request.source.source_document_id,
        hive_id=request.source.hive_id,
        owner_user_id=request.source.owner_user_id,
        storage_bucket=V3_SOURCE_DOCUMENTS_BUCKET,
        storage_path=request.source.storage_path,
        mime_type=request.source.mime_type,
        byte_size=request.source.byte_size,
        sha256=request.source.sha256,
        filename=request.source.filename,
    )
    v3_request = ReaderReadDocumentRequest(
        contract_version=request.contract_version,
        source=v3_source,
        options=request.options,
        extraction_schema=None,
    )

    v3_result = await v3_read_document(v3_request, content_override=content)

    if v3_result.provenance.model_calls or any(
        page.extraction_method == "image_ocr_litellm" for page in v3_result.pages
    ):
        raise ExtractionError(
            "EXTRACTION_FAILED",
            "LiteLLM OCR is disabled in V4 Reader.",
        )

    return V4ReaderReadDocumentResponse(
        contract_version=v3_result.contract_version,
        status=v3_result.status,
        source=request.source,
        source_hash_verified=v3_result.source_hash_verified,
        page_count=v3_result.page_count,
        pages=v3_result.pages,
        provenance=v3_result.provenance,
        read_fingerprint=v3_result.read_fingerprint,
    )


app = FastAPI(title="HiveForYou V4 Reader Wrapper", version="0.1.0")


@app.exception_handler(ServiceAuthError)
async def service_auth_error_handler(
    request: Request,
    exc: ServiceAuthError,
) -> JSONResponse:
    correlation_id = _correlation_id(request.headers.get("x-correlation-id"))
    study_run_id = (request.headers.get("x-study-run-id") or "").strip() or None
    failure = exc.failure
    return error_response(
        status_code=failure.status_code,
        error_code=failure.error_code,
        category=failure.category,
        retryable=failure.retryable,
        message_safe=failure.message_safe,
        correlation_id=correlation_id,
        study_run_id=study_run_id,
        stage=None,
    )


@app.get("/health")
async def health() -> dict[str, object]:
    _ensure_litellm_disabled()
    return {
        "status": "ok",
        "bucket": HIVE_V4_SOURCE_DOCUMENTS_BUCKET,
        "litellm_ocr_enabled": False,
        "ai_extraction_enabled": False,
    }


@app.post("/v1/read-document")
async def read_document_route(
    body: V4ReaderReadDocumentRequest,
    _: None = Depends(require_service_token),
    x_correlation_id: str | None = Header(default=None, alias="x-correlation-id"),
    x_study_run_id: str | None = Header(default=None, alias="x-study-run-id"),
    x_extraction_batch_id: str | None = Header(default=None, alias="x-extraction-batch-id"),
):
    correlation_id = _correlation_id(x_correlation_id)
    study_run_id = (x_study_run_id or "").strip() or None

    logger.info(
        "v4_read_document_start",
        extra={
            "correlation_id": correlation_id,
            "study_run_id": study_run_id,
            "extraction_batch_id": (x_extraction_batch_id or "").strip() or None,
            "source_document_id": body.source.source_document_id,
            "hive_id": body.source.hive_id,
            "stage": "read",
        },
    )

    try:
        result = await read_v4_document(body)
        logger.info(
            "v4_read_document_success",
            extra={
                "correlation_id": correlation_id,
                "study_run_id": study_run_id,
                "page_count": result.page_count,
                "stage": "read",
            },
        )
        return result
    except StorageError as exc:
        status = 503 if exc.retryable else 404 if exc.code == "STORAGE_NOT_FOUND" else 403
        category = "storage" if exc.code.startswith("STORAGE") else "authorization"
        return error_response(
            status_code=status,
            error_code=exc.code,
            category=category,
            retryable=exc.retryable,
            message_safe=exc.message,
            correlation_id=correlation_id,
            study_run_id=study_run_id,
        )
    except ExtractionError as exc:
        code = exc.code
        retryable = code in {"DEPENDENCY_UNAVAILABLE"}
        category = (
            "dependency"
            if code == "DEPENDENCY_UNAVAILABLE"
            else "validation"
            if code == "INVALID_REQUEST"
            else "processing"
        )
        status = 503 if retryable else 400 if code == "INVALID_REQUEST" else 422
        return error_response(
            status_code=status,
            error_code=code,
            category=category,
            retryable=retryable,
            message_safe=exc.message,
            correlation_id=correlation_id,
            study_run_id=study_run_id,
        )
