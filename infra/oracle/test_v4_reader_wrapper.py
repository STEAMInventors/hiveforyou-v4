from __future__ import annotations

import hashlib
import os
from io import BytesIO
from pathlib import Path

import fitz
import pytest
from docx import Document
from docx.enum.text import WD_BREAK
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from hive_reader.config import settings
from hive_reader.models import ReaderReadDocumentSource
from hive_reader.pipeline.ocr_litellm import litellm_configured
import v4_reader_wrapper
from v4_reader_wrapper import (
    HIVE_V4_SOURCE_DOCUMENTS_BUCKET,
    V4ReaderReadDocumentOptions,
    V4ReaderReadDocumentRequest,
    V4ReaderReadDocumentSource,
    app,
    read_v4_document,
)

OWNER_ID = "22222222-2222-4222-8222-222222222222"
HIVE_ID = "11111111-1111-4111-8111-111111111111"
DOC_ID = "33333333-3333-4333-8333-333333333333"
STORAGE_PATH = f"{OWNER_ID}/{HIVE_ID}/{DOC_ID}/original"
V4_TOKEN = "v4-isolated-service-token"


@pytest.fixture(autouse=True)
def configure_v4_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "service_token", V4_TOKEN)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def synthetic_pdf_bytes() -> bytes:
    doc = fitz.open()
    p1 = doc.new_page()
    p1.insert_text((72, 72), "Synthetic V4 PDF page one with sufficient alphanumeric identity text.")
    p2 = doc.new_page()
    p2.insert_text((72, 72), "Synthetic V4 PDF page two continues with distinct readable content.")
    data = doc.tobytes()
    doc.close()
    return data


