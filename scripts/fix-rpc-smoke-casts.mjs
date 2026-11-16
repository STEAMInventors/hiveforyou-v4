import { readFileSync, writeFileSync } from "node:fs";

const path = "supabase/tests/database/rpc_smoke_check.sql";
const lines = readFileSync(path, "utf8").split(/\r?\n/);
let n = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!line.includes("pg_temp.smoke_expect_")) continue;
  const m = line.match(
    /^(.*pg_temp\.smoke_expect_(?:ok|refusal)\([^,]+,\s*)(\$q\$.+\$q\$)(\s*)\);$/,
  );
  if (!m) {
    if (line.includes("pg_temp.smoke_expect_") && line.includes("$q$")) {
      console.error("unmatched smoke line", i + 1, line.slice(0, 120));
    }
    continue;
  }
  if (m[1].includes("((") || line.includes(")::text")) continue;
  lines[i] = `${m[1]}(${m[2]})::text${m[3]});`;
  n++;
}
writeFileSync(path, lines.join("\n"));
console.log(`wrapped ${n} smoke PERFORM lines with ::text cast`);