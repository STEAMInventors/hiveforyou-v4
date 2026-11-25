import type { HiveMessagePage } from "@hiveforyou/contracts";

export function installGalleryBoardFetch(
  hiveId: string,
  assistantPage: HiveMessagePage,
  extras?: { peoplePage?: HiveMessagePage; people?: unknown },
): () => void {
  const prior = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes(`/api/v1/hives/${hiveId}/people`) && init?.method !== "POST") {
      return new Response(JSON.stringify(extras?.people ?? { people: [], pendingInvitations: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes(`/api/v1/hives/${hiveId}/messages`) && init?.method !== "POST") {
      if (url.includes("channel=assistant") || url.includes("channel%3Dassistant")) {
        return new Response(JSON.stringify({ ok: true, page: assistantPage }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          ok: true,
          page: extras?.peoplePage ?? {
            messages: [],
            participantRoleLabels: [],
            participantCount: 0,
            viewerLastReadAt: null,
            nextCursor: null,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (url.includes(`/api/v1/hives/${hiveId}/messages/read`)) {
      return new Response(JSON.stringify({ lastReadAt: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return prior(input, init);
  };
  return () => {
    globalThis.fetch = prior;
  };
}