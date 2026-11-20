import { HivesListSkeleton } from "@/components/hives/HivesListSkeleton";

export default function HivesLoading() {
  return (
    <div className="mx-auto w-full max-w-col-wide px-4 pb-24 pt-8 min-[760px]:px-8 min-[760px]:pt-10">
      <div className="h-7 w-40 animate-pulse rounded-control bg-mist" aria-hidden />
      <div className="mt-3 h-6 w-72 max-w-full animate-pulse rounded-control bg-mist" aria-hidden />
      <div className="mt-8">
        <HivesListSkeleton />
      </div>
    </div>
  );
}
