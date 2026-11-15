export type ClientsHomeView = "all" | "needs" | "ready" | "own";

export function parseClientsHomeView(value: string | undefined): ClientsHomeView {
  if (value === "needs" || value === "ready" || value === "own") {
    return value;
  }
  return "all";
}

export function clientsHomeViewTitle(view: ClientsHomeView, searchQuery: string): string {
  const q = searchQuery.trim();
  if (q) {
    return `Clients matching “${q}”`;
  }
  switch (view) {
    case "needs":
      return "Needs you";
    case "ready":
      return "Ready";
    case "own":
      return "My own matters";
    default:
      return "All clients";
  }
}