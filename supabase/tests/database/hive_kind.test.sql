BEGIN;

SELECT plan(8);

SELECT throws_ok(
  $$SELECT public.set_hive_kind('550e8400-e29b-41d4-a716-446655440000', 'own')$$,
  '42501',
  NULL,
  'anonymous set_hive_kind is refused'
);

SELECT tests.authenticate_as('aaaaaaaa-0000-4000-8000-000000000001');

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

SELECT tests.authenticate_as('bbbbbbbb-0000-4000-8000-000000000002');

SELECT throws_ok(
  $$SELECT public.set_hive_kind(
    (public.get_hive_by_client_request_id('22222222-2222-4222-8222-222222222222')->>'id')::uuid,
    'own'
  )$$,
  '42501',
  NULL,
  'non-owner set_hive_kind is refused'
);

SELECT * FROM finish();
ROLLBACK;