import fs from "fs";
import path from "path";

const migDir = path.resolve("supabase/migrations");
const outPath = path.join(migDir, "20261115160000_hive_write_gates_and_list_docs.sql");

const ownerGate = (extraNullCheck) => `${extraNullCheck ? extraNullCheck + "\n\n" : ""}  v_uid := hive.require_owned_hive(p_hive_id);

  PERFORM 1
     FROM hive.hives h
    WHERE h.id = p_hive_id
      AND h.archived_at IS NULL
      AND h.deleting_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hive_not_found' USING ERRCODE = 'P0002';
  END IF;`;

const writes = [
  {
    file: "20261105220000_v5_pgtap_product_fixes.sql",
    marker: "CREATE OR REPLACE FUNCTION public.start_study_preparation",
    replace:
      /IF v_uid IS NULL THEN[\s\S]*?IF NOT FOUND THEN\s+RAISE EXCEPTION 'hive_not_found'[\s\S]*?END IF;/,
    neu: ownerGate(
      `  IF p_request_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;`,
    ),
  },
  {
    file: "20261104120000_rebuild_study.sql",
    marker: "CREATE OR REPLACE FUNCTION public.rebuild_study",
    replace:
      /IF v_uid IS NULL THEN[\s\S]*?IF NOT FOUND THEN\s+RAISE EXCEPTION 'hive_not_found'[\s\S]*?END IF;/,
    neu: ownerGate(
      `  IF p_request_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;`,
    ),
  },
  {
    file: "20261105173000_v5_workflow_part_a.sql",
    marker: "CREATE OR REPLACE FUNCTION public.acknowledge_study_coverage",
    replace:
      /IF v_uid IS NULL THEN[\s\S]*?IF NOT FOUND THEN\s+RAISE EXCEPTION 'hive_not_found'[\s\S]*?END IF;/,
    neu: ownerGate(""),
  },
  {
    file: "20261102120000_add_intent_intelligence_stage.sql",
    marker: "CREATE OR REPLACE FUNCTION public.create_intent_request",
    replace:
      /IF NOT EXISTS \(\s*SELECT 1 FROM hive\.hives h[\s\S]*?RAISE EXCEPTION 'hive_not_found'[\s\S]*?END IF;/,
    neu: `  v_uid := hive.require_owned_hive(p_hive_id);`,
  },
];

function extractFunction(sql, marker) {
  const start = sql.indexOf(marker);
  if (start < 0) throw new Error(`missing ${marker}`);
  const m = sql.slice(start).match(/^[\s\S]*?END;\s*\$\$;/);
  if (!m) throw new Error(`no end for ${marker}`);
  return m[0];
}

let out = `-- FL-5: member read fixes and owner-only write gates on study/intent RPCs.
BEGIN;

`;

for (const w of writes) {
  const sql = fs.readFileSync(path.join(migDir, w.file), "utf8");
  let fn = extractFunction(sql, w.marker);
  if (!w.replace.test(fn)) throw new Error(`replace miss ${w.marker}`);
  fn = fn.replace(w.replace, w.neu);
  out += `${fn}\n\n`;
}

const src151200 = fs.readFileSync(
  path.join(migDir, "20261115120000_hive_membership_and_invitations.sql"),
  "utf8",
);
let listFn = extractFunction(src151200, "CREATE OR REPLACE FUNCTION public.list_hive_source_documents");
listFn = listFn.replace(
  "v_owner := hive.require_hive_member(p_hive_id);",
  `PERFORM hive.require_hive_member(p_hive_id);
  SELECT h.owner_user_id INTO v_owner
    FROM hive.hives h
   WHERE h.id = p_hive_id AND h.archived_at IS NULL;`,
);
out += `${listFn}\n\n`;

out += `CREATE OR REPLACE FUNCTION public.leave_hive(p_hive_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hive, public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hive_owner uuid;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  PERFORM hive.require_hive_member(p_hive_id);
  SELECT h.owner_user_id INTO v_hive_owner FROM hive.hives h WHERE h.id = p_hive_id;
  SELECT m.role
    INTO v_role
    FROM hive.hive_members m
   WHERE m.hive_id = p_hive_id AND m.user_id = v_uid AND m.state = 'active';
  IF v_role = 'owner' THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;
  UPDATE hive.hive_members
     SET state = 'left', updated_at = now()
   WHERE hive_id = p_hive_id AND user_id = v_uid;
  PERFORM hive.write_membership_audit(
    p_hive_id, v_hive_owner, 'member_left',
    jsonb_build_object('userId', v_uid)
  );
END;
$$;

COMMIT;
`;

fs.writeFileSync(outPath, out);
console.log("wrote", outPath, out.length);