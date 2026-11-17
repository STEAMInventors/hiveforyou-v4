import { Card } from "./Card";

type WorkspacePageSkeletonProps = {
  variant: "board" | "study" | "documents" | "reports" | "list";
};

function Block({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-control bg-mist ${className}`} aria-hidden />;
}

export function WorkspacePageSkeleton({ variant }: WorkspacePageSkeletonProps) {
  return (
    <div className="flex flex-col gap-4 p-4 min-[900px]:p-6" data-testid="workspace-page-skeleton">
      <Block className="h-7 w-48" />
      <Block className="h-4 w-full max-w-md" />
      {variant === "board" ? (
        <div className="grid gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_384px]">
          <div className="flex flex-col gap-4">
            <Block className="h-9 w-72" />
            <Block className="h-2 w-full max-w-lg" />
            <Card>
              <Block className="mb-3 h-5 w-32" />
              <Block className="h-14 w-full" />
              <Block className="mt-2 h-14 w-full" />
            </Card>
            <Card>
              <Block className="mb-3 h-5 w-24" />
              <Block className="h-10 w-full" />
              <Block className="mt-2 h-10 w-full" />
            </Card>
          </div>
          <Card>
            <Block className="h-8 w-40" />
            <Block className="mt-4 h-20 w-full" />
          </Card>
        </div>
      ) : null}
      {variant === "study" || variant === "list" ? (
        <Card>
          <Block className="mb-3 h-5 w-36" />
          <Block className="h-12 w-full" />
          <Block className="mt-2 h-12 w-full" />
          <Block className="mt-2 h-12 w-full" />
        </Card>
      ) : null}
      {variant === "documents" ? (
        <>
          <Card>
            <Block className="h-10 w-full" />
          </Card>
          <Card>
            <Block className="h-24 w-full" />
          </Card>
        </>
      ) : null}
      {variant === "reports" ? (
        <Card>
          <Block className="h-32 w-full" />
        </Card>
      ) : null}
    </div>
  );
}
