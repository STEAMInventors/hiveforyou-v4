import { HiveMark } from "@/components/study/HiveMark";

export type AvatarKind = "client" | "staff" | "assistant";

export type AvatarPerson = {
  id: string;
  name: string;
  kind: AvatarKind;
};

const KIND_CLASS: Record<Exclude<AvatarKind, "assistant">, string> = {
  client: "bg-leaf-wash text-leaf-deep shadow-[inset_0_0_0_1px_var(--avatar-client-ring)]",
  staff: "bg-blue-wash text-blue-deep shadow-[inset_0_0_0_1px_var(--avatar-staff-ring)]",
};

export function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

/** "Ada, Sam and Rowan" — no serial comma. */
export function formatPeopleLine(names: readonly string[]): string {
  const clean = names.map((name) => name.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0]!;
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
}

/** xs 22 (tabs) · sm 24 (rows) · chat 28 (beside messages) · md 30 · bar 32 (Ask bar) · head 40 (chat header) · lg 44 */
export type AvatarSize = "xs" | "sm" | "chat" | "md" | "bar" | "head" | "lg";

const BOX_CLASS: Record<AvatarSize, string> = {
  xs: "h-[22px] w-[22px] text-[9.5px]",
  sm: "h-6 w-6 text-[10px]",
  chat: "h-7 w-7 text-[11px]",
  md: "h-[30px] w-[30px] text-[11.5px]",
  bar: "h-8 w-8 text-[12px]",
  head: "h-10 w-10 text-[14px]",
  lg: "h-11 w-11 text-[15px]",
};

const MARK_CLASS: Record<AvatarSize, string> = {
  xs: "h-[11px] w-2.5",
  sm: "h-3 w-2.5",
  chat: "h-[14px] w-3",
  md: "h-4 w-3",
  bar: "h-[17px] w-[14px]",
  head: "h-5 w-[18px]",
  lg: "h-5 w-4",
};

export function Avatar({
  person,
  size = "md",
}: {
  person: AvatarPerson;
  size?: AvatarSize;
}) {
  const box = BOX_CLASS[size];
  if (person.kind === "assistant") {
    // The mark on a white circle with a line-strong ring, everywhere (DESIGN: Ask chat, Avatar).
    return (
      <span
        className={`grid shrink-0 place-items-center rounded-full bg-paper text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] ${box}`}
        title={person.name}
        data-avatar="assistant"
        aria-hidden
      >
        <HiveMark className={MARK_CLASS[size]} />
      </span>
    );
  }
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-semibold ${box} ${KIND_CLASS[person.kind]}`}
      title={person.name}
      aria-hidden
    >
      {personInitials(person.name)}
    </span>
  );
}

export function AvatarStack({ people }: { people: readonly AvatarPerson[] }) {
  if (people.length === 0) return null;
  return (
    <span className="inline-flex" data-testid="avatar-stack">
      {people.map((person, index) => (
        <span key={person.id} className={index === 0 ? "rounded-full shadow-[0_0_0_2px_var(--paper)]" : "-ml-1.5 rounded-full shadow-[0_0_0_2px_var(--paper)]"}>
          <Avatar person={person} />
        </span>
      ))}
    </span>
  );
}
