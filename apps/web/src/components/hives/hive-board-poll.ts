export const BOARD_POLL_INTERVAL_MS = 20000;
export const BOARD_POLL_FAST_INTERVAL_MS = 5000;
export const BOARD_POLL_FAILURES_BEFORE_NOTICE = 3;
export const CONVERSATION_POLL_INTERVAL_MS = 15000;
export const CONVERSATION_POLL_ASSISTANT_PENDING_MS = 3000;

export type BoardPollState = "ok" | "reconnecting" | "unavailable";

export function boardPollStateFromFailures(failures: number): BoardPollState {
  return failures >= BOARD_POLL_FAILURES_BEFORE_NOTICE ? "reconnecting" : "ok";
}

export function boardPollIntervalMs(fastPoll: boolean): number {
  return fastPoll ? BOARD_POLL_FAST_INTERVAL_MS : BOARD_POLL_INTERVAL_MS;
}

export function conversationPollIntervalMs(pendingAssistant: boolean): number {
  return pendingAssistant ? CONVERSATION_POLL_ASSISTANT_PENDING_MS : CONVERSATION_POLL_INTERVAL_MS;
}