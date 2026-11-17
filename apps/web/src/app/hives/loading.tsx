import { Card } from "@/components/workspace/Card";

function RowSkeleton() {
  return <div className="h-14 w-full animate-pulse rounded-control bg-mist" aria-hidden />;
}

export default function HivesLoading() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-canvas min-[900px]:grid min-[900px]:grid-cols-[236px_minmax(0,1fr)]">
      <div className="hidden min-h-[240px] min-[900px]:block min-[900px]:border-r min-[900px]:border-line min-[900px]:bg-paper" />
      <div className="mx-auto flex w-full max-w-workspace flex-1 flex-col gap-4 px-4 py-6 min-[900px]:px-8">
        <div className="h-6 w-48 animate-pulse rounded-control bg-mist" aria-hidden />
        <div className="h-8 w-64 animate-pulse rounded-control bg-mist" aria-hidden />
        <Card>
          <RowSkeleton />
          <div className="mt-2">
            <RowSkeleton />
          </div>
          <div className="mt-2">
            <RowSkeleton />
          </div>
        </Card>
      </div>
    </div>
  );
}