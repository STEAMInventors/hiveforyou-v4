"use client";

import { useRouter } from "next/navigation";
import { Component, type ErrorInfo, type ReactNode, Suspense } from "react";

import { Card } from "@/components/workspace/Card";
import { WorkspaceError } from "@/components/workspace/WorkspaceError";

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
      <div data-testid="pane-error">
        <Card>
          <WorkspaceError
            message="This section couldn't load. Your saved Study is unchanged."
            correlationId={reference}
            retryable
            onRetry={() => {
              this.setState({ error: null });
              this.props.onRetry();
            }}
          />
        </Card>
      </div>
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
