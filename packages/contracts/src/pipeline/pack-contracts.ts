/**
 * `hive.pack/2`: versioned domain-pack markdown (packs/*.md). Generic parser only; pack text is data.
 * A file with none of the format-2 sections is valid and loads as brief-only.
 */

import type { CanonicalGapKind } from "./canonical-study-contracts";
import type { GapHolderType } from "./canonical-gap-holders";
import { normalizeGapHolderType } from "./canonical-gap-holders";

export const PACK_SCHEMA = "hive.pack/2";

export const PACK_AUDIENCES = ["customer", "professional"] as const;
export type PackAudience = (typeof PACK_AUDIENCES)[number];

export const PACK_FORMAT2_SECTIONS = [
  "Rules",
  "Personas",
  "Ask the person",
  "Checks",
  "Standing questions",
  "Chains",
  "Computed values",
  "Reference tables",
  "Documents usually needed",
  "Terms",
  "General notes",
  "Customer report",
  "Professional report",
  "Sources",
] as const;

export const PERSONA_TABLE_FIELDS = [
  "Who",
  "Situation",
  "Knows",
  "Does not know",
  "Looking for",
  "Decisions",
  "Useful when",
  "Leave out",
  "Success test",
] as const;
export type PersonaTableField = (typeof PERSONA_TABLE_FIELDS)[number];

export type PackMeta = {
  pack: string;
  version: number;
  title: string;
  description: string;
  matches: { intent: string[]; documents: string[] };
  jurisdiction: string;
  verified: string;
  status: string;
};

export type PackPersonaQuestion = { id: string; text: string };

export type PackPersona = {
  audience: PackAudience;
  who: string;
  situation: string;
  knows: string;
  doesNotKnow: string;
  lookingFor: PackPersonaQuestion[];
  decisions: string;
  usefulWhen: string;
  leaveOut: string;
  successTest: string;
};

export type PackIntakeQuestion = {
  id: string;
  audience: string;
  question: string;
  why: string;
};

export type PackCheck = {
  id: string;
  group: string;
  check: string;
  evidence: string;
  authority: string;
  question: string | null;
};

export type PackStandingQuestion = {
  id: string;
  audience: string;
  askWhen: string;
  question: string;
};

export type PackChain = {
  id: string;
  label: string;
  links: string[];
};

export type PackComputedValue = {
  id: string;
  label: string;
  op: string;
  inputs: string;
  per: string;
};

export type PackReferenceTable = {
  name: string;
  headers: string[];
  rows: string[][];
};

export type PackDocumentExpectation = {
  document: string;
  holder: string;
  holderType: GapHolderType | null;
  when: string;
  gapKind: CanonicalGapKind;
  settlesCheckIds: string[];
};

export type PackTerm = { term: string; plainMeaning: string };

export type PackGeneralNote = { id: string; showWhen: string; text: string };

export type PackReportBlockRef = { name: string; args: string[] };

export type PackReportSection = {
  order: number;
  heading: string;
  blocks: PackReportBlockRef[];
  narrative: string | null;
  questionIds: string[];
  builtFromRaw: string;
};

export type PackReportTemplate = {
  title: string;
  sections: PackReportSection[];
  voice: string;
};

export type Pack = {
  schema: typeof PACK_SCHEMA;
  meta: PackMeta;
  /** True when the file has none of the format-2 sections (legacy / brief body only). */
  briefOnly: boolean;
  rules: string[];
  personas: PackPersona[];
  askThePerson: PackIntakeQuestion[];
  checks: PackCheck[];
  standingQuestions: PackStandingQuestion[];
  chains: PackChain[];
  computedValues: PackComputedValue[];
  referenceTables: PackReferenceTable[];
  documentsUsuallyNeeded: PackDocumentExpectation[];
  terms: PackTerm[];
  generalNotes: PackGeneralNote[];
  customerReport: PackReportTemplate | null;
  professionalReport: PackReportTemplate | null;
  sources: string[];
};

