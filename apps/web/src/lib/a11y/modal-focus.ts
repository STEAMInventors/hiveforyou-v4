const FOCUSABLE_SELECTOR = "a[href], button, textarea, input, select, [tabindex]";

/** Focusable controls within a modal overlay (excludes `tabindex="-1"` containers). */
export function listFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((node) => {
    if (node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true") {
      return false;
    }
    if (node.hasAttribute("tabindex") && node.tabIndex === -1) {
      return false;
    }
    if (node.tagName === "A" && !node.getAttribute("href")) {
      return false;
    }
    return true;
  });
}

export function handleModalTabKeyDown(event: KeyboardEvent, container: HTMLElement | null): void {
  if (event.key !== "Tab" || !container) {
    return;
  }

  const focusable = listFocusableElements(container);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }

  if (focusable.length === 1) {
    event.preventDefault();
    focusable[0]?.focus();
    return;
  }

  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  if (event.shiftKey) {
    if (!active || !container.contains(active) || active === first) {
      event.preventDefault();
      last.focus();
    }
    return;
  }

  if (!active || !container.contains(active) || active === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Return focus to the control that opened the modal when it is still mounted. */
export function safeReturnFocus(element: HTMLElement | null | undefined): void {
  if (element?.isConnected) {
    element.focus();
  }
}
