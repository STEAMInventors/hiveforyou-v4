import { readFileSync, writeFileSync } from "node:fs";

const path = "supabase/tests/database/rpc_smoke_check.sql";
const lines = readFileSync(path, "utf8").split(/\r?\n/);
let n = 0;

function dollarQuoteLiteral(s) {
  const tag = "fmt";
  return `$${tag}$${s}$${tag}$`;
}

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const open = "($q$";
  const close = "$q$)::text);";
  if (!line.includes("pg_temp.smoke_expect_") || !line.includes(open)) continue;
  const kind = line.includes("smoke_expect_ok") ? "ok" : "refusal";
  const userStart = line.indexOf("(") + 1;
  const userEnd = line.indexOf(",", userStart);
  const user = line.slice(userStart, userEnd).trim();
  const sqlStart = line.indexOf(open) + open.length;
  const sqlEnd = line.indexOf(close, sqlStart);
  if (sqlEnd < 0) {
    console.error("skip line", i + 1);
    continue;
  }
  const indent = line.match(/^\s*/)[0];
  const sql = line.slice(sqlStart, sqlEnd);
  const userArg = user;

  const vars = [];
  const varRe = /\bv_[a-z_][a-z0-9_]*(?:::[a-z]+)?/gi;
  let match;
  const parts = [];
  let last = 0;
  while ((match = varRe.exec(sql)) !== null) {
    parts.push(sql.slice(last, match.index));
    const token = match[0];
    if (token.includes("::")) {
      const [base, cast] = token.split("::");
      parts.push(`%L::${cast}`);
      vars.push(base);
    } else {
      parts.push("%L");
      vars.push(token);
    }
    last = match.index + token.length;
  }
  parts.push(sql.slice(last));
  const fmtSql = parts.join("");

  const formatExpr =
    vars.length === 0
      ? `format(${dollarQuoteLiteral(fmtSql)})`
      : `format(${dollarQuoteLiteral(fmtSql)}, ${vars.join(", ")})`;

  lines[i] = `${indent}PERFORM pg_temp.smoke_expect_${kind}(${userArg}, ${formatExpr});`;
  n++;
}

writeFileSync(path, lines.join("\n"));
console.log(`converted ${n} PERFORM lines to format() for EXECUTE scope`);