export type PackParse =
  | { ok: true; value: Pack }
  | { ok: false; reason: "pack_front_matter_invalid" | "pack_duplicate_check_id" | "pack_duplicate_persona_question_id"; message: string };

const PERSONA_HEADING: Record<string, PackAudience> = {
  customer: "customer",
  professional: "professional",
};

const splitList = (text: string): string[] =>
  text
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item !== "");

const parseLookingFor = (cell: string): PackPersonaQuestion[] => {
  const out: PackPersonaQuestion[] = [];
  for (const part of splitList(cell)) {
    const match = /^([A-Z]\d+)\s+(.+)$/.exec(part);
    if (match) out.push({ id: match[1], text: match[2] });
    else if (part !== "") out.push({ id: "", text: part });
  }
  return out;
};

const normalizeHeader = (header: string): string => header.trim().toLowerCase().replace(/,.*/, "").trim();

const parseMarkdownTables = (section: string): { headers: string[]; rows: string[][] }[] => {
  const lines = section.split(/\r?\n/);
  const tables: { headers: string[]; rows: string[][] }[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!/^\s*\|/.test(line)) {
      i += 1;
      continue;
    }
    const block: string[] = [];
    while (i < lines.length && /^\s*\|/.test(lines[i])) {
      block.push(lines[i]);
      i += 1;
    }
    if (block.length < 2) continue;
    const parseRow = (row: string): string[] =>
      row
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
    const headers = parseRow(block[0]);
    const separator = block[1];
    const separatorCells = parseRow(separator);
    const isSeparator =
      separatorCells.length > 0 &&
      separatorCells.every((cell) => /^:?-{3,}:?$/.test(cell) || cell === "");
    if (!isSeparator) continue;
    const rows = block.slice(2).map(parseRow).filter((row) => row.some((cell) => cell !== ""));
    tables.push({ headers, rows });
  }
  return tables;
};

const columnIndex = (headers: string[], ...names: string[]): number => {
  const normalized = headers.map(normalizeHeader);
  for (const name of names) {
    const index = normalized.indexOf(name.toLowerCase());
    if (index >= 0) return index;
  }
  return -1;
};

const cell = (row: string[], index: number): string => (index >= 0 && index < row.length ? row[index].trim() : "");

const splitH3Sections = (section: string): { heading: string; body: string }[] => {
  const parts: { heading: string; body: string }[] = [];
  const chunks = section.split(/^###\s+/m);
  if (chunks[0]?.trim() !== "") parts.push({ heading: "", body: chunks[0] ?? "" });
  for (let i = 1; i < chunks.length; i += 1) {
    const chunk = chunks[i] ?? "";
    const newline = chunk.indexOf("\n");
    const heading = newline >= 0 ? chunk.slice(0, newline).trim() : chunk.trim();
    const body = newline >= 0 ? chunk.slice(newline + 1) : "";
    parts.push({ heading, body });
  }
  return parts;
};

const bulletLines = (section: string): string[] =>
  section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());

