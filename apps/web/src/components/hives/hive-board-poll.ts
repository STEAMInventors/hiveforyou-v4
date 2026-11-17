export const BOARD_POLL_INTERVAL_MS = 5000;
export const BOARD_POLL_FAILURES_BEFORE_NOTICE = 3;

export type BoardPollState = "ok" | "reconnecting";

export function boardPollStateFromFailures(failures: number): BoardPollState {
  return failures >= BOARD_POLL_FAILURES_BEFORE_NOTICE ? "reconnecting" : "ok";
}