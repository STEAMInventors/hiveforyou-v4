"use client";

import {
  validateCreateHiveInput,
  type Hive,
} from "@hiveforyou/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import {
  HiveClientError,
  createHive,
  fetchMyHives,
} from "@/lib/hives-client";

import { CreateHiveModal } from "./CreateHiveModal";

type MyHivesPanelProps = {
  initialHives: Hive[];
  initialError?: string | null;
};

function formatUpdatedAt(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return `Updated ${parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

export function MyHivesPanel({
  initialHives,
  initialError = null,
}: MyHivesPanelProps) {
  const router = useRouter();
  const [hives, setHives] = useState<Hive[]>(initialHives);
  const [listError, setListError] = useState<string | null>(initialError);
  const [refreshing, setRefreshing] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [hiveName, setHiveName] = useState("");
  const [hiveDescription, setHiveDescription] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const clientRequestIdRef = useRef<string>(crypto.randomUUID());

  const handleOpenCreateModal = useCallback(() => {
    setNameError(null);
    setDescriptionError(null);
    setSubmitError(null);
    setModalOpen(true);
  }, []);

  const handleCloseCreateModal = useCallback(() => {
    if (submitBusy) {
      return;
    }
    setModalOpen(false);
    setHiveName("");
    setHiveDescription("");
    setNameError(null);
    setDescriptionError(null);
    setSubmitError(null);
    clientRequestIdRef.current = crypto.randomUUID();
  }, [submitBusy]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setListError(null);
    try {
      const response = await fetchMyHives();
      setHives(response.hives);
    } catch (error) {
      setListError(
        error instanceof HiveClientError
          ? error.message
          : "Could not load your Hives.",
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleCreateSubmit = useCallback(async () => {
    const validated = validateCreateHiveInput({
      name: hiveName,
      description: hiveDescription,
      clientRequestId: clientRequestIdRef.current,
    });

    if (!validated.ok) {
      setNameError(validated.nameError ?? null);
      setDescriptionError(validated.descriptionError ?? null);
      if (!validated.nameError && !validated.descriptionError) {
        setSubmitError(validated.message);
      }
      return;
    }

    setNameError(null);
    setDescriptionError(null);
    setSubmitError(null);
    setSubmitBusy(true);

    try {
      const response = await createHive({
        name: validated.value.name,
        description: validated.value.description,
        clientRequestId: validated.value.clientRequestId,
      });

      setHives((prev) => {
        const exists = prev.some((item) => item.id === response.hive.id);
        return exists ? prev : [response.hive, ...prev];
      });

      setModalOpen(false);
      setHiveName("");
      setHiveDescription("");
      clientRequestIdRef.current = crypto.randomUUID();
      router.push(`/hives/${response.hive.id}/documents`);
    } catch (error) {
      if (
        error instanceof HiveClientError &&
        error.errorCode === "IDEMPOTENCY_CONFLICT"
      ) {
        clientRequestIdRef.current = crypto.randomUUID();
      }
      setSubmitError(
        error instanceof HiveClientError
          ? error.message
          : "Could not create your Hive. Please try again.",
      );
    } finally {
      setSubmitBusy(false);
    }
  }, [hiveDescription, hiveName, router]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", margin: 0 }}>
            My Hives
          </h1>
          <p className="muted" style={{ margin: "0.25rem 0 0" }}>
            Each Hive keeps one situation&apos;s documents and Canonical Study
            together.
          </p>
        </div>
        <button
          type="button"
          className="button"
          onClick={handleOpenCreateModal}
          disabled={submitBusy}
        >
          New Hive
        </button>
      </div>

      {listError ? (
        <div
          className="card"
          role="alert"
          style={{ marginTop: "1.5rem" }}
        >
          <p className="notice-error">{listError}</p>
          <button
            type="button"
            className="button button-secondary"
            style={{ marginTop: "0.75rem" }}
            disabled={refreshing}
            onClick={() => void handleRefresh()}
          >
            {refreshing ? "Loading…" : "Try again"}
          </button>
        </div>
      ) : null}

      {!listError && hives.length === 0 ? (
        <section
          className="card"
          aria-labelledby="empty-hives-title"
          style={{ marginTop: "1.5rem" }}
        >
          <h2
            id="empty-hives-title"
            style={{ marginTop: 0, fontSize: "1.125rem" }}
          >
            Create a hive to get started
          </h2>
          <p className="muted" style={{ marginBottom: "1rem" }}>
            You don&apos;t have any Hives yet. Create one to organize documents
            and build an evidence-backed Study.
          </p>
          <button
            type="button"
            className="button"
            onClick={handleOpenCreateModal}
          >
            Create a Hive
          </button>
        </section>
      ) : null}

      {hives.length > 0 ? (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            marginTop: "1.5rem",
            display: "grid",
            gap: "0.75rem",
          }}
        >
          {hives.map((hive) => (
            <li key={hive.id} className="card">
              <h2 style={{ margin: "0 0 0.25rem", fontSize: "1.125rem" }}>
                <Link
                  href={`/hives/${hive.id}/documents`}
                  style={{ textDecoration: "none", color: "var(--color-ink)" }}
                >
                  {hive.name}
                </Link>
              </h2>
              {hive.description ? (
                <p className="muted" style={{ margin: "0 0 0.5rem" }}>
                  {hive.description}
                </p>
              ) : null}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                  flexWrap: "wrap",
                  marginTop: "0.5rem",
                }}
              >
                <span className="muted" style={{ fontSize: "0.8125rem" }}>
                  No accepted Study yet · {formatUpdatedAt(hive.updatedAt)}
                </span>
                <Link href={`/hives/${hive.id}/documents`}>Open hive</Link>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <CreateHiveModal
        open={modalOpen}
        hiveName={hiveName}
        hiveDescription={hiveDescription}
        nameError={nameError}
        descriptionError={descriptionError}
        submitError={submitError}
        submitBusy={submitBusy}
        onHiveNameChange={(val) => {
          setHiveName(val);
          if (nameError) {
            setNameError(null);
          }
          if (submitError) {
            setSubmitError(null);
          }
        }}
        onHiveDescriptionChange={(val) => {
          setHiveDescription(val);
          if (descriptionError) {
            setDescriptionError(null);
          }
          if (submitError) {
            setSubmitError(null);
          }
        }}
        onCancel={handleCloseCreateModal}
        onSubmit={() => void handleCreateSubmit()}
      />
    </div>
  );
}
