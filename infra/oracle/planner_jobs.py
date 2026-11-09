"""
In-process async completion jobs for pipeline tasks that may exceed the HTTPS proxy limit.
Mirrors planner-job wire contracts in packages/contracts.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Literal

from v4_planner import PlannerCompletionRequest, PlannerError

JOB_CONTRACT_VERSION = "planner-job@1"
JobStatus = Literal["queued", "running", "succeeded", "failed"]

JOB_TTL_SECONDS = 3600.0
DEFAULT_MAX_WORKERS = 4


@dataclass
class _JobRecord:
    job_id: str
    request: PlannerCompletionRequest
    status: JobStatus = "queued"
    created_at: float = field(default_factory=time.monotonic)
    started_at: float | None = None
    finished_at: float | None = None
    result: dict[str, Any] | None = None
    error: PlannerError | None = None
    latency_ms: int | None = None


class PlannerJobStore:
    """Bounded worker pool with in-memory results retained for one hour."""

    def __init__(self, run_completion: Callable[[PlannerCompletionRequest], Awaitable[dict[str, Any]]], *, max_workers: int = DEFAULT_MAX_WORKERS) -> None:
        self._run_completion = run_completion
        self._max_workers = max(1, max_workers)
        self._jobs: dict[str, _JobRecord] = {}
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._workers: list[asyncio.Task[None]] = []
        self._started = False
        self._lock = asyncio.Lock()

    def start(self) -> None:
        if self._started:
            return
        self._started = True
        for _ in range(self._max_workers):
            self._workers.append(asyncio.create_task(self._worker_loop(), name="planner-job-worker"))

    async def submit(self, request: PlannerCompletionRequest) -> str:
        self.start()
        job_id = str(uuid.uuid4())
        record = _JobRecord(job_id=job_id, request=request)
        async with self._lock:
            self._purge_expired_locked()
            self._jobs[job_id] = record
        await self._queue.put(job_id)
        return job_id

    def get(self, job_id: str) -> _JobRecord | None:
        self._purge_expired()
        return self._jobs.get(job_id)

    def snapshot(self, job_id: str) -> dict[str, object] | None:
        record = self.get(job_id)
        if record is None:
            return None
        body: dict[str, object] = {
            "contract_version": JOB_CONTRACT_VERSION,
            "job_id": record.job_id,
            "status": record.status,
            "task": record.request.task,
        }
        if record.status == "succeeded" and record.result is not None:
            body["result"] = record.result
            if record.latency_ms is not None:
                body["latency_ms"] = record.latency_ms
        if record.status == "failed" and record.error is not None:
            body["error"] = {
                "error_code": record.error.code,
                "retryable": record.error.retryable,
                "diagnostic_reason": record.error.diagnostic_reason,
            }
            if record.latency_ms is not None:
                body["latency_ms"] = record.latency_ms
        return body

    def _purge_expired(self) -> None:
        now = time.monotonic()
        expired = [jid for jid, rec in self._jobs.items() if now - rec.created_at > JOB_TTL_SECONDS]
        for jid in expired:
            self._jobs.pop(jid, None)

    def _purge_expired_locked(self) -> None:
        self._purge_expired()

    async def _worker_loop(self) -> None:
        while True:
            job_id = await self._queue.get()
            try:
                await self._run_one(job_id)
            finally:
                self._queue.task_done()

    async def _run_one(self, job_id: str) -> None:
        record = self._jobs.get(job_id)
        if record is None or record.status != "queued":
            return
        record.status = "running"
        record.started_at = time.monotonic()
        started = record.started_at
        try:
            result = await self._run_completion(record.request)
            record.result = result
            record.latency_ms = int(result.get("latency_ms") or 0) if isinstance(result.get("latency_ms"), int) else int((time.monotonic() - started) * 1000)
            record.status = "succeeded"
        except PlannerError as exc:
            record.error = exc
            record.latency_ms = int((time.monotonic() - started) * 1000)
            record.status = "failed"
        except Exception:
            record.error = PlannerError(
                503,
                "MODEL_UNAVAILABLE",
                "dependency",
                True,
                "The planning model is unavailable.",
                "planner_job_worker_error",
            )
            record.latency_ms = int((time.monotonic() - started) * 1000)
            record.status = "failed"
        finally:
            record.finished_at = time.monotonic()


_store: PlannerJobStore | None = None


def init_job_store(run_completion: Callable[[PlannerCompletionRequest], Awaitable[dict[str, Any]]], *, max_workers: int = DEFAULT_MAX_WORKERS) -> PlannerJobStore:
    global _store
    _store = PlannerJobStore(run_completion, max_workers=max_workers)
    return _store


def ensure_job_store(run_completion: Callable[[PlannerCompletionRequest], Awaitable[dict[str, Any]]], *, max_workers: int = DEFAULT_MAX_WORKERS) -> PlannerJobStore:
    global _store
    if _store is None:
        init_job_store(run_completion, max_workers=max_workers)
    return _store


def job_store() -> PlannerJobStore:
    if _store is None:
        raise RuntimeError("planner job store not initialized")
    return _store
