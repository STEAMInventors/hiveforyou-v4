import { describe, expect, it } from "vitest";

import { renderClientInviteEmail, renderProfessionalInviteEmail } from "./invitation-templates";

describe("invitation email templates", () => {
  it("does not include document filenames or body content", () => {
    const client = renderClientInviteEmail({
      professionalName: "Alex Morgan",
      inviteUrl: "https://example.com/invite/abc",
      requestedItemCount: 2,
    });
    expect(client.text).not.toMatch(/\.pdf|statement-\d|figure-\d/i);
    expect(client.html).not.toMatch(/\.pdf|statement-\d|figure-\d/i);

    const pro = renderProfessionalInviteEmail({
      ownerName: "Jordan Lee",
      hiveName: "Maya Chen",
      inviteUrl: "https://example.com/invite/def",
    });
    expect(pro.text).not.toMatch(/\.pdf|sheet-\d|total-/i);
    expect(pro.html).not.toMatch(/\.pdf|sheet-\d|total-/i);
  });
});