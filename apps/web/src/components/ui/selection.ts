/** Left-menu row. The current page is a Cell Blue wash with accessible deep-blue type. */
export const MENU_ITEM_CLASS =
  "flex h-[38px] w-full items-center gap-2.5 rounded-[9px] border-0 bg-transparent px-2.5 text-left text-small font-medium text-ink-2 no-underline hover:bg-hover hover:text-ink aria-[current=page]:bg-blue-wash aria-[current=page]:font-semibold aria-[current=page]:text-blue-deep";

export function menuIconClass(active: boolean): string {
  return active ? "shrink-0 text-blue-deep" : "shrink-0 text-ink-3";
}

/** Active tab indicator is Cell Blue. The label stays ink. */
export const TAB_SELECTED = "border-blue font-semibold text-ink";
export const TAB_IDLE = "border-transparent font-medium text-ink-3 hover:text-ink";

/** Segmented control: white pill, Cell Blue edge and deep-blue label when selected. */
export const SEGMENTED_ON =
  "bg-paper font-semibold text-blue-deep shadow-[0_1px_2px_rgba(20,30,50,0.08),0_0_0_1px_var(--color-blue)]";

/** Text fields: Cell Blue border and the shared focus ring. */
export const FIELD_FOCUS =
  "outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-blue focus:shadow-focus";
