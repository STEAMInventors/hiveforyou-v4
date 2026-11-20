#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "apps/web/.ui-shots");
const galleryWidths = [320, 390, 768, 1280, 1920];
const prototypeWidths = [390, 768, 1280, 1920];
const galleryPages = [
  "components",
  "shell",
  "board-people",
  "board-ask",
  "board-ask-client",
  "board-firmless",
  "board-empty",
  "board-long",
  "findings-medicaid",
  "findings-large",
  "findings-empty",
];
const baseUrl = process.env.UI_SHOTS_BASE_URL ?? "http://127.0.0.1:3000";
const prototypeUrl = `file:///${path.join(root, "prototype/new/HiveForYou-Complete-Prototype.html").replace(/\\/g, "/")}`;

const askGalleryPages = new Set([
  "board-ask",
  "board-ask-client",
  "board-empty",
  "board-firmless",
]);

function galleryUrl(pageName) {
  const path = `${baseUrl}/dev/gallery/${pageName}`;
  return askGalleryPages.has(pageName) ? `${path}?view=ask` : path;
}

function abortGoogleFonts(context) {
  return context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
}

async function pageOverflows(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

async function openPrototypeMedicaidBoard(page) {
  await page.goto(prototypeUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(300);
  const medicaid = page.locator('[data-scenario="medicaid"]');
  await medicaid.waitFor({ state: "visible", timeout: 30_000 });
  await medicaid.click();
  await page.waitForSelector('[data-view="people"]', { timeout: 30_000 });
}

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
  const overflowPages = [];

  const galleryContext = await browser.newContext();
  await abortGoogleFonts(galleryContext);

  for (const pageName of galleryPages) {
    for (const width of galleryWidths) {
      const page = await galleryContext.newPage();
      await page.setViewportSize({ width, height: 900 });
      await page.goto(galleryUrl(pageName), { waitUntil: "domcontentloaded", timeout: 120_000 });
      if (pageName === "board-ask" || pageName === "board-long") {
        await page.waitForSelector('[data-testid="hive-message"]', { timeout: 30_000 }).catch(() => undefined);
      }
      if (pageName.startsWith("findings-") && pageName !== "findings-empty") {
        await page.waitForSelector('[data-testid="findings-topics"]', { timeout: 30_000 }).catch(() => undefined);
      }
      await page.waitForTimeout(pageName === "board-ask" ? 2500 : 1500);
      if (await pageOverflows(page)) {
        overflowPages.push(`gallery:${pageName}@${width}px`);
      }
      await page.screenshot({ path: path.join(outDir, `gallery-${pageName}-${width}.png`), fullPage: true });
      await page.close();
    }
  }
  await galleryContext.close();

  const protoContext = await browser.newContext();
  await abortGoogleFonts(protoContext);

  for (const width of prototypeWidths) {
    const page = await protoContext.newPage();
    await page.setViewportSize({ width, height: 900 });
    await openPrototypeMedicaidBoard(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, `prototype-board-people-${width}.png`), fullPage: true });

    await page.locator('[data-view="ask"]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-askof="client"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, `prototype-board-ask-${width}.png`), fullPage: true });
    await page.close();
  }

  for (const width of prototypeWidths) {
    const page = await protoContext.newPage();
    await page.setViewportSize({ width, height: 900 });
    await openPrototypeMedicaidBoard(page);
    await page.selectOption("#actor", "client");
    await page.waitForTimeout(200);
    await page.locator('[data-view="ask"]').click();
    await page.waitForTimeout(200);
    const draft = page.locator("#draft");
    await draft.waitFor({ state: "visible", timeout: 15_000 });
    await draft.fill("Should I qualify for Medicaid?");
    await page.locator('[data-action="send"]').click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(outDir, `prototype-board-ask-client-${width}.png`), fullPage: true });
    await page.close();
  }

  async function openPrototypeFindings(page, large) {
    await page.goto(prototypeUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.waitForTimeout(300);
    if (large) {
      await page.locator('[data-action="library"]').first().click();
      await page.waitForTimeout(300);
      await page.locator('[data-open="large"]').click();
      await page.waitForTimeout(400);
    } else {
      const medicaid = page.locator('[data-scenario="medicaid"]');
      await medicaid.waitFor({ state: "visible", timeout: 30_000 });
      await medicaid.click();
      await page.waitForTimeout(300);
    }
    await page.locator('[data-tab="findings"]').click();
    await page.waitForTimeout(500);
  }

  for (const [slug, large] of [
    ["medicaid", false],
    ["large", true],
  ]) {
    for (const width of [390, 1280]) {
      const page = await protoContext.newPage();
      await page.setViewportSize({ width, height: 900 });
      await openPrototypeFindings(page, large);
      await page.waitForTimeout(300);
      if (await pageOverflows(page)) {
        overflowPages.push(`prototype:findings-${slug}@${width}px`);
      }
      await page.screenshot({
        path: path.join(outDir, `prototype-findings-${slug}-${width}.png`),
        fullPage: true,
      });
      await page.close();
    }
  }

  await protoContext.close();
  await browser.close();

  console.log(`Wrote screenshots to ${outDir}`);
  if (overflowPages.length > 0) {
    console.log("Horizontal overflow:");
    for (const line of overflowPages) console.log(`  - ${line}`);
  } else {
    console.log("No horizontal overflow on gallery pages.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});