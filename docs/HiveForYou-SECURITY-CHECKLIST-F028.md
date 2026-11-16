# HiveForYou V4 — Security checklist F-028 (FL-5)

Proof for each RLS and membership row is `supabase/tests/database/hive_membership_check.sql` (paste into the Supabase SQL editor; expect `ALL CHECKS PASSED`, then `ROLLBACK`).

| Control | Code | Proof in `hive_membership_check.sql` |
| --- | --- | --- |
| Only active hive members read hive-owned rows | `supabase/migrations/20261115130000_hive_membership_rls.sql`. SELECT policies use `hive.is_hive_member` (`state = 'active'`) on `hive_members`, `hives`, `intent_requests`, `cases`, `source_documents`, `upload_operations`, `audit_events`, `document_pages`, `document_reads`, `processing_runs`, `study_prompt_previews`, `coverage_acknowledgements`, `canonical_studies`, `study_revisions`, `report_runs`, `reports`, `doc_extractions`, `doc_extraction_ranges`, `doc_extraction_attempts`. `hives` update and `intent_requests` insert stay owner-only | Client reads `source_documents`, `study_revisions`, `reports`, `audit_events`, and `hive_members`. A non-member `list_hives` is empty and `get_hive` fails |
| Pending professionals cannot read the hive | `supabase/migrations/20261115140000_hive_access_by_role.sql`: `accept_invitation` sets a professional to `state = 'pending'`. `hive.is_hive_member` is active only, so pending professionals fail member reads and member RPCs. `list_hives` labels that row `invited` | Accept returns `memberState = pending`. Pending `source_documents`, `study_revisions`, `reports`, and `storage.objects` counts are 0. `list_hive_source_documents`, `get_study_preparation`, and `get_hive_reports` fail |
| `hive_members` select grant | `supabase/migrations/20261115170000_hive_members_select_grant.sql`: `GRANT SELECT ON hive.hive_members TO authenticated`. `pol_hive_members__select` still limits rows to active members of that hive | Client `hive_members` count is at least 2 |
| Source storage: active members read, owner writes | `supabase/migrations/20261115150000_hive_source_storage_rls.sql` on `storage.objects` for bucket `hive-source-documents`: `hive_source_documents_select_member` (`is_hive_member`); `hive_source_documents_insert_owner`, `hive_source_documents_update_owner`, and `hive_source_documents_delete_owner` (`is_hive_owner`; insert also requires the path's owner-id prefix) | Client `storage.objects` count is at least 1. Pending professional count is 0 |
| Owner-only write gates | `hive.require_owned_hive` on `start_study_preparation`, `rebuild_study`, `acknowledge_study_coverage`, and `create_intent_request` (`20261115160000_hive_write_gates_and_list_docs.sql`) and on `start_document_reads` (`20261115150000_hive_source_storage_rls.sql`). `set_hive_kind` uses `hive.require_hive_owner`. `begin_hive_deletion` uses `hive.is_hive_owner` | Client and pending professional `start_study_preparation`, `create_intent_request`, and `start_document_reads` fail. Client `rebuild_study`, `set_hive_kind`, and `begin_hive_deletion` fail. Owner `create_intent_request` succeeds |
| Removed members lose access immediately | `hive.is_hive_member` requires `state = 'active'` | Same active-member reads. A pending professional, who is not active, sees no source, study, report, or storage rows |
| Hive delete owner-only | `public.begin_hive_deletion` uses `hive.is_hive_owner` | Client `begin_hive_deletion` fails |
| Invitations owner-only | `public.create_invitation` → `hive.require_hive_owner`; web `POST .../invitations` maps `access_denied` | Client `create_invitation` fails. Owner cannot invite their own email or an email that already belongs to an active or pending member |
| Clients and professionals cannot invite | RPC owner gate; no member path to `create_invitation` | Client `create_invitation` fails |
| Token stored as SHA-256 hash only | `hive.hive_invitations.token_hash`; web `generateInviteToken` / `hashInviteToken` | Column and web hasher; the check accepts by `token_hash` |
| One open invite per hive and email | partial unique index `uq_hive_invitations__open_per_email` | Owner `create_invitation` for the client's already-open email is refused |
| Accept requires the signed-in email | `public.accept_invitation` raises `invitation_email_mismatch` | RPC; the check accepts only as the invited user |
| Used, expired, and revoked tokens are refused | `accept_invitation` and `lookup_invitation` status paths; `InviteAcceptPanel` invalid states | RPC and invite page; the check does not exercise those three statuses |
| Invitation emails exclude document content | `apps/web/src/server/email/invitation-templates.test.ts` | Web template test |
| Membership RPCs write audit rows | `hive.write_membership_audit` on create, accept, revoke, remove, leave, and kind change | Function bodies; the check does not assert audit contents |
| A failed invitation send does not leave an open invite | web `POST .../invitations` revokes the row it just created and returns "We couldn't send the invitation. Try again." Send again on an open invitation revokes it, then creates and sends a new one | `apps/web/src/app/api/v1/hives/[hiveId]/invitations/route.test.ts` and `apps/web/src/components/hives/HiveBoardPeople.test.tsx` |

`hive.hive_invitations` has row level security enabled and forced in `20261115130000_hive_membership_rls.sql` and no SELECT policy. Invitation reads and writes go through the SECURITY DEFINER RPCs. The check still selects `hive.hive_invitations` directly as the client.

## FL-11 firm membership

Proof: `supabase/tests/database/firm_membership_check.sql` (paste into the Supabase SQL editor; expect `ALL CHECKS PASSED`, then `ROLLBACK`).

| Control | Code | Proof |
| --- | --- | --- |
| Firm tables: authenticated `SELECT` only (RLS limits rows) | `20261115200000_firms_and_assignment.sql` grants `SELECT` on `hive.firms`, `hive.hive_handovers`, `hive.team_notes`; column-level `SELECT` on `hive.firm_members` excludes `token_hash` | Owner and member read firm rows; direct `SELECT token_hash` fails; invited-row `token_hash` filter fails |
| Firm writes via SECURITY DEFINER RPCs only | No `INSERT`/`UPDATE`/`DELETE` table grants; handover and team-note insert policies removed | Member direct `INSERT` on `hive.team_notes` fails |
| Firm invitation tokens not readable from the table | `token_hash` omitted from the `authenticated` column grant; `lookup_firm_invitation` / `accept_firm_invitation` RPCs | Check blocks direct `token_hash` reads and asserts lookup JSON has no `token_hash` |
| Firm staff hive access | `hive.is_firm_staff`, `list_hives` union, `get_hive` via `hive.is_hive_member` | Member sees firm client hive, assigns, adds team note; stranger denied |
| Firm invites owner-only | `invite_firm_member` owner role gate | Member `invite_firm_member` fails in check |
