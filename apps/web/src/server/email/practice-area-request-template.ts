export type PracticeAreaRequestEmailInput = {
  firmName: string;
  requesterEmail: string;
  body: string;
};

export function renderPracticeAreaRequestEmail(
  input: PracticeAreaRequestEmailInput,
): { subject: string; text: string; html: string } {
  const subject = "Practice area request";
  const text = [
    "A professional asked HiveForYou to cover a practice area.",
    "",
    `Firm: ${input.firmName}`,
    `From: ${input.requesterEmail}`,
    "",
    input.body,
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1a1a1a">
<p style="font-size:15px;line-height:1.55">A professional asked HiveForYou to cover a practice area.</p>
<p style="font-size:14px"><strong>Firm:</strong> ${escapeHtml(input.firmName)}<br/>
<strong>From:</strong> ${escapeHtml(input.requesterEmail)}</p>
<p style="font-size:14px;white-space:pre-wrap">${escapeHtml(input.body)}</p>
</body></html>`;
  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}