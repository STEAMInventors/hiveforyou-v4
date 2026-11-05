// Renders eval/corpora/<id>/source/*.md into eval/corpora/<id>/docs/*.pdf.
// Usage: node eval/tools/build-corpora.mts [corpus-id ...]
//
// Markdown subset: "# " title, "## " heading, "- " bullet, blank line = gap, every other line is
// one wrapped paragraph, and a line "<!-- page -->" starts a new page. A page that overflows is an
// error, so the page numbers in golden.json always match the source file.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, type PDFFont } from "pdf-lib";

const CORPORA = resolve(import.meta.dirname, "..", "corpora");
const PAGE_BREAK = "<!-- page -->";
const WIDTH = 612;
const HEIGHT = 792;
const MARGIN = 72;
const FOOTER_Y = 40;
const BODY = { size: 10.5, leading: 14.5 };
const H1 = { size: 15, leading: 22 };
const H2 = { size: 11.5, leading: 17 };

type Line = { text: string; size: number; leading: number; bold: boolean; indent: number };

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current === "" ? word : `${current} ${word}`;
    if (current !== "" && font.widthOfTextAtSize(next, size) > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

function layoutPage(source: string, regular: PDFFont, bold: PDFFont): Line[] {
  const lines: Line[] = [];
  const width = WIDTH - 2 * MARGIN;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      lines.push({ text: "", size: BODY.size, leading: BODY.leading * 0.6, bold: false, indent: 0 });
      continue;
    }
    if (/[^\x20-\x7E]/.test(line)) throw new Error(`Non-ASCII text is not supported: ${JSON.stringify(line)}`);
    const style = line.startsWith("# ") ? H1 : line.startsWith("## ") ? H2 : BODY;
    const isBold = style !== BODY;
    const isBullet = line.startsWith("- ");
    const text = line.replace(/^(#{1,2}|-)\s+/, "");
    const indent = isBullet ? 14 : 0;
    const font = isBold ? bold : regular;
    wrap(text, font, style.size, width - indent).forEach((part, i) => {
      lines.push({
        text: isBullet && i === 0 ? `- ${part}` : part,
        size: style.size,
        leading: style.leading,
        bold: isBold,
        indent: isBullet && i > 0 ? indent + 8 : indent,
      });
    });
  }
  return lines;
}

export function pagesOf(markdown: string): string[] {
  return markdown.split(PAGE_BREAK).map((page) => page.trim());
}

function decodePageText(bytes: Uint8Array): string {
  const content = Buffer.from(bytes).toString("latin1");
  const parts: string[] = [];
  for (const match of content.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
    parts.push(Buffer.from(match[1]!, "hex").toString("latin1"));
  }
  return parts.join(" ");
}

async function extractedTextPerPage(pdf: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(pdf);
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams = contents && "asArray" in contents ? contents.asArray() : [contents];
    return streams
      .map((ref) => (ref ? page.doc.context.lookup(ref) : undefined))
      .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
      .map((stream) => {
        const filter = stream.dict.get(PDFName.of("Filter"));
        const raw = stream.contents;
        return decodePageText(filter === PDFName.of("FlateDecode") ? inflateSync(raw) : raw);
      })
      .join(" ");
  });
}

const squash = (text: string) => text.toLowerCase().replace(/\s+/g, "");