const parseYamlFrontMatter = (raw: string): Record<string, unknown> | null => {
  const lines = raw.split(/\r?\n/);
  const root: Record<string, unknown> = {};
  const stack: { indent: number; obj: Record<string, unknown> }[] = [{ indent: -1, obj: root }];
  const keyAt = (line: string): { indent: number; key: string; value: string } | null => {
    const match = /^(\s*)([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
    if (!match) return null;
    return { indent: match[1].length, key: match[2], value: match[3].trim() };
  };
  const parseInlineArray = (text: string): string[] | null => {
    if (!text.startsWith("[") || !text.endsWith("]")) return null;
    const inner = text.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((item) => item.trim()).filter((item) => item !== "");
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const parsed = keyAt(line);
    if (parsed) {
      while (stack.length > 1 && parsed.indent <= stack[stack.length - 1].indent) stack.pop();
      const parent = stack[stack.length - 1].obj;
      const inline = parseInlineArray(parsed.value);
      if (inline !== null) {
        parent[parsed.key] = inline;
        continue;
      }
      if (parsed.value === "") {
        const child: Record<string, unknown> = {};
        parent[parsed.key] = child;
        stack.push({ indent: parsed.indent, obj: child });
        continue;
      }
      if (parsed.value === "[]") {
        parent[parsed.key] = [];
        continue;
      }
      parent[parsed.key] = parsed.value;
      continue;
    }
    const listMatch = /^(\s*)-\s+(.+)$/.exec(line);
    if (listMatch) {
      const indent = listMatch[1].length;
      while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
      const parent = stack[stack.length - 1].obj;
      const keys = Object.keys(parent);
      const lastKey = keys[keys.length - 1];
      if (lastKey === undefined) continue;
      const current = parent[lastKey];
      const item = listMatch[2].trim();
      if (Array.isArray(current)) current.push(item);
      else parent[lastKey] = [item];
    }
  }
  return root;
};

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const strings = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((item) => str(item)).filter((item) => item !== "");
  return [];
};

const parseFrontMatter = (raw: Record<string, unknown>): PackMeta | null => {
  const pack = str(raw.pack);
  const versionRaw = raw.version;
  const version =
    typeof versionRaw === "number"
      ? versionRaw
      : typeof versionRaw === "string" && /^\d+$/.test(versionRaw.trim())
        ? Number.parseInt(versionRaw.trim(), 10)
        : Number.NaN;
  const title = str(raw.title);
  if (pack === "" || !Number.isFinite(version) || title === "") return null;
  const matchesRaw = raw.matches;
  const matchesObj = typeof matchesRaw === "object" && matchesRaw !== null && !Array.isArray(matchesRaw) ? (matchesRaw as Record<string, unknown>) : {};
  return {
    pack,
    version,
    title,
    description: str(raw.description),
    matches: { intent: strings(matchesObj.intent), documents: strings(matchesObj.documents) },
    jurisdiction: str(raw.jurisdiction),
    verified: str(raw.verified),
    status: str(raw.status),
  };
};

const extractHolderType = (holder: string): GapHolderType | null => {
  const pieces = holder.split(/\s+or\s+/i);
  for (const piece of pieces) {
    const token = piece.trim().split(/\s+/)[0]?.replace(/[(),]/g, "") ?? "";
    const normalized = normalizeGapHolderType(token);
    if (normalized) return normalized;
  }
  const lead = holder.trim().split(/\s+/)[0]?.replace(/[(),]/g, "") ?? "";
  return normalizeGapHolderType(lead);
};

const classifyDocumentWhen = (when: string): CanonicalGapKind => {
  const lower = when.trim().toLowerCase();
  if (lower.includes("(later)")) return "FUTURE_RECORD";
  if (lower.includes("before signing") || lower.startsWith("if ")) return "REQUESTABLE_DOCUMENT";
  return "REQUESTABLE_DOCUMENT";
};

const parseSettles = (text: string): string[] =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");

const parseBuiltFrom = (
  raw: string,
): Pick<PackReportSection, "blocks" | "narrative" | "questionIds"> => {
  const blocks: PackReportBlockRef[] = [];
  const blockRe = /\bblock\s+([A-Za-z0-9_]+)(?:\s*\(([^)]*)\))?/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(raw)) !== null) {
    const args =
      match[2] === undefined
        ? []
        : match[2]
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item !== "");
    blocks.push({ name: match[1], args });
  }
  let narrative: string | null = null;
  const narrativeMatch = /narrative:\s*([^;]+?)(?=\s*;|\s*block\b|$)/i.exec(raw);
  if (narrativeMatch) narrative = narrativeMatch[1].trim();
  const questionIds: string[] = [];
  const trailing = /\(([A-Z]\d+(?:\s*,\s*[A-Z]\d+)*)\)\s*$/.exec(raw.trim());
  if (trailing) {
    for (const id of trailing[1].split(",")) {
      const text = id.trim();
      if (text !== "") questionIds.push(text);
    }
  }
  return { blocks, narrative, questionIds };
};

