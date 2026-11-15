import fs from "fs";
import path from "path";

const migDir = path.resolve("supabase/migrations");
const outPath = path.join(migDir, "20261115140000_hive_access_by_role.sql");

const readSpecs = [
  {
    from: "CREATE OR REPLACE FUNCTION public.get_hive_reports",
    file: "20261102150000_analysis_workflow.sql",
    replace: [{ old: "PERFORM hive.require_owned_hive(p_hive_id);", neu: "PERFORM hive.require_hive_member(p_hive_id);" }],
  },
  {
    from: "CREATE OR REPLACE FUNCTION public.get_hive_report",
    file: "20261102150000_analysis_workflow.sql",
    replace: [{ old: "PERFORM hive.require_owned_hive(p_hive_id);", neu: "PERFORM hive.require_hive_member(p_hive_id);" }],
  },
  {
    from: "CREATE OR REPLACE FUNCTION public.get_study_preparation",
    file: "20261102180000_resumable_analyze_and_report_reuse.sql",
    ownerBlock: true,
  },
  {
    from: "CREATE OR REPLACE FUNCTION public.list_document_reads",
    file: "20261101200000_create_document_reads.sql",
    ownerBlock: true,
  },
  {
    from: "CREATE OR REPLACE FUNCTION public.get_failure_diagnostics",
    file: "20261102170000_failure_diagnostics.sql",
    ownerBlock: true,
  },
  {
    from: "CREATE OR REPLACE FUNCTION public.get_study_tab_view",
    file: "20261106140000_get_study_tab_view.sql",
    ownerBlock: true,
  },
  {
    from: "CREATE OR REPLACE FUNCTION public.get_study_tab_view_definer",
    file: "20261106140000_get_study_tab_view.sql",
    replace: [
      {
        old: "v_uid := hive.require_owned_hive(p_hive_id);",
        neu: "v_uid := auth.uid();\n  PERFORM hive.require_hive_member(p_hive_id);",
      },
    ],
  },
];

const ownerBlockRe =
  /IF NOT EXISTS \(\s*SELECT 1 FROM hive\.hives h[\s\S]*?RAISE EXCEPTION 'hive_not_found'[\s\S]*?END IF;/;

function extractFunction(sql, fromMarker) {
  const start = sql.indexOf(fromMarker);
  if (start < 0) throw new Error(`missing ${fromMarker}`);
  const m = sql.slice(start).match(/^[\s\S]*?END;\s*\$\$;/);
  if (!m) throw new Error(`no end for ${fromMarker}`);
  return m[0];
}

const header = `-- FL-5: owner-only writes (require_owned_hive), active-member reads, pending professionals.
BEGIN;

ALTER TABLE hive.hive_members DROP CONSTRAINT IF EXISTS ck_hive_members__state;
ALTER TABLE hive.hive_members
  ADD CONSTRAINT ck_hive_members__state CHECK (state IN ('active', 'left', 'removed', 'pending'));

CREATE OR REPLACE FUNCTION hive.require_owned_hive(p_hive_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF p_hive_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request:hive_id_required' USING ERRCODE = '22023';
  END IF;
  IF NOT hive.is_hive_owner(p_hive_id) THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_uid;
END;
$$;

`;

const patches = [];
for (const spec of readSpecs) {
  const sql = fs.readFileSync(path.join(migDir, spec.file), "utf8");
  let fn = extractFunction(sql, spec.from);
  if (spec.ownerBlock) {
    fn = fn.replace(ownerBlockRe, "PERFORM hive.require_hive_member(p_hive_id);");
  }
  for (const { old, neu } of spec.replace ?? []) {
    if (!fn.includes(old)) throw new Error(`missing line in ${spec.from}: ${old.slice(0, 50)}`);
    fn = fn.replace(old, neu);
  }
  patches.push(fn);
}

const writeSpecs = [
  {
    from: "CREATE OR REPLACE FUNCTION public.start_document_reads",
    file: "20261101200000_create_document_reads.sql",
    performOne: true,
  },
];

const performOneRe =
  /PERFORM 1\s+FROM hive\.hives h[\s\S]*?IF NOT FOUND THEN[\s\S]*?END IF;/;

for (const spec of writeSpecs) {
  const sql = fs.readFileSync(path.join(migDir, spec.file), "utf8");
  let fn = extractFunction(sql, spec.from);
  fn = fn.replace(performOneRe, "v_uid := hive.require_owned_hive(p_hive_id);");
  fn = fn.replace("v_uid uuid := auth.uid();", "v_uid uuid;");
  fn = fn.replace(
    "IF v_uid IS NULL THEN\n    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';\n  END IF;\n  ",
    "",
  );
  patches.push(fn);
}

const storagePath = path.join(migDir, "20261115150000_hive_source_storage_rls.sql");
let storageTail = "";
if (fs.existsSync(storagePath)) {
  storageTail = fs.readFileSync(storagePath, "utf8").replace(/^[\s\S]*?CREATE OR REPLACE FUNCTION public\.start_document_reads[\s\S]*?COMMIT;\n?/m, "");
  if (!storageTail.includes("COMMIT")) {
    storageTail = fs.readFileSync(storagePath, "utf8");
    storageTail = storageTail.replace(/CREATE OR REPLACE FUNCTION public\.start_document_reads[\s\S]*?\$\$;\s*/m, "");
  }
}

fs.writeFileSync(outPath, `${header}${patches.join("\n\n")}\n\nCOMMIT;\n`);
// append owner-only start_document_reads to storage migration
const startRead = patches[patches.length - 1];
if (writeSpecs.length && startRead.includes("start_document_reads")) {
  const storageHeader = storageTail.split("COMMIT;")[0];
  fs.writeFileSync(
    storagePath,
    `${storageHeader.trim()}\n\n${startRead}\n\nCOMMIT;\n`,
  );
}

console.log(`patched ${patches.length} functions into access migration; storage updated`);