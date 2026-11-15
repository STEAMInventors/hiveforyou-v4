# HiveForYou V4 — Security checklist F-028 (FL-5)

| Control | Proof |
| --- | --- |
| Only active hive members read hive-owned rows via RLS | `supabase/migrations/20261115130000_hive_membership_rls.sql`; pgTAP `hive_membership.test.sql` (expand with member/non-member cases when DB available) |
| Removed members lose access immediately | `hive.is_hive_member` requires `state = 'active'`; RLS uses helper |
| Hive delete owner-only | `public.begin_hive_deletion` uses `hive.is_hive_owner` |
| Invitations owner-only | `public.create_invitation` → `hive.require_hive_owner`; web `POST .../invitations` maps `access_denied` |
| Clients/professionals cannot invite | RPC owner gate; no member path to `create_invitation` |
| Token stored as SHA-256 hash only | `hive.hive_invitations.token_hash`; web `generateInviteToken` / `hashInviteToken` |
| One open invite per hive+email | partial unique index `uq_hive_invitations__open_per_email` |
| Accept requires auth email match | `public.accept_invitation` raises `invitation_email_mismatch` |
| Used/expired/revoked tokens refused | `accept_invitation` + `lookup_invitation` status paths; `InviteAcceptPanel` invalid states |
| Invitation emails exclude document content | `apps/web/src/server/email/invitation-templates.test.ts` |
| Membership RPCs write audit rows | `hive.write_membership_audit` on create/accept/revoke/remove/leave/kind |
| Professional read-only until FL-7 | `hive_members.role = 'professional'`, `state = 'active'` on accept; take/decline deferred to FL-7 UI |