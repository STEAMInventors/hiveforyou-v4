export type ClientsHomeView = "all" | "needs" | "ready" | "own" | "mine" | "unassigned";

export function parseClientsHomeView(value: string | undefined): ClientsHomeView {
  if (value === "needs" || value === "ready" || value === "own" || value === "mine" || value === "unassigned") {
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
    case "mine":
      return "Mine";
    case "unassigned":
      return "Unassigned";
    default:
      return "All clients";
  }
}