"use client";

import {
  type AcknowledgeStudyCoverageRequest,
  type AcknowledgeStudyCoverageResponse,
  type GetStudyPreparationResponse,
  normalizeGetStudyPreparationResponse,
  normalizeProcessingRun,
  normalizeStartStudyPreparationResponse,
  type StartStudyPreparationRequest,
  type StartStudyPreparationResponse,
} from "@hiveforyou/contracts";

import { CORRELATION_HEADER_NAME, HiveClientError, parseApiJson } from "./hives-client";

function studyPreparationPath(hiveId: string): string {
  return `/api/v1/hives/${encodeURIComponent(hiveId)}/study-preparation`;
}

function unexpected(correlationId: string, message: string): HiveClientError {
  return new HiveClientError({ message, errorCode: "PERSISTENCE_FAILED", retryable: true, correlationId, status: 200 });
}

export async function fetchStudyPreparation(hiveId: string): Promise<GetStudyPreparationResponse> {
  const correlationId = crypto.randomUUID();
  const response = await fetch(studyPreparationPath(hiveId), {
    headers: { [CORRELATION_HEADER_NAME]: correlationId },
    credentials: "same-origin",
    cache: "no-store",
  });
  const message = "Could not load analysis progress.";
  const normalized = normalizeGetStudyPreparationResponse(await parseApiJson<unknown>(response, correlationId, message));
  if (!normalized) throw unexpected(correlationId, message);
  return normalized;
}

export async function startStudyPreparation(
  hiveId: string,
  payload: StartStudyPreparationRequest,
): Promise<StartStudyPreparationResponse> {
  const correlationId = crypto.randomUUID();
  const response = await fetch(studyPreparationPath(hiveId), {
    method: "POST",
    headers: { "Content-Type": "application/json", [CORRELATION_HEADER_NAME]: correlationId },
    credentials: "same-origin",
    body: JSON.stringify(payload),
  });
  const message = "Could not start the analysis. Try again.";
  const normalized = normalizeStartStudyPreparationResponse(await parseApiJson<unknown>(response, correlationId, message));
  if (!normalized) throw unexpected(correlationId, message);
  return normalized;
}

export async function acknowledgeStudyCoverage(
  hiveId: string,
  payload: AcknowledgeStudyCoverageRequest,
): Promise<AcknowledgeStudyCoverageResponse> {
  const correlationId = crypto.randomUUID();
  const response = await fetch(`${studyPreparationPath(hiveId)}/acknowledge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [CORRELATION_HEADER_NAME]: correlationId },
    credentials: "same-origin",
    body: JSON.stringify(payload),
  });
  const message = "Could not continue the analysis. Try again.";
  const body = await parseApiJson<{ processingRun?: unknown; resumed?: unknown }>(response, correlationId, message);
  const processingRun = normalizeProcessingRun(body?.processingRun);
  if (!processingRun) throw unexpected(correlationId, message);
  return { processingRun, resumed: body.resumed === true };
}