@pytest.fixture
def synthetic_png_bytes() -> bytes:
    img = Image.new("RGB", (600, 160), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.text((20, 60), "Synthetic V4 PNG image sample 1234567890", fill=(0, 0, 0))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def synthetic_jpeg_bytes() -> bytes:
    img = Image.new("RGB", (600, 160), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.text((20, 60), "Synthetic V4 JPEG image sample 1234567890", fill=(0, 0, 0))
    buf = BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture
def synthetic_docx_two_pages_bytes() -> bytes:
    document = Document()
    document.add_paragraph(
        "Synthetic V4 DOCX page one with sufficient identity text for LibreOffice render."
    )
    document.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
    document.add_paragraph(
        "Synthetic V4 DOCX page two continues with distinct identity text for pagination."
    )
    buf = BytesIO()
    document.save(buf)
    return buf.getvalue()


def _make_source_dict(content: bytes, mime_type: str, filename: str, bucket: str = HIVE_V4_SOURCE_DOCUMENTS_BUCKET) -> dict:
    return {
        "source_document_id": DOC_ID,
        "hive_id": HIVE_ID,
        "owner_user_id": OWNER_ID,
        "storage_bucket": bucket,
        "storage_path": STORAGE_PATH,
        "mime_type": mime_type,
        "byte_size": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
        "filename": filename,
    }


def test_v3_model_fields_not_monkey_patched(synthetic_pdf_bytes: bytes) -> None:
    """Verify V3's ReaderReadDocumentSource still strictly requires 'hive3-source-documents'."""
    with pytest.raises(Exception):
        ReaderReadDocumentSource(**_make_source_dict(synthetic_pdf_bytes, "application/pdf", "s.pdf", "hive-source-documents"))

    v4_source = V4ReaderReadDocumentSource(
        **_make_source_dict(synthetic_pdf_bytes, "application/pdf", "s.pdf", "hive-source-documents")
    )
    assert v4_source.storage_bucket == "hive-source-documents"


def test_litellm_and_extract_candidates_disabled(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("LITELLM_BASE_URL", "http://127.0.0.1:4000")
    monkeypatch.setenv("LITELLM_API_KEY", "should-be-cleared")
    monkeypatch.setenv("READER_OCR_LITELLM_ALIAS", "vision-alias")

    health = client.get("/health")
    assert health.status_code == 200
    assert health.json() == {
        "status": "ok",
        "bucket": "hive-source-documents",
        "litellm_ocr_enabled": False,
        "ai_extraction_enabled": False,
    }
    assert litellm_configured() is False
    assert "LITELLM_API_KEY" not in os.environ

    # /v1/extract-candidates is not mounted on the V4 wrapper
    extract_resp = client.post("/v1/extract-candidates", json={})
    assert extract_resp.status_code == 404


def test_http_read_pdf_png_jpeg_and_bucket_isolation(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    synthetic_pdf_bytes: bytes,
    synthetic_png_bytes: bytes,
    synthetic_jpeg_bytes: bytes,
) -> None:
    stored_objects: dict[tuple[str, str], bytes] = {
        ("hive-source-documents", STORAGE_PATH): synthetic_pdf_bytes,
    }

    async def fake_download(bucket: str, path: str) -> bytes:
        return stored_objects[(bucket, path)]

    monkeypatch.setattr(v4_reader_wrapper, "download_storage_object", fake_download)

    # 1. PDF read via POST /v1/read-document with bucket 'hive-source-documents'
    pdf_resp = client.post(
        "/v1/read-document",
        headers={"Authorization": f"Bearer {V4_TOKEN}", "x-correlation-id": "corr-pdf"},
        json={
            "contract_version": "reader-document-read@1",
            "source": _make_source_dict(synthetic_pdf_bytes, "application/pdf", "synthetic.pdf"),
            "options": {"ocr_mode": "selective", "max_pages": 10},
            "extraction_schema": None,
        },
    )
    assert pdf_resp.status_code == 200
    pdf_data = pdf_resp.json()
    assert pdf_data["status"] == "SUCCEEDED"
    assert pdf_data["source"]["storage_bucket"] == "hive-source-documents"
    assert pdf_data["source_hash_verified"] is True
    assert pdf_data["page_count"] == 2
    assert [p["extraction_method"] for p in pdf_data["pages"]] == ["pdf_native", "pdf_native"]
    assert pdf_data["provenance"]["model_calls"] == []

    # 2. PNG read via local OCR path
    stored_objects[("hive-source-documents", STORAGE_PATH)] = synthetic_png_bytes
    png_resp = client.post(
        "/v1/read-document",
        headers={"Authorization": f"Bearer {V4_TOKEN}", "x-correlation-id": "corr-png"},
        json={
            "contract_version": "reader-document-read@1",
            "source": _make_source_dict(synthetic_png_bytes, "image/png", "synthetic.png"),
            "options": {"ocr_mode": "selective"},
            "extraction_schema": None,
        },
    )
    assert png_resp.status_code == 200
    png_data = png_resp.json()
    assert png_data["page_count"] == 1
    assert png_data["pages"][0]["extraction_method"] == "image_ocr_local"
    assert png_data["provenance"]["model_calls"] == []

    # 3. JPEG read via local OCR path
    stored_objects[("hive-source-documents", STORAGE_PATH)] = synthetic_jpeg_bytes
    jpg_resp = client.post(
        "/v1/read-document",
        headers={"Authorization": f"Bearer {V4_TOKEN}", "x-correlation-id": "corr-jpg"},
        json={
            "contract_version": "reader-document-read@1",
            "source": _make_source_dict(synthetic_jpeg_bytes, "image/jpeg", "synthetic.jpg"),
            "options": {"ocr_mode": "selective"},
            "extraction_schema": None,
        },
    )
    assert jpg_resp.status_code == 200
    assert jpg_resp.json()["pages"][0]["extraction_method"] == "image_ocr_local"

    # 4. Rejects V3 bucket 'hive3-source-documents' on the V4 wrapper endpoint
    v3_bucket_resp = client.post(
        "/v1/read-document",
        headers={"Authorization": f"Bearer {V4_TOKEN}"},
        json={
            "contract_version": "reader-document-read@1",
            "source": _make_source_dict(
                synthetic_pdf_bytes, "application/pdf", "synthetic.pdf", bucket="hive3-source-documents"
            ),
        },
    )
    assert v3_bucket_resp.status_code == 422


def test_docx_libreoffice_reproducible_via_v4_wrapper(
    monkeypatch: pytest.MonkeyPatch,
    synthetic_docx_two_pages_bytes: bytes,
) -> None:
    import asyncio
    import hive_reader.pipeline.libreoffice_render as lo_mod

    lo_mod._cached_version = None
    bundled_soffice = (
        Path(__file__).resolve().parents[3]
        / "hiveforyou-v3"
        / "apps"
        / "reader"
        / ".tools"
        / "lo762"
        / "extract"
        / "program"
        / "soffice.exe"
    )
    if bundled_soffice.is_file():
        monkeypatch.setattr(settings, "libreoffice_binary", str(bundled_soffice))
        monkeypatch.setattr(settings, "libreoffice_version_pin", "7.6.7.2")
    else:
        monkeypatch.setattr(settings, "libreoffice_version_pin", "")
        try:
            lo_mod.resolve_libreoffice_binary()
        except lo_mod.LibreOfficeRenderError as exc:
            pytest.skip(str(exc))

    req = V4ReaderReadDocumentRequest(
        contract_version="reader-document-read@1",
        source=V4ReaderReadDocumentSource(
            **_make_source_dict(
                synthetic_docx_two_pages_bytes,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "synthetic.docx",
            )
        ),
        options=V4ReaderReadDocumentOptions(ocr_mode="never", max_pages=10),
    )
    result = asyncio.run(read_v4_document(req, content_override=synthetic_docx_two_pages_bytes))
    assert result.status == "SUCCEEDED"
    assert result.source.storage_bucket == "hive-source-documents"
    assert result.page_count == 2
    assert [p.extraction_method for p in result.pages] == ["docx_render_v1", "docx_render_v1"]
    assert "page one" in result.pages[0].text.lower()
    assert "page two" in result.pages[1].text.lower()
    assert result.provenance.model_calls == []
