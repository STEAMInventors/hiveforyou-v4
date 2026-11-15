-- FL-1 / FL-3c user profile RPCs, display_name, and RLS (synthetic identities only).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(16);

INSERT INTO auth.users (id, email, aud, role)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'owner@example.test', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'other@example.test', 'authenticated', 'authenticated');

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

SELECT throws_ok(
  $$SELECT public.set_display_name('Sam')$$,
  '42501',
  NULL,
  'anonymous set_display_name is refused'
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

SELECT throws_ok(
  $$SELECT public.set_display_name('')$$,
  '22023',
  NULL,
  'empty display name is refused'
);

SELECT throws_ok(
  $$SELECT public.set_display_name(repeat('x', 61))$$,
  '22023',
  NULL,
  'overlong display name is refused'
);

SELECT lives_ok(
  $$SELECT public.set_display_name('  Dana  ')$$,
  'owner can set display name after profile exists'
);

SELECT is(
  public.get_my_profile()->>'displayName',
  'Dana',
  'get_my_profile returns trimmed display name'
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

SELECT lives_ok(
  $$SELECT public.set_starting_view('own')$$,
  'other user can create own profile'
);

SELECT lives_ok(
  $$SELECT public.set_display_name('Other')$$,
  'other user can set own display name'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  public.get_my_profile()->>'displayName',
  'Dana',
  'set_display_name only updates the authenticated user'
);

SELECT * FROM finish();
ROLLBACK;