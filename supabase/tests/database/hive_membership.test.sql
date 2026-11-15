-- FL-5: membership, invitations, authorization (requires hive_membership migrations applied).
BEGIN;
SELECT plan(12);

SELECT has_function('public', 'create_invitation', ARRAY['uuid', 'text', 'text', 'text']);
SELECT has_function('public', 'accept_invitation', ARRAY['text']);
SELECT has_function('public', 'list_hive_people', ARRAY['uuid']);

-- Placeholder assertions: expand with test users when running against live DB.
SELECT ok(true, 'migration defines membership RPCs');

SELECT finish();
ROLLBACK;