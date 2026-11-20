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
  "omni-staff-empty",
  "omni-staff-results",
  "omni-answer",
  "omni-client-handoff",
  "omni-staff-client-questions",
  "home-staff",
  "home-long",
  "home-firmless",
  "home-no-study",
  "evidence-statement",
  "evidence-item",
  "evidence-unreadable",
  "documents",
  "documents-empty",
  "client-home",
  "client-home-done",
  "report",
  "audit",
  "notes",
  "my-hives",
];

const conceptPath = path.join(root, "prototype/new/HiveForYou-Concept-v4.html");
const conceptUrl = `file:///${conceptPath.replace(/\\/g, "/")}`;
const baseUrl = process.env.UI_SHOTS_BASE_URL ?? "http://127.0.0.1:3000";

const omniPages = new Set([
  "omni-staff-empty",
  "omni-staff-results",
  "omni-answer",
  "omni-client-handoff",
  "omni-staff-client-questions",
]);

function galleryUrl(pageName) {
  const url = `${baseUrl}/dev/gallery/${pageName}`;
  if (pageName === "omni-staff-results") return `${url}?ask=1`;
  if (omniPages.has(pageName)) return `${url}?ask=1`;
  if (pageName.startsWith("evidence-")) return `${url}?source=f1`;
  return url;
}

function abortGoogleFonts(context) {
  return context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
}

async function pageOverflows(page) {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

async function openConcept(page) {
  await page.goto(conceptUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(400);
}

async function afterGalleryLoad(page, pageName) {
  if (pageName === "home-long") {
    await page.waitForSelector('[data-testid="hive-message"]', { timeout: 30_000 }).catch(() => undefined);
  }
  if (omniPages.has(pageName)) {
    const input = page.locator('[data-testid="omni"] input, [data-testid="omni"] textarea').first();
    await input.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
    await input.focus().catch(() => undefined);
    if (pageName === "omni-staff-results") {
      await input.fill("2023").catch(() => undefined);
    }
  }
  await page.waitForTimeout(pageName.startsWith("omni") ? 1200 : 800);
}

const conceptStates = [
  { slug: "home-staff", tab: "home", who: "staff" },
  { slug: "omni-answer", tab: "home", who: "staff", ask: true },
  { slug: "evidence-item", tab: "home", who: "staff", openItem: "x2" },
  { slug: "documents", tab: "documents", who: "staff" },
  { slug: "client-home", who: "client" },
];

async function captureConceptState(page, state, width) {
  await openConcept(page);
  if (state.who === "client") {
    await page.locator('[data-who="client"]').click();
    await page.waitForTimeout(200);
  }
  if (state.tab) {
    const tab = page.locator(`[data-tab="${state.tab}"]`);
    await tab.waitFor({ state: "visible", timeout: 15_000 });
    await tab.click();
    await page.waitForTimeout(250);
  }
  if (state.ask) {
    await page.locator("#omni").focus().catch(() => undefined);
    await page.locator("#omni").fill("2023").catch(() => undefined);
    await page.waitForTimeout(300);
  }
  if (state.openItem) {
    await page.locator(`[data-item="${state.openItem}"]`).first().click({ timeout: 15_000 });
    await page.waitForTimeout(400);
  } else if (state.evidence) {
    await page.locator(`[data-ev="${state.evidence}"]`).first().click({ timeout: 15_000 });
    await page.waitForTimeout(400);
  }
  await page.setViewportSize({ width, height: 900 });
  await page.screenshot({
    path: path.join(outDir, `concept-${state.slug}-${width}.png`),
    fullPage: true,
  });
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

  const skipGallery = process.env.UI_SHOTS_CONCEPT_ONLY === "1";

  if (!skipGallery) {
    const galleryContext = await browser.newContext();
    await abortGoogleFonts(galleryContext);
    for (const pageName of galleryPages) {
      for (const width of galleryWidths) {
        const page = await galleryContext.newPage();
        await page.setViewportSize({ width, height: 900 });
        await page.goto(galleryUrl(pageName), { waitUntil: "domcontentloaded", timeout: 120_000 });
        await afterGalleryLoad(page, pageName);
        if (await pageOverflows(page)) {
          overflowPages.push(`gallery:${pageName}@${width}px`);
        }
        await page.screenshot({ path: path.join(outDir, `gallery-${pageName}-${width}.png`), fullPage: true });
        await page.close();
      }
    }
    await galleryContext.close();
  }

  const protoContext = await browser.newContext();
  await abortGoogleFonts(protoContext);

  for (const state of conceptStates) {
    for (const width of prototypeWidths) {
      const page = await protoContext.newPage();
      await captureConceptState(page, state, width);
      await page.close();
    }
  }

  await protoContext.close();
  await browser.close();

  console.log(`Wrote screenshots to ${outDir}`);
  if (overflowPages.length > 0) {
    console.log("Horizontal overflow:");
    for (const line of overflowPages) console.log(`  - ${line}`);
  } else if (!skipGallery) {
    console.log("No horizontal overflow on gallery pages.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});