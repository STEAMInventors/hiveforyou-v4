#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "apps/web/.ui-shots");
const widths = [390, 768, 1280, 1920];
const galleryPages = [
  "components",
  "shell",
  "board-people",
  "board-ask",
  "board-ask-client",
  "board-firmless",
  "board-empty",
  "board-long",
];
const baseUrl = process.env.UI_SHOTS_BASE_URL ?? "http://127.0.0.1:3000";
const prototypePath = path.join(root, "prototype/new/HiveForYou-Complete-Prototype.html");

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("Install playwright: npm i -D playwright (from repo root), then npx playwright install chromium");
    process.exit(1);
  }

  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext();

  for (const pageName of galleryPages) {
    for (const width of widths) {
      const page = await context.newPage();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${baseUrl}/dev/gallery/${pageName}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(outDir, `gallery-${pageName}-${width}.png`), fullPage: true });
      await page.close();
    }
  }

  for (const width of widths) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`file:///${prototypePath.replace(/\\/g, "/")}`);
    await page.screenshot({ path: path.join(outDir, `prototype-board-${width}.png`), fullPage: true });
    await page.close();
  }

  await browser.close();
  console.log(`Wrote screenshots to ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});