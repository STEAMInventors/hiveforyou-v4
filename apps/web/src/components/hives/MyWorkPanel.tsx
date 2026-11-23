"use client";

import {
  buildMyWorkModel,
  isProRequest,
  type ClientRequestResponse,
  type ListRequestsResponse,
  type MyWorkGroup,
  type MyWorkRequest,
  type MyWorkViewer,
  type RequestAction,
  type RequestItem,
  type RequestState,
  type SourceDocument,
  SOURCE_FILE_ACCEPT,
} from "@hiveforyou/contracts";
import { useId, useMemo, useState, type ReactNode } from "react";

import { UploadIcon } from "@/components/hives/SourceFilePicker";
import { Button } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { Section } from "@/components/ui/Section";
import { ShowFewer, ShowMore } from "@/components/ui/ShowMore";
import { StatusDot, type StatusDotState } from "@/components/ui/StatusDot";
import { HiveClientError } from "@/lib/hive-api-client";
import { addHiveRequest, postRequestAction } from "@/lib/hive-requests-client";
import { uploadSourceDocument } from "@/lib/source-documents-client";

const LEAD_LIMIT = 3;

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function dateLabel(iso: string | null | undefined): string {
  const parsed = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(parsed) ? DATE.format(new Date(parsed)) : "";
}

function dotState(state: RequestState): StatusDotState {
  switch (state) {
    case "WAITING":
    case "NEEDS_FIX":
    case "DOESNT_MATCH":
      return "missing";
    case "NEEDS_REVIEW":
      return "needs";
    case "RECEIVED":
      return "received";
    case "CHECKED":
      return "checked";
    case "READING":
    case "NOT_NEEDED":
      return "grey";
  }
}

type ActionError = { requestId: string | null; message: string; correlationId: string };

function toActionError(requestId: string | null, error: unknown): ActionError {
  if (error instanceof HiveClientError) {
    return { requestId, message: error.message, correlationId: error.correlationId };
  }
  const message = error instanceof Error && error.message ? error.message : "Something went wrong. Try again.";
  return { requestId, message, correlationId: "" };
}

export type MyWorkUpload = {
  id: string;
  fileName: string;
  createdAt: string;
};

export type MyWorkPanelProps = {
  hiveId: string;
  viewer: MyWorkViewer;
  currentUserId: string;
  initialRequests: readonly RequestItem[];
  /** First name of the other side ("Pat" for a client, the client's first name for staff). */
  otherFirstName: string | null;
  /** Personal Hive: show the section with an empty state, and ignore pack or study rows. */
  personal?: boolean;
  uploadedDocuments?: readonly MyWorkUpload[];
  onDocumentUploaded?: (document: SourceDocument) => void;
  className?: string;
};

