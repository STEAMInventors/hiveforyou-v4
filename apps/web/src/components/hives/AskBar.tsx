"use client";

import { Avatar } from "@/components/ui/AvatarStack";
import { useHiveChat } from "@/lib/hive-chat-context";

/**
 * Home under 1100px (staff and own hive): fixed at the bottom centre, opens the chat sheet.
 * Hidden when the assistant is off for the hive.
 */
export function AskBar() {
  const chat = useHiveChat();
  if (!chat || !chat.assistantOn) return null;
  const name = chat.config.assistantName;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
      <button
        type="button"
        data-testid="ask-bar"
        onClick={() => chat.openChat()}
        className="pointer-events-auto flex h-[54px] w-[min(560px,calc(100vw-32px))] cursor-pointer items-center gap-3 rounded-[16px] border border-line-strong bg-paper px-3.5 text-left text-[14.5px] text-ink-2 shadow-pop hover:border-ink-3"
      >
        <Avatar person={{ id: "ai", name, kind: "assistant" }} size="bar" />
        <span className="min-w-0 truncate">
          <b className="font-semibold text-ink">Ask {name}</b> about these documents
        </span>
      </button>
    </div>
  );
}
