-- FL-8c: service_role grants for hive assistant server paths.

BEGIN;

GRANT SELECT ON hive.firms, hive.firm_members, hive.hives TO service_role;
GRANT SELECT, INSERT, UPDATE ON hive.assistant_runs TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA hive GRANT ALL ON TABLES TO service_role;

COMMIT;