const parseReportSection = (section: string): PackReportTemplate | null => {
  const titleMatch = /^Title:\s*(.+)$/im.exec(section);
  const voiceMatch = /^Voice:\s*(.+)$/im.exec(section);
  const tables = parseMarkdownTables(section);
  const table = tables[0];
  if (!titleMatch || !table) return null;
  const orderCol = columnIndex(table.headers, "order");
  const sectionCol = columnIndex(table.headers, "section");
  const builtCol = columnIndex(table.headers, "built from");
  const sections: PackReportSection[] = [];
  for (const row of table.rows) {
    const builtFromRaw = cell(row, builtCol);
    const orderText = cell(row, orderCol);
    const order = Number.parseInt(orderText, 10);
    if (!Number.isFinite(order)) continue;
    const parsed = parseBuiltFrom(builtFromRaw);
    sections.push({
      order,
      heading: cell(row, sectionCol),
      builtFromRaw,
      ...parsed,
    });
  }
  sections.sort((a, b) => a.order - b.order);
  return {
    title: titleMatch[1].trim(),
    voice: voiceMatch ? voiceMatch[1].trim() : "",
    sections,
  };
};

const parsePersonaTable = (audience: PackAudience, table: { headers: string[]; rows: string[][] }): PackPersona | null => {
  const fieldCol = columnIndex(table.headers, "field");
  const contentCol = columnIndex(table.headers, "content");
  if (fieldCol < 0 || contentCol < 0) return null;
  const fields = new Map<string, string>();
  for (const row of table.rows) fields.set(cell(row, fieldCol), cell(row, contentCol));
  const lookingFor = parseLookingFor(fields.get("Looking for") ?? "");
  return {
    audience,
    who: fields.get("Who") ?? "",
    situation: fields.get("Situation") ?? "",
    knows: fields.get("Knows") ?? "",
    doesNotKnow: fields.get("Does not know") ?? "",
    lookingFor,
    decisions: fields.get("Decisions") ?? "",
    usefulWhen: fields.get("Useful when") ?? "",
    leaveOut: fields.get("Leave out") ?? "",
    successTest: fields.get("Success test") ?? "",
  };
};

const sectionMap = (body: string): Map<string, string> => {
  const map = new Map<string, string>();
  const re = /^##\s+(.+)$/gm;
  const matches = [...body.matchAll(re)];
  for (let i = 0; i < matches.length; i += 1) {
    const heading = matches[i][1].trim();
    const start = (matches[i].index ?? 0) + matches[i][0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? body.length) : body.length;
    map.set(heading, body.slice(start, end).trim());
  }
  return map;
};

const splitPackFrontMatter = (markdown: string): { frontMatter: string; body: string } | null => {
  const lines = markdown.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  let close = 1;
  while (close < lines.length && lines[close].trim() !== "---") close += 1;
  if (close >= lines.length) return null;
  return {
    frontMatter: lines.slice(1, close).join("\n"),
    body: lines.slice(close + 1).join("\n").trim(),
  };
};

