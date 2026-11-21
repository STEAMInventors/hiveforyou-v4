export function filledAuthButtons(): HTMLElement[] {
  return [...document.querySelectorAll("button"), ...document.querySelectorAll("a")].filter((el) =>
    el.className.includes("bg-blue-deep"),
  );
}