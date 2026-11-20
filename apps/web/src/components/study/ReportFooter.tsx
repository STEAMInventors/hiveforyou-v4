import { HiveMark } from "./HiveMark";

export function ReportFooter() {
  return (
    <footer className="flex items-center justify-center gap-2 py-4 text-[13px] text-quiet" data-testid="report-footer">
      <HiveMark />
      Prepared with HiveForYou
    </footer>
  );
}
