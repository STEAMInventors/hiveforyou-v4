-- FL-8c: read-only verification for service_role hive grants (SQL editor safe, SELECTs only).

SELECT has_table_privilege('service_role', 'hive.firms', 'SELECT') AS firms_select;
SELECT has_table_privilege('service_role', 'hive.firm_members', 'SELECT') AS firm_members_select;
SELECT has_table_privilege('service_role', 'hive.hives', 'SELECT') AS hives_select;

SELECT has_table_privilege('service_role', 'hive.assistant_runs', 'SELECT') AS assistant_runs_select;
SELECT has_table_privilege('service_role', 'hive.assistant_runs', 'INSERT') AS assistant_runs_insert;
SELECT has_table_privilege('service_role', 'hive.assistant_runs', 'UPDATE') AS assistant_runs_update;