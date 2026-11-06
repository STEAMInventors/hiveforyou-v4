"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Component, type ErrorInfo, type ReactNode, Suspense } from "react";

import { QUIET_LINK_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/button-classes";
import { HiveMark } from "@/components/study/HiveMark";
import { hiveDocumentsPath } from "@/lib/hive-routes";

type BoundaryProps = {
  hiveId: string;
  supportReference: string | null;
  onRetry: () => void;
  children: ReactNode;
};

type BoundaryState = { error: (Error & { digest?: string }) | null };

class Boundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Name and component stack only: messages can carry document text.
    console.error("Hive pane failed to render", error.name, info.componentStack?.split("\n").slice(0, 4).join("\n"));
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const reference = this.props.supportReference ?? error.digest ?? null;
    return (
      <section role="alert" className="flex flex-col gap-3 rounded-card border border-line bg-paper p-5 sm:p-7" data-testid="pane-error">
        <h2 className="m-0 inline-flex items-center gap-2 font-brand text-section font-semibold text-ink">
          <HiveMark className="h-5 w-5 shrink-0" />
          Something went wrong here
        </h2>
        <p className="m-0 max-w-prose text-body text-graphite">We couldn&apos;t show this. Try again, or rebuild the study.</p>
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            onClick={() => {
              this.setState({ error: null });
              this.props.onRetry();
            }}
          >
            Try again
          </button>
          <Link href={hiveDocumentsPath(this.props.hiveId)} className={QUIET_LINK_CLASS}>
            Rebuild the study from Documents
          </Link>
        </div>
        {reference ? <p className="m-0 font-mono text-[12px] text-quiet">Support reference: {reference}</p> : null}
      </section>
    );
  }
}

/**
 * Catches render errors in the Study and Reports panes. The Suspense boundary inside lets an error
 * thrown while rendering on the server fall through to the client, where this boundary catches it.
 */
export function PaneErrorBoundary({
  hiveId,
  supportReference = null,
  children,
}: {
  hiveId: string;
  supportReference?: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <Boundary hiveId={hiveId} supportReference={supportReference} onRetry={() => router.refresh()}>
      <Suspense fallback={null}>{children}</Suspense>
    </Boundary>
  );
}
