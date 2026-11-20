#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "apps/web/.ui-shots");
const galleryWidths = [320, 390, 600, 768, 1024, 1280, 1920];
const prototypeWidths = [390, 768, 1280, 1920];

const galleryPages = [
  // UI-3 Part G
  "front",
  "front-self",
  "front-example-2",
  "sign-in-email",
  "sign-in-prefill",
  "sign-in-code",
  "sign-in-error",
  "hives-firm",
  "hives-mine",
  "hives-find-none",
  "hives-first-visit",
  "hives-own",
  "hives-error",
  "home-staff-chat",
  "home-staff-people",
  "home-staff-client-questions",
  "home-narrow-askbar",
  "chat-sheet-client",
  "evidence-ask-page",
  "home-assistant-off",
  // UI-2 hive workspace pages still used for comparison
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

const conceptPath = path.join(root, "prototype/new/HiveForYou-Concept-v5.html");
const conceptUrl = `file:///${conceptPath.replace(/\\/g, "/")}`;
const baseUrl = process.env.UI_SHOTS_BASE_URL ?? "http://127.0.0.1:3000";

const omniPages = new Set([
  "omni-staff-empty",
  "omni-staff-results",
  "omni-answer",
  "omni-client-handoff",
  "omni-staff-client-questions",
]);

const sheetPages = new Set(["chat-sheet-client", "evidence-ask-page", "home-narrow-askbar"]);

function galleryUrl(pageName) {
  const url = `${baseUrl}/dev/gallery/${pageName}`;
  if (pageName === "front-self") return `${url}?for=self`;
  if (pageName === "hives-mine") return `${url}?queue=mine`;
  if (pageName === "home-staff-people") return `${url}?side=people`;
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

/** Concept v5 collapses screen-switcher buttons on narrow viewports until "Concept" is tapped. */
async function unfoldConceptNav(page) {
  const folded = page.locator('[data-act="cnav"][aria-label="Show concept screens"]');
  if (await folded.isVisible().catch(() => false)) {
    await folded.click();
    await page.waitForTimeout(250);
  }
}

async function hideConceptNav(page) {
  await page.addStyleTag({ content: ".cnav { display: none !important; }" });
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
  if (pageName === "hives-find-none") {
    const find = page.locator('[data-testid="hives-find"] input').first();
    await find.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  }
  if (sheetPages.has(pageName)) {
    await page.waitForSelector('[data-testid="chat-sheet"],[data-testid="ask-bar"],[data-testid="chat-sheet-root"]', {
      timeout: 15_000,
    }).catch(() => undefined);
  }
  if (pageName === "evidence-ask-page") {
    await page.waitForSelector('[data-testid="evidence-ask-assistant"],[data-testid="chat-sheet"]', {
      timeout: 20_000,
    }).catch(() => undefined);
  }
  await page.waitForTimeout(pageName.startsWith("omni") || sheetPages.has(pageName) ? 1200 : 800);
}

/** Concept v5 states paired with UI-3 gallery pages (DESIGN §6, UI-3-SPEC Part G). */
const conceptStates = [
  { slug: "front", go: "front" },
  {
    slug: "front-self",
    go: "front",
    async after(page) {
      await page.locator('[data-mode="self"]').click();
    },
  },
  {
    slug: "front-example-2",
    go: "front",
    async after(page) {
      await page.locator('[data-exsel="2"]').click();
    },
  },
  { slug: "sign-in-email", go: "signin" },
  {
    slug: "sign-in-prefill",
    go: "signin",
    async after(page) {
      await page.locator("#email").fill("dana@firm.example");
    },
  },
  {
    slug: "sign-in-code",
    go: "signin",
    async after(page) {
      await page.locator('[data-act="sendcode"]').click();
      await page.waitForTimeout(300);
    },
  },
  {
    slug: "sign-in-error",
    go: "signin",
    async after(page) {
      await page.locator("#email").fill("bad@example.com");
      await page.locator('[data-act="sendcode"]').click();
      await page.waitForTimeout(200);
    },
  },
  { slug: "hives-firm", go: "hives" },
  {
    slug: "hives-mine",
    go: "hives",
    async after(page) {
      await page.locator('[data-queue="mine"]').click();
    },
  },
  { slug: "hives-first-visit", go: "first" },
  {
    slug: "home-staff-chat",
    minWidth: 1100,
    go: "hive:staff",
    async after(page) {
      await page.locator('[data-tab="home"]').click();
      await page.locator('[data-side="sarah"]').click().catch(() => undefined);
    },
  },
  {
    slug: "home-staff-people",
    minWidth: 1100,
    go: "hive:staff",
    async after(page) {
      await page.locator('[data-tab="home"]').click();
      await page.locator('[data-side="people"]').click();
    },
  },
  {
    slug: "home-staff-client-questions",
    minWidth: 1100,
    go: "hive:staff",
    async after(page) {
      await page.locator('[data-tab="home"]').click();
      await page.locator('[data-act="clientqs"]').click();
    },
  },
  {
    slug: "home-narrow-askbar",
    maxWidth: 1099,
    go: "hive:staff",
    async after(page) {
      await page.locator('[data-tab="home"]').click();
    },
  },
  {
    slug: "chat-sheet-client",
    go: "hive:client",
    async after(page) {
      await page.locator('[data-act="opensheet"]').click();
    },
  },
  {
    slug: "evidence-ask-page",
    go: "hive:staff",
    async after(page) {
      await page.locator('[data-tab="home"]').click();
      await page.locator('[data-ev]').first().click();
      await page.waitForTimeout(300);
      await page.locator('[data-act="askpage"]').click();
    },
  },
  {
    slug: "home-staff",
    go: "hive:staff",
    async after(page) {
      await page.locator('[data-tab="home"]').click();
    },
  },
  {
    slug: "omni-answer",
    go: "hive:staff",
    async after(page) {
      await page.locator('[data-tab="home"]').click();
      await page.locator("#omni").focus().catch(() => undefined);
      await page.locator("#omni").fill("2023").catch(() => undefined);
    },
  },
  {
    slug: "omni-staff-results",
    minWidth: 1100,
    go: "hive:staff",
    async after(page) {
      await page.locator('[data-tab="home"]').click();
      const input = page.locator("#omni");
      await input.waitFor({ state: "visible", timeout: 30_000 });
      await input.fill("2023");
    },
  },
  {
    slug: "evidence-item",
    go: "hive:staff",
    async after(page) {
      await page.locator('[data-tab="home"]').click();
      await page.locator('[data-item="x2"]').first().click();
    },
  },
  {
    slug: "documents",
    go: "hive:staff",
    async after(page) {
      await page.locator('[data-tab="documents"]').click();
    },
  },
  {
    slug: "client-home",
    who: "client",
  },
];

async function captureConceptState(page, state, width) {
  if (state.minWidth && width < state.minWidth) return;
  if (state.maxWidth && width > state.maxWidth) return;
  await page.setViewportSize({ width, height: 900 });
  await openConcept(page);
  await unfoldConceptNav(page);

  if (state.who === "client") {
    await page.locator('[data-who="client"]').click();
    await page.waitForTimeout(200);
  } else if (state.go?.startsWith("hive:")) {
    await page.locator(`[data-who="${state.go.slice(5)}"]`).click();
    await page.waitForTimeout(250);
  } else if (state.go) {
    const nav = page.locator(`.cnav [data-go="${state.go}"]`);
    await nav.waitFor({ state: "visible", timeout: 60_000 });
    await nav.click();
    await page.waitForTimeout(250);
  }

  if (state.after) {
    await state.after(page);
    await page.waitForTimeout(250);
  }

  await hideConceptNav(page);

  await page.screenshot({
    path: path.join(outDir, `concept-${state.slug}-${width}.png`),
    fullPage: true,
  });
}

function attachGalleryDiagnostics(page, diagnostics, pageName, width) {
  const tag = `gallery:${pageName}@${width}px`;
  page.on("console", (message) => {
    if (message.type() === "error") {
      diagnostics.console.push(`${tag}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    diagnostics.pageErrors.push(`${tag}: ${error.message}`);
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
  const galleryDiagnostics = { console: [], pageErrors: [] };

  const skipGallery = process.env.UI_SHOTS_CONCEPT_ONLY === "1";

  if (!skipGallery) {
    const galleryContext = await browser.newContext();
    await abortGoogleFonts(galleryContext);
    for (const pageName of galleryPages) {
      for (const width of galleryWidths) {
        const page = await galleryContext.newPage();
        attachGalleryDiagnostics(page, galleryDiagnostics, pageName, width);
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

  const reportWidths = new Set([390, 1280]);
  const consoleAtKeyWidths = galleryDiagnostics.console.filter((line) =>
    reportWidths.has(Number(/@(\d+)px/.exec(line)?.[1])),
  );
  const pageErrorsAtKeyWidths = galleryDiagnostics.pageErrors.filter((line) =>
    reportWidths.has(Number(/@(\d+)px/.exec(line)?.[1])),
  );

  if (!skipGallery && (consoleAtKeyWidths.length > 0 || pageErrorsAtKeyWidths.length > 0)) {
    console.error("Gallery console errors (390 and 1280px):");
    for (const line of [...consoleAtKeyWidths, ...pageErrorsAtKeyWidths]) console.error(`  - ${line}`);
    process.exit(1);
  } else if (!skipGallery) {
    console.log("No console errors on gallery pages at 390 and 1280px.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});