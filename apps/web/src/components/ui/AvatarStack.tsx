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

export function Avatar({
  person,
  size = "md",
}: {
  person: AvatarPerson;
  size?: "sm" | "md" | "lg";
}) {
  const box = size === "lg" ? "h-11 w-11 text-[15px]" : size === "sm" ? "h-6 w-6 text-[10px]" : "h-[30px] w-[30px] text-[11.5px]";
  if (person.kind === "assistant") {
    return (
      <span
        className={`grid shrink-0 place-items-center rounded-full bg-ink text-paper ${box}`}
        title={person.name}
        aria-hidden
      >
        <HiveMark className={size === "lg" ? "h-5 w-4" : size === "sm" ? "h-3 w-2.5" : "h-4 w-3"} />
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
