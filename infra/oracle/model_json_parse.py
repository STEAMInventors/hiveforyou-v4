"""
Strict parsing of model completion text as one JSON object.

Accepts: optional UTF-8 BOM, outer whitespace, raw `{...}`, or one complete Markdown
JSON fence. Rejects prose wrappers, multiple values, incomplete fences, and repairs nothing.
"""

from __future__ import annotations

import json
import re
from typing import Any

UTF8_BOM = "\ufeff"

# Entire completion must be optional BOM, optional outer whitespace, one fence, optional trailing whitespace.
MARKDOWN_JSON_FENCE_RE = re.compile(
    r"^[ \t\r\n]*```[ \t]*(?:json)?[ \t]*\r?\n(?P<body>.*)\r?\n```[ \t\r\n]*\Z",
    re.DOTALL | re.IGNORECASE,
)


class ModelJsonParseError(ValueError):
    def __init__(self, message: str, *, category: str) -> None:
        super().__init__(message)
        self.category = category


def _strip_leading_bom(text: str) -> str:
    return text[1:] if text.startswith(UTF8_BOM) else text


def _decode_single_object(payload: str) -> dict[str, Any]:
    trimmed = payload.strip()
    if not trimmed:
        raise ModelJsonParseError("empty payload", category="empty")
    if trimmed[0] != "{":
        raise ModelJsonParseError("payload does not start with a JSON object", category="surrounding_text")
    decoder = json.JSONDecoder()
    try:
        value, end = decoder.raw_decode(trimmed)
    except json.JSONDecodeError:
        raise
    remainder = trimmed[end:].strip()
    if remainder:
        raise json.JSONDecodeError("Extra data", remainder, 0)
    if not isinstance(value, dict):
        raise ModelJsonParseError("JSON value is not an object", category="not_object")
    return value


def parse_model_json_object(content: str) -> dict[str, Any]:
    if not isinstance(content, str):
        raise ModelJsonParseError("content is not text", category="invalid_type")
    text = _strip_leading_bom(content)
    fence = MARKDOWN_JSON_FENCE_RE.match(text)
    if fence:
        body = fence.group("body")
        if "```" in body:
            raise ModelJsonParseError("nested markdown fences", category="wrapped_json")
        return _decode_single_object(body)
    stripped = text.strip()
    if not stripped:
        raise ModelJsonParseError("empty completion", category="empty")
    if stripped[0] == "[":
        raise ModelJsonParseError("JSON array is not an object", category="not_object")
    if stripped[0] != "{":
        if stripped.startswith("```"):
            if stripped.count("```") > 2:
                raise ModelJsonParseError("multiple markdown fences", category="wrapped_json")
            if re.search(r"```[ \t]*(?:json)?[ \t]*\r?\n.*\r?\n```", stripped, re.DOTALL | re.IGNORECASE):
                raise ModelJsonParseError("markdown fence has surrounding text", category="wrapped_json")
            raise ModelJsonParseError("incomplete markdown fence", category="invalid_json")
        if "{" in stripped or "[" in stripped:
            raise ModelJsonParseError("JSON is wrapped in surrounding text", category="wrapped_json")
        raise ModelJsonParseError("completion is not a bare JSON object or single fence", category="surrounding_text")
    return _decode_single_object(stripped)
