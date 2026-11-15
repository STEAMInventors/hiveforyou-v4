-- FL-1 user profile RPCs and RLS (synthetic identities only).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(8);

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'owner@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'other@example.test', 'authenticated', 'authenticated');

-- Anonymous callers cannot read or write profiles.
SELECT throws_ok(
  $$SELECT public.get_my_profile()$$,
  '42501',
  NULL,
  'anonymous get_my_profile is refused'
);

SELECT throws_ok(
  $$SELECT public.set_starting_view('own')$$,
  '42501',
  NULL,
  'anonymous set_starting_view is refused'
);

SET LOCAL role authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(public.get_my_profile(), NULL, 'owner without profile returns null');

SELECT lives_ok(
  $$SELECT public.set_starting_view('own')$$,
  'owner can set starting view'
);

SELECT is(
  public.get_my_profile()->>'startingView',
  'own',
  'get_my_profile returns saved starting view'
);

SELECT lives_ok(
  $$SELECT public.set_starting_view('clients')$$,
  'owner can switch starting view'
);

SELECT is(
  public.get_my_profile()->>'startingView',
  'clients',
  'updated starting view is returned'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000002","role":"authenticated"}';

SELECT throws_ok(
  $$UPDATE hive.user_profiles SET starting_view = 'own' WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  '42501',
  NULL,
  'direct update of another user profile is refused by RLS'
);

SELECT throws_ok(
  $$INSERT INTO hive.user_profiles (user_id, starting_view)
    VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'own')$$,
  '42501',
  NULL,
  'direct insert into another user profile is refused by RLS'
);

SELECT * FROM finish();
ROLLBACK;