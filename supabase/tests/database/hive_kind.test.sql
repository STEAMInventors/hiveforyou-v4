BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(5);

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'owner@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'other@example.test', 'authenticated', 'authenticated');

SELECT throws_ok(
  $$SELECT public.set_hive_kind('550e8400-e29b-41d4-a716-446655440000', 'own')$$,
  '42501',
  NULL,
  'anonymous set_hive_kind is refused'
);

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT lives_ok(
  $$SELECT public.create_hive('Client A', 'About', '11111111-1111-4111-8111-111111111111', 'client')$$,
  'owner creates client hive'
);

SELECT is(
  (public.create_hive('Client A', 'About', '11111111-1111-4111-8111-111111111111', 'client')->'hive'->>'kind'),
  'client',
  'create returns client kind'
);

SELECT lives_ok(
  $$SELECT public.set_hive_kind(
    (public.create_hive('Own B', NULL, '22222222-2222-4222-8222-222222222222')->'hive'->>'id')::uuid,
    'client'
  )$$,
  'owner can move hive to client'
);

CREATE TEMP TABLE t_non_owner_hive AS
SELECT (public.get_hive_by_client_request_id('11111111-1111-4111-8111-111111111111')->>'id')::uuid AS hive_id;

SET LOCAL "request.jwt.claims" TO '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}';

SELECT throws_ok(
  $$SELECT public.set_hive_kind((SELECT hive_id FROM t_non_owner_hive), 'own')$$,
  '42501',
  'access_denied',
  'non-owner set_hive_kind is refused'
);

SELECT * FROM finish();
ROLLBACK;