"use client";

import {
  type GenerateHiveReportRequest,
  type GetHiveReportsResponse,
  type HiveReport,
  normalizeGetHiveReportsResponse,
  normalizeHiveReport,
  normalizeReportRun,
  type ReportRun,
} from "@hiveforyou/contracts";

import { CORRELATION_HEADER_NAME, HiveClientError, parseApiJson } from "./hives-client";

function reportsPath(hiveId: string): string {
  return `/api/v1/hives/${encodeURIComponent(hiveId)}/reports`;
}

function unexpected(correlationId: string, message: string): HiveClientError {
  return new HiveClientError({ message, errorCode: "PERSISTENCE_FAILED", retryable: true, correlationId, status: 200 });
}

export async function fetchHiveReports(hiveId: string): Promise<GetHiveReportsResponse> {
  const correlationId = crypto.randomUUID();
  const response = await fetch(reportsPath(hiveId), {
    headers: { [CORRELATION_HEADER_NAME]: correlationId },
    credentials: "same-origin",
    cache: "no-store",
  });
  const message = "Could not load your reports.";
  const normalized = normalizeGetHiveReportsResponse(await parseApiJson<unknown>(response, correlationId, message));
  if (!normalized) throw unexpected(correlationId, message);
  return normalized;
}

export async function fetchHiveReport(hiveId: string, reportId: string): Promise<HiveReport> {
  const correlationId = crypto.randomUUID();
  const response = await fetch(`${reportsPath(hiveId)}/${encodeURIComponent(reportId)}`, {
    headers: { [CORRELATION_HEADER_NAME]: correlationId },
    credentials: "same-origin",
    cache: "no-store",
  });
  const message = "Could not load this report.";
  const body = await parseApiJson<{ report?: unknown }>(response, correlationId, message);
  const report = normalizeHiveReport(body?.report);
  if (!report) throw unexpected(correlationId, message);
  return report;
}

export async function generateHiveReport(
  hiveId: string,
  payload: GenerateHiveReportRequest,
): Promise<{ reportRun: ReportRun; created: boolean }> {
  const correlationId = crypto.randomUUID();
  const response = await fetch(reportsPath(hiveId), {
    method: "POST",
    headers: { "Content-Type": "application/json", [CORRELATION_HEADER_NAME]: correlationId },
    credentials: "same-origin",
    body: JSON.stringify(payload),
  });
  const message = "Could not start a new report. Try again.";
  const body = await parseApiJson<{ reportRun?: unknown; created?: unknown }>(response, correlationId, message);
  const reportRun = normalizeReportRun(body?.reportRun);
  if (!reportRun) throw unexpected(correlationId, message);
  return { reportRun, created: body.created === true };
}