export function parsePackMarkdown(markdown: string): PackParse {
  const split = splitPackFrontMatter(markdown.trimStart());
  if (split === null) {
    return { ok: false, reason: "pack_front_matter_invalid", message: "Pack file must start with YAML front matter." };
  }
  const fmRaw = parseYamlFrontMatter(split.frontMatter.trim());
  if (fmRaw === null) {
    return { ok: false, reason: "pack_front_matter_invalid", message: "Front matter could not be parsed." };
  }
  const meta = parseFrontMatter(fmRaw);
  if (meta === null) {
    return { ok: false, reason: "pack_front_matter_invalid", message: "pack, version, and title are required in front matter." };
  }
  const body = split.body;
  const sections = sectionMap(body);

  const rules = bulletLines(sections.get("Rules") ?? "");

  const personas: PackPersona[] = [];
  for (const block of splitH3Sections(sections.get("Personas") ?? "")) {
    const audience = PERSONA_HEADING[block.heading.trim().toLowerCase()];
    if (!audience) continue;
    const tables = parseMarkdownTables(block.body);
    if (tables.length === 0) continue;
    const persona = parsePersonaTable(audience, tables[0]);
    if (persona) personas.push(persona);
  }

  const askThePerson: PackIntakeQuestion[] = [];
  for (const table of parseMarkdownTables(sections.get("Ask the person") ?? "")) {
    const idCol = columnIndex(table.headers, "id");
    const audienceCol = columnIndex(table.headers, "audience");
    const questionCol = columnIndex(table.headers, "question");
    const whyCol = columnIndex(table.headers, "why it changes the report", "why");
    for (const row of table.rows) {
      const id = cell(row, idCol);
      if (id === "") continue;
      askThePerson.push({
        id,
        audience: cell(row, audienceCol),
        question: cell(row, questionCol),
        why: cell(row, whyCol),
      });
    }
  }

  const checks: PackCheck[] = [];
  const checkIds = new Set<string>();
  for (const block of splitH3Sections(sections.get("Checks") ?? "")) {
    const group = block.heading.trim();
    for (const table of parseMarkdownTables(block.body)) {
      const idCol = columnIndex(table.headers, "id");
      const checkCol = columnIndex(table.headers, "check");
      const evidenceCol = columnIndex(table.headers, "evidence");
      const authorityCol = columnIndex(table.headers, "authority");
      const questionCol = columnIndex(table.headers, "question");
      for (const row of table.rows) {
        const id = cell(row, idCol);
        if (id === "") continue;
        if (checkIds.has(id)) {
          return { ok: false, reason: "pack_duplicate_check_id", message: `Duplicate check id "${id}".` };
        }
        checkIds.add(id);
        const questionRaw = cell(row, questionCol);
        checks.push({
          id,
          group,
          check: cell(row, checkCol),
          evidence: cell(row, evidenceCol),
          authority: cell(row, authorityCol),
          question: questionRaw === "" || questionRaw === "-" ? null : questionRaw,
        });
      }
    }
  }

  const standingQuestions: PackStandingQuestion[] = [];
  for (const table of parseMarkdownTables(sections.get("Standing questions") ?? "")) {
    const idCol = columnIndex(table.headers, "id");
    const audienceCol = columnIndex(table.headers, "audience");
    const askWhenCol = columnIndex(table.headers, "ask when");
    const questionCol = columnIndex(table.headers, "question");
    for (const row of table.rows) {
      const id = cell(row, idCol);
      if (id === "") continue;
      if (checkIds.has(id)) {
        return { ok: false, reason: "pack_duplicate_check_id", message: `Duplicate check id "${id}".` };
      }
      checkIds.add(id);
      standingQuestions.push({
        id,
        audience: cell(row, audienceCol),
        askWhen: cell(row, askWhenCol),
        question: cell(row, questionCol),
      });
    }
  }

  const chains: PackChain[] = [];
  for (const table of parseMarkdownTables(sections.get("Chains") ?? "")) {
    const idCol = columnIndex(table.headers, "id");
    const labelCol = columnIndex(table.headers, "label");
    const linksCol = columnIndex(table.headers, "links");
    for (const row of table.rows) {
      const id = cell(row, idCol);
      if (id === "") continue;
      chains.push({
        id,
        label: cell(row, labelCol),
        links: splitList(cell(row, linksCol)),
      });
    }
  }

  const computedValues: PackComputedValue[] = [];
  for (const table of parseMarkdownTables(sections.get("Computed values") ?? "")) {
    const idCol = columnIndex(table.headers, "id");
    const labelCol = columnIndex(table.headers, "label");
    const opCol = columnIndex(table.headers, "op");
    const inputsCol = columnIndex(table.headers, "inputs");
    const perCol = columnIndex(table.headers, "per");
    for (const row of table.rows) {
      const id = cell(row, idCol);
      if (id === "") continue;
      computedValues.push({
        id,
        label: cell(row, labelCol),
        op: cell(row, opCol),
        inputs: cell(row, inputsCol),
        per: cell(row, perCol),
      });
    }
  }

  const referenceTables: PackReferenceTable[] = [];
  for (const block of splitH3Sections(sections.get("Reference tables") ?? "")) {
    if (block.heading.trim() === "") continue;
    for (const table of parseMarkdownTables(block.body)) {
      referenceTables.push({ name: block.heading.trim(), headers: table.headers, rows: table.rows });
    }
  }

  const documentsUsuallyNeeded: PackDocumentExpectation[] = [];
  for (const table of parseMarkdownTables(sections.get("Documents usually needed") ?? "")) {
    const docCol = columnIndex(table.headers, "document");
    const holderCol = columnIndex(table.headers, "holder");
    const whenCol = columnIndex(table.headers, "when");
    const settlesCol = columnIndex(table.headers, "settles");
    for (const row of table.rows) {
      const document = cell(row, docCol);
      if (document === "") continue;
      const holder = cell(row, holderCol);
      const when = cell(row, whenCol);
      documentsUsuallyNeeded.push({
        document,
        holder,
        holderType: extractHolderType(holder),
        when,
        gapKind: classifyDocumentWhen(when),
        settlesCheckIds: settlesCol >= 0 ? parseSettles(cell(row, settlesCol)) : [],
      });
    }
  }

  const terms: PackTerm[] = [];
  for (const table of parseMarkdownTables(sections.get("Terms") ?? "")) {
    const termCol = columnIndex(table.headers, "term");
    const meaningCol = columnIndex(table.headers, "plain meaning");
    for (const row of table.rows) {
      const term = cell(row, termCol);
      if (term === "") continue;
      terms.push({ term, plainMeaning: cell(row, meaningCol) });
    }
  }

  const generalNotes: PackGeneralNote[] = [];
  for (const table of parseMarkdownTables(sections.get("General notes") ?? "")) {
    const idCol = columnIndex(table.headers, "id");
    const showCol = columnIndex(table.headers, "show when");
    const textCol = columnIndex(table.headers, "text");
    for (const row of table.rows) {
      const id = cell(row, idCol);
      if (id === "") continue;
      generalNotes.push({ id, showWhen: cell(row, showCol), text: cell(row, textCol) });
    }
  }

  const customerReport = parseReportSection(sections.get("Customer report") ?? "");
  const professionalReport = parseReportSection(sections.get("Professional report") ?? "");
  const sources = bulletLines(sections.get("Sources") ?? "");

  const personaQuestionIds = new Set<string>();
  for (const persona of personas) {
    for (const item of persona.lookingFor) {
      if (item.id === "") continue;
      const key = `${persona.audience}:${item.id}`;
      if (personaQuestionIds.has(key)) {
        return {
          ok: false,
          reason: "pack_duplicate_persona_question_id",
          message: `Duplicate persona question id "${item.id}" under ${persona.audience}.`,
        };
      }
      personaQuestionIds.add(key);
    }
  }

  const briefOnly =
    personas.length === 0 &&
    checks.length === 0 &&
    standingQuestions.length === 0 &&
    chains.length === 0 &&
    customerReport === null &&
    professionalReport === null;

  return {
    ok: true,
    value: {
      schema: PACK_SCHEMA,
      meta,
      briefOnly,
      rules,
      personas,
      askThePerson,
      checks,
      standingQuestions,
      chains,
      computedValues,
      referenceTables,
      documentsUsuallyNeeded,
      terms,
      generalNotes,
      customerReport,
      professionalReport,
      sources,
    },
  };
}