export function MyWorkPanel({
  hiveId,
  viewer,
  currentUserId,
  initialRequests,
  otherFirstName,
  personal = false,
  uploadedDocuments = [],
  onDocumentUploaded,
  className = "",
}: MyWorkPanelProps) {
  const [requests, setRequests] = useState<readonly RequestItem[]>(initialRequests);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [leadOpen, setLeadOpen] = useState(false);
  const headingId = useId();
  const visibleRequests = personal ? requests.filter(isProRequest) : requests;
  const model = useMemo(
    () => buildMyWorkModel(visibleRequests, viewer, currentUserId),
    [visibleRequests, viewer, currentUserId],
  );

  const run = async (requestId: string | null, work: () => Promise<ListRequestsResponse>): Promise<boolean> => {
    if (busyId) return false;
    setBusyId(requestId ?? "new");
    setError(null);
    try {
      const listed = await work();
      setRequests(listed.requests);
      return true;
    } catch (caught) {
      setError(toActionError(requestId, caught));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const act = (requestId: string, action: RequestAction, idempotencyKey?: string) =>
    run(requestId, () => postRequestAction(hiveId, requestId, action, idempotencyKey));

  const upload = (requestId: string, file: File) =>
    run(requestId, async () => {
      const { sourceDocument } = await uploadSourceDocument(hiveId, { file, clientRequestId: crypto.randomUUID() });
      if (sourceDocument.status !== "REGISTERED") throw new Error("The file was not accepted. Try another copy.");
      onDocumentUploaded?.(sourceDocument);
      return postRequestAction(hiveId, requestId, { action: "attach", sourceDocumentId: sourceDocument.sourceDocumentId });
    });

  if (!personal && visibleRequests.length === 0 && viewer === "client") return null;
  const clientEmpty = personal && viewer === "client" && visibleRequests.length === 0;

  const [first, ...rest] = viewer === "client"
    ? [model.groups.find((g) => g.key === "waiting_on_me")!, ...model.groups.filter((g) => g.key !== "waiting_on_me")]
    : model.groups;
  const leadRows = leadOpen ? first.requests : first.requests.slice(0, LEAD_LIMIT);
  const otherLabel = otherFirstName?.trim() || (viewer === "client" ? "your Pro" : "the client");

  const rowProps = { viewer, busyId, error, otherLabel, act, upload };

  const uploads = personal && viewer === "client" ? (
    <div className="mt-4" data-testid="my-work-uploads">
      <h3 className="m-0 text-[13.5px] font-semibold text-ink-3">Uploaded</h3>
      {uploadedDocuments.length === 0 ? (
        <p className="m-0 py-3 text-body text-ink-2">No documents uploaded yet.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {uploadedDocuments.map((document) => (
            <li key={document.id} className="flex items-baseline justify-between gap-3 border-b border-line py-2.5">
              <span className="min-w-0 text-body text-ink">{document.fileName}</span>
              <span className="shrink-0 text-meta tabular-nums text-ink-3">{dateLabel(document.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  ) : null;

  const body = (
      <div data-testid="my-work-panel" data-viewer={viewer}>
        {clientEmpty ? (
          <p className="m-0 pt-2 text-body text-ink-2" data-testid="my-work-empty">
            No requests from a Pro yet.
          </p>
        ) : (
        <p className="m-0 pt-2 text-meta text-ink-3" data-testid="my-work-summary">
          {summaryLine(model.groups, otherLabel)}
        </p>
        )}

        {clientEmpty ? null : (
        <>
        <h3 className="m-0 mt-4 text-[13.5px] font-semibold text-ink-3">{first.label}</h3>
        {first.requests.length === 0 ? (
          <p className="m-0 py-3 text-body text-ink-2">
            {viewer === "client" ? "Nothing is waiting on you." : "Nothing is waiting on you right now."}
          </p>
        ) : (
          <div data-testid={`my-work-${first.key}`}>
            {leadRows.map((row) => (
              <RequestRow key={row.id} row={row} {...rowProps} />
            ))}
            {first.requests.length > LEAD_LIMIT ? (
              leadOpen ? (
                <ShowFewer label="Show fewer" onClick={() => setLeadOpen(false)} />
              ) : (
                <ShowMore label={`Show all ${first.requests.length}`} onClick={() => setLeadOpen(true)} />
              )
            ) : null}
          </div>
        )}

        {rest.map((group) => (
          <Disclosure key={group.key} title={group.label} hint={String(group.requests.length)}>
            <div data-testid={`my-work-${group.key}`}>
              {group.requests.length === 0 ? <p className="m-0 text-meta text-ink-3">None yet.</p> : null}
              {group.requests.map((row) => (
                <RequestRow key={row.id} row={row} {...rowProps} />
              ))}
              {group.key === "done" && model.myActivity.length > 0 ? (
                <div className="mt-4" data-testid="my-work-activity">
                  <h4 className="m-0 text-[13.5px] font-semibold text-ink-3">Your recorded activity</h4>
                  <ul className="m-0 mt-1 list-none p-0">
                    {model.myActivity.map((line) => (
                      <li key={line.id} className="flex gap-3 border-b border-line py-2 text-meta text-ink-2">
                        <span className="w-[92px] shrink-0 tabular-nums text-ink-3">{dateLabel(line.at)}</span>
                        <span className="min-w-0">{line.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </Disclosure>
        ))}

        {viewer === "staff" ? (
          <AddRequestForm busy={busyId === "new"} onAdd={(title, detail) => run(null, () => addHiveRequest(hiveId, title, detail))} />
        ) : null}
        </>
        )}
        {uploads}
        {error && error.requestId === null ? <ErrorLine error={error} /> : null}
      </div>
  );

  if (viewer === "staff") {
    return (
      <Section title={personal ? "Requests" : "Client requests"} headingRight={visibleRequests.length || null} className={className}>
        {body}
      </Section>
    );
  }
  return (
    <section className={className || "mt-[30px]"} aria-labelledby={headingId}>
      <h2 id={headingId} className="m-0 flex items-baseline justify-between text-[16px] font-semibold text-ink">
        My work and Pro requests
        <span className="text-meta font-medium tabular-nums text-ink-3">{visibleRequests.length}</span>
      </h2>
      {body}
    </section>
  );
}

function summaryLine(groups: readonly MyWorkGroup[], otherLabel: string): string {
  const count = (key: MyWorkGroup["key"]) => groups.find((group) => group.key === key)?.requests.length ?? 0;
  return [
    `${count("waiting_on_me")} waiting on you`,
    `${count("waiting_on_other")} waiting on ${otherLabel}`,
    `${count("done")} done`,
  ].join(" · ");
}

function ErrorLine({ error }: { error: ActionError }) {
  return (
    <p className="m-0 mt-2 text-meta text-coral-deep" role="alert">
      {error.message}
      {error.correlationId ? <span className="text-ink-3"> Reference {error.correlationId.slice(0, 8)}</span> : null}
    </p>
  );
}

type RowProps = {
  row: MyWorkRequest;
  viewer: MyWorkViewer;
  busyId: string | null;
  error: ActionError | null;
  otherLabel: string;
  act: (requestId: string, action: RequestAction, idempotencyKey?: string) => Promise<boolean>;
  upload: (requestId: string, file: File) => Promise<boolean>;
};

type OpenForm = "respond" | "reply" | "ask_again" | null;

function RequestRow({ row, viewer, busyId, error, otherLabel, act, upload }: RowProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [form, setForm] = useState<OpenForm>(null);
  const inputId = useId();
  const busy = busyId === row.id;
  const disabled = busyId !== null;
  const meta = [
    `Requested by ${row.requesterName}`,
    dateLabel(row.requestedAt),
    row.completedAt ? `Done ${dateLabel(row.completedAt)}` : null,
    row.documents.length > 0 ? `${row.documents.length} ${row.documents.length === 1 ? "document" : "documents"}` : null,
  ].filter(Boolean);

  const toggle = (next: OpenForm) => setForm((current) => (current === next ? null : next));

  return (
    <div className="border-b border-line py-3.5" data-testid="my-work-request" data-request-id={row.id}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[14.5px] font-semibold text-ink">{row.title}</p>
          <p className="m-0 mt-0.5 text-meta text-ink-3">{meta.join(" · ")}</p>
          {row.stateNote ? <p className="m-0 mt-1 text-[13.5px] text-ink-2">{row.stateNote}</p> : null}
        </div>
        <StatusDot state={dotState(row.state)} label={row.statusText} />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {row.actions.includes("upload") ? (
          <>
            <input
              id={inputId}
              type="file"
              accept={SOURCE_FILE_ACCEPT}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void upload(row.id, file);
              }}
            />
            <Button variant="secondary" size="small" disabled={disabled} onClick={() => document.getElementById(inputId)?.click()}>
              <UploadIcon />
              {busy ? "Adding…" : "Upload"}
            </Button>
          </>
        ) : null}
        {row.actions.includes("accept") ? (
          <Button variant="secondary" size="small" disabled={disabled} onClick={() => void act(row.id, { action: "resolve", resolution: "ACCEPT", note: null })}>
            Accept
          </Button>
        ) : null}
        {row.actions.includes("ask_again") ? (
          <Button variant="secondary" size="small" disabled={disabled} onClick={() => toggle("ask_again")} aria-expanded={form === "ask_again"}>
            Ask again
          </Button>
        ) : null}
        {row.actions.includes("not_needed") ? (
          <Button variant="secondary" size="small" disabled={disabled} onClick={() => void act(row.id, { action: "resolve", resolution: "NOT_NEEDED", note: null })}>
            Not needed
          </Button>
        ) : null}
        {row.actions.includes("respond") ? (
          <Button variant="secondary" size="small" disabled={disabled} onClick={() => toggle("respond")} aria-expanded={form === "respond"}>
            I can&apos;t send this
          </Button>
        ) : null}
        {row.actions.includes("reply") ? (
          <Button variant="quiet" size="small" disabled={disabled} onClick={() => toggle("reply")} aria-expanded={form === "reply"}>
            Reply
          </Button>
        ) : null}
        <Button variant="text" size="small" onClick={() => setDetailsOpen((open) => !open)} aria-expanded={detailsOpen}>
          {detailsOpen ? "Hide history" : "History"}
        </Button>
      </div>

      {form === "respond" ? (
        <RespondForm
          busy={busy}
          onSubmit={async (response, note) => {
            if (await act(row.id, { action: "respond", response, note })) setForm(null);
          }}
        />
      ) : null}
      {form === "reply" ? (
        <NoteForm
          label={`Reply to ${otherLabel} about this request`}
          submitLabel="Send reply"
          required
          maxLength={4000}
          busy={busy}
          onSubmit={async (text, key) => {
            if (await act(row.id, { action: "reply", body: text }, key)) setForm(null);
          }}
        />
      ) : null}
      {form === "ask_again" ? (
        <NoteForm
          label="What should the client send instead? (optional)"
          submitLabel="Ask again"
          maxLength={1000}
          busy={busy}
          onSubmit={async (text) => {
            if (await act(row.id, { action: "resolve", resolution: "ASK_AGAIN", note: text || null })) setForm(null);
          }}
        />
      ) : null}
      {error && error.requestId === row.id ? <ErrorLine error={error} /> : null}

      {detailsOpen ? <RequestDetails row={row} viewer={viewer} /> : null}
    </div>
  );
}

function RequestDetails({ row, viewer }: { row: MyWorkRequest; viewer: MyWorkViewer }) {
  return (
    <div className="mt-3 border-l-2 border-line pl-3" data-testid="my-work-history">
      {row.detail ? <p className="m-0 mb-2 text-[13.5px] text-ink-2">{row.detail}</p> : null}
      {row.documents.length > 0 ? (
        <DetailBlock title="Documents">
          {row.documents.map((document) => (
            <li key={document.id} className="py-1 text-meta text-ink-2">
              {document.fileName}
              <span className="text-ink-3">
                {" · "}
                {document.uploadedByDisplayName ? `${document.uploadedByDisplayName}, ` : ""}
                {dateLabel(document.addedAt ?? document.createdAt)}
              </span>
            </li>
          ))}
        </DetailBlock>
      ) : null}
      <DetailBlock title="History">
        {row.history.length === 0 ? <li className="py-1 text-meta text-ink-3">No history recorded yet.</li> : null}
        {row.history.map((line) => (
          <li key={line.id} className="py-1 text-meta text-ink-2">
            <span className="tabular-nums text-ink-3">{dateLabel(line.at)}</span> · {line.actorName} {line.text}
            {line.note ? <span className="block text-ink-2">“{line.note}”</span> : null}
          </li>
        ))}
      </DetailBlock>
      {row.messages.length > 0 ? (
        <p className="m-0 mt-2 text-meta text-ink-3">
          {row.messages.length === 1 ? "This reply also appears" : `These ${row.messages.length} replies also appear`} in
          Messages{viewer === "client" ? " with your Pro" : ""}.
        </p>
      ) : null}
    </div>
  );
}

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-2 first:mt-0">
      <h4 className="m-0 text-meta font-semibold text-ink-3">{title}</h4>
      <ul className="m-0 list-none p-0">{children}</ul>
    </div>
  );
}

function RespondForm({ busy, onSubmit }: { busy: boolean; onSubmit: (response: ClientRequestResponse, note: string | null) => void }) {
  const [response, setResponse] = useState<ClientRequestResponse>("DONT_HAVE");
  const [note, setNote] = useState("");
  const name = useId();
  return (
    <form
      className="mt-3 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(response, note.trim() || null);
      }}
    >
      <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0">
        <legend className="mb-1 text-meta text-ink-3">Tell your Pro why</legend>
        {(
          [
            ["DONT_HAVE", "I don't have it"],
            ["DOESNT_APPLY", "It doesn't apply to me"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex min-h-10 items-center gap-2 text-[13.5px] text-ink">
            <input type="radio" name={name} value={value} checked={response === value} onChange={() => setResponse(value)} />
            {label}
          </label>
        ))}
      </fieldset>
      <textarea
        className="min-h-[64px] rounded-[9px] border border-line-strong p-2.5 text-[14px] text-ink focus:border-blue focus:outline-none"
        placeholder="Add a note (optional)"
        maxLength={1000}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        aria-label="Note for your Pro"
      />
      <div>
        <Button variant="secondary" size="small" type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}

function NoteForm({
  label,
  submitLabel,
  required = false,
  maxLength,
  busy,
  onSubmit,
}: {
  label: string;
  submitLabel: string;
  required?: boolean;
  maxLength: number;
  busy: boolean;
  onSubmit: (text: string, idempotencyKey: string) => void;
}) {
  const [text, setText] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const id = useId();
  return (
    <form
      className="mt-3 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (required && !text.trim()) return;
        onSubmit(text.trim(), key);
      }}
    >
      <label htmlFor={id} className="text-meta text-ink-3">
        {label}
      </label>
      <textarea
        id={id}
        className="min-h-[64px] rounded-[9px] border border-line-strong p-2.5 text-[14px] text-ink focus:border-blue focus:outline-none"
        maxLength={maxLength}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div>
        <Button variant="secondary" size="small" type="submit" disabled={busy || (required && !text.trim())}>
          {busy ? "Sending…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function AddRequestForm({ busy, onAdd }: { busy: boolean; onAdd: (title: string, detail: string | null) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const titleId = useId();
  if (!open) {
    return (
      <div className="mt-3">
        <Button variant="text" size="small" onClick={() => setOpen(true)}>
          Add a request
        </Button>
      </div>
    );
  }
  return (
    <form
      className="mt-3 flex flex-col gap-2"
      data-testid="my-work-add-request"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!title.trim()) return;
        if (await onAdd(title.trim(), detail.trim() || null)) {
          setTitle("");
          setDetail("");
          setOpen(false);
        }
      }}
    >
      <label htmlFor={titleId} className="text-meta text-ink-3">
        What should the client send?
      </label>
      <input
        id={titleId}
        className="h-10 rounded-[9px] border border-line-strong px-2.5 text-[14px] text-ink focus:border-blue focus:outline-none"
        maxLength={500}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <textarea
        className="min-h-[56px] rounded-[9px] border border-line-strong p-2.5 text-[14px] text-ink focus:border-blue focus:outline-none"
        placeholder="Why or which period (optional)"
        maxLength={1000}
        value={detail}
        onChange={(event) => setDetail(event.target.value)}
        aria-label="Request detail"
      />
      <div className="flex gap-2">
        <Button variant="secondary" size="small" type="submit" disabled={busy || !title.trim()}>
          {busy ? "Adding…" : "Add request"}
        </Button>
        <Button variant="quiet" size="small" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
