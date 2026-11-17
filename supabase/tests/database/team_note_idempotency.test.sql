BEGIN;
SELECT plan(4);

SELECT has_function(
  'public',
  'add_team_note',
  ARRAY['uuid', 'text', 'text', 'uuid'],
  'add_team_note accepts client_request_id'
);

SELECT finish();
ROLLBACK;