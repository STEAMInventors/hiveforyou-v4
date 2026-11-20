import fs from "node:fs";
import path from "node:path";

const root = path.resolve("src");
const exts = new Set([".ts", ".tsx", ".css"]);

const pairs = [
  ["text-ink-muted", "text-ink-2"],
  ["text-ink-subtle", "text-ink-3"],
  ["text-graphite", "text-ink-2"],
  ["text-quiet", "text-ink-3"],
  ["text-glance", "text-state"],
  ["bg-canvas", "bg-mist"],
  ["group-hover:bg-canvas", "group-hover:bg-[#FAFBFC]"],
  ["hover:bg-canvas", "hover:bg-[#FAFBFC]"],
  ["bg-cell-blue-deep", "bg-blue-deep"],
  ["bg-cell-blue-hover", "bg-blue-press"],
  ["bg-cell-blue-wash", "bg-blue-wash"],
  ["bg-cell-blue-tint", "bg-blue-wash"],
  ["text-cell-blue-deep", "text-blue-deep"],
  ["text-cell-blue", "text-blue"],
  ["hover:text-cell-blue", "hover:text-blue"],
  ["border-cell-blue", "border-blue"],
  ["hover:border-cell-blue-wash", "hover:border-blue-wash"],
  ["hover:bg-cell-blue-tint", "hover:bg-blue-wash"],
  ["rounded-card", "rounded-input"],
  ["rounded-composer", "rounded-input"],
  ["max-w-workspace", "max-w-col-wide"],
  ["max-w-hive", "max-w-col-wide"],
  ["bg-surface-hover", "bg-[#FAFBFC]"],
  ["text-ink-muted", "text-ink-2"],
  ["border-quiet", "border-ink-3"],
  ["decoration-quiet", "decoration-ink-3"],
  ["accent-cell-blue-deep", "accent-blue-deep"],
  ["focus:ring-cell-blue", "focus:ring-blue"],
  ["ring-cell-blue-deep", "ring-blue-deep"],
  ["fill-cell-blue", "fill-blue"],
  ["stroke-cell-blue", "stroke-blue"],
  ["bg-cell-blue", "bg-blue"],
];

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(full, out);
    } else if (exts.has(path.extname(name))) {
      out.push(full);
    }
  }
}

const files = [];
walk(root, files);
let changed = 0;
for (const file of files) {
  let text = fs.readFileSync(file, "utf8");
  const original = text;
  for (const [from, to] of pairs) {
    text = text.split(from).join(to);
  }
  if (text !== original) {
    fs.writeFileSync(file, text);
    changed += 1;
  }
}
console.log(`Updated ${changed} files under apps/web/src`);