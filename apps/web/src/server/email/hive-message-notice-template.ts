const LOGO_URL = "https://hiveforyou.com/brand/hiveforyou-mark.svg";

export const HIVE_MESSAGE_NOTICE_SUBJECT = "New message in your hive";

export type HiveMessageNoticeInput = {
  hiveName: string;
  conversationUrl: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Names the hive only. Never the message, the sender's words or anything from a document. */
export function renderHiveMessageNoticeEmail(input: HiveMessageNoticeInput): {
  subject: string;
  text: string;
  html: string;
} {
  const line = `There's a new message in ${input.hiveName}.`;
  const text = [line, "", `Open the conversation: ${input.conversationUrl}`].join("\n");
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1a1a1a">
<img src="${LOGO_URL}" alt="HiveForYou" width="40" height="40" />
<p style="font-size:16px;line-height:1.5">${escapeHtml(line)}</p>
<p><a href="${escapeHtml(input.conversationUrl)}" style="display:inline-block;background:#1A56C4;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open the conversation</a></p>
</body></html>`;
  return { subject: HIVE_MESSAGE_NOTICE_SUBJECT, text, html };
}