async function renderDocument(markdown: string, fileName: string): Promise<{ pdf: Uint8Array; pages: string[] }> {
  const doc = await PDFDocument.create();
  doc.setTitle(fileName.replace(/\.pdf$/, ""));
  doc.setAuthor("HiveForYou eval (synthetic)");
  doc.setProducer("HiveForYou eval/tools/build-corpora.mts");
  doc.setCreator("HiveForYou eval/tools/build-corpora.mts");
  const fixed = new Date("2026-01-01T00:00:00Z");
  doc.setCreationDate(fixed);
  doc.setModificationDate(fixed);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const sources = pagesOf(markdown);
  sources.forEach((source, index) => {
    const page = doc.addPage([WIDTH, HEIGHT]);
    let y = HEIGHT - MARGIN;
    for (const line of layoutPage(source, regular, bold)) {
      y -= line.leading;
      if (y < FOOTER_Y + 24) throw new Error(`${fileName} page ${index + 1} overflows; add "${PAGE_BREAK}".`);
      if (line.text !== "") {
        page.drawText(line.text, { x: MARGIN + line.indent, y, size: line.size, font: line.bold ? bold : regular });
      }
    }
    const footer = `SYNTHETIC TEST DOCUMENT - fictional names and data - ${fileName} - Page ${index + 1} of ${sources.length}`;
    page.drawText(footer, { x: MARGIN, y: FOOTER_Y, size: 7.5, font: regular });
  });
  const pdf = await doc.save({ useObjectStreams: false });
  const extracted = await extractedTextPerPage(pdf);
  extracted.forEach((text, i) => {
    const expected = squash(sources[i]!.replace(/^#{1,2}\s+/gm, ""));
    if (!squash(text).includes(expected)) throw new Error(`${fileName} page ${i + 1}: extracted text does not match source.`);
  });
  return { pdf, pages: sources };
}

type GoldenEvidence = { file: string; page: number; quoteFragment: string };

function checkGolden(corpusDir: string, pagesByFile: Map<string, string[]>): string[] {
  const goldenPath = join(corpusDir, "golden.json");
  if (!existsSync(goldenPath)) return ["golden.json missing"];
  const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
  const problems: string[] = [];
  const evidence: [string, GoldenEvidence][] = [
    ...(golden.spine ?? []).flatMap((item: { id: string; evidence: GoldenEvidence[] }) =>
      item.evidence.map((ev) => [item.id, ev] as [string, GoldenEvidence]),
    ),
    ...(golden.conflicts ?? []).flatMap((item: { id: string; evidence: GoldenEvidence[] }) => {
      if (item.evidence.length < 2) problems.push(`${item.id}: a conflict needs two or more evidence locations`);
      return item.evidence.map((ev) => [item.id, ev] as [string, GoldenEvidence]);
    }),
  ];
  for (const [id, ev] of evidence) {
    const page = pagesByFile.get(ev.file)?.[ev.page - 1];
    if (page === undefined) problems.push(`${id}: ${ev.file} page ${ev.page} does not exist`);
    else if (!squash(page).includes(squash(ev.quoteFragment))) {
      problems.push(`${id}: "${ev.quoteFragment}" not found on ${ev.file} page ${ev.page}`);
    }
  }
  if (golden.anchorDocument !== null && !pagesByFile.has(golden.anchorDocument)) {
    problems.push(`anchorDocument ${golden.anchorDocument} is not in the corpus`);
  }
  return problems;
}

async function buildCorpus(id: string): Promise<boolean> {
  const corpusDir = join(CORPORA, id);
  const sourceDir = join(corpusDir, "source");
  if (!existsSync(sourceDir)) {
    console.log(`${id}: no source/ folder (documents are supplied as PDFs), skipped`);
    return true;
  }
  const docsDir = join(corpusDir, "docs");
  mkdirSync(docsDir, { recursive: true });
  const pagesByFile = new Map<string, string[]>();
  for (const name of readdirSync(sourceDir).filter((n) => n.endsWith(".md")).sort()) {
    const fileName = `${basename(name, ".md")}.pdf`;
    const { pdf, pages } = await renderDocument(readFileSync(join(sourceDir, name), "utf8"), fileName);
    writeFileSync(join(docsDir, fileName), pdf);
    pagesByFile.set(fileName, pages);
    console.log(`${id}: ${fileName} (${pages.length} page${pages.length === 1 ? "" : "s"}, text verified)`);
  }
  const problems = checkGolden(corpusDir, pagesByFile);
  for (const problem of problems) console.error(`${id}: golden: ${problem}`);
  if (problems.length === 0) console.log(`${id}: golden.json evidence found on the stated pages`);
  return problems.length === 0;
}

const requested = process.argv.slice(2);
const ids = requested.length > 0 ? requested : readdirSync(CORPORA, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
let ok = true;
for (const id of ids) ok = (await buildCorpus(id)) && ok;
process.exitCode = ok ? 0 : 1;
