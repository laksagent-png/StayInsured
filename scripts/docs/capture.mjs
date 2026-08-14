/**
 * Photographs every screen in the guide in docs/guide.
 *
 * Run it with `npm run docs:screenshots` after any change to the interface.
 * The app is served by Vite exactly as it ships, the Rust side is answered by
 * the demo book in fixtures.mjs, and the clock is frozen, so the only thing
 * that moves between runs is what actually changed on screen.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { createServer } from "vite";

import { fixtures } from "./fixtures.mjs";
import { installTauriMock } from "./mock-tauri.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const outDir = path.join(root, "docs", "guide", "screenshots");
const PORT = 5273;
const WIDTH = 1440;
const MIN_HEIGHT = 560;
const MAX_HEIGHT = 1800;

/** Waits for a click target, clicks it, and lets the panel settle. */
const click = (label, options) => async (page) => {
  const target = page.getByRole("button", { name: label, exact: false }).first();
  await target.waitFor({ state: "visible" });
  await target.click(options);
  await page.waitForTimeout(600);
};

/** Nothing is photographed while a spinner is up or a request is in flight. */
const waitForRendered = async (page) => {
  await page.waitForFunction(() => !document.querySelector(".animate-spin"), null, { timeout: 20_000 });
  await page.waitForFunction(
    () => window.__DOCS_PENDING__ === 0 && performance.now() - window.__DOCS_SETTLED_AT__ > 400,
    null,
    { timeout: 20_000 },
  );
};

/**
 * Measures what is actually on screen so the window grows and shrinks with the
 * interface. Hand-picked heights go stale the moment a field is added.
 */
async function fitViewport(page) {
  const measure = async () => {
    const wanted = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog) return dialog.getBoundingClientRect().height + 112;

      const main = document.querySelector("main");
      if (main) return main.scrollHeight + (window.innerHeight - main.clientHeight) + 4;

      const card = document.querySelector("#root > div > div");
      return card ? card.getBoundingClientRect().height + 96 : document.body.scrollHeight;
    });
    return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(wanted)));
  };

  // A panel that is still filling in — a policy chain arriving behind a dialog,
  // a chart re-measuring after the resize — changes the answer. Settle on a
  // height that survives being measured twice, or the same screen photographs
  // differently on two runs.
  let previous = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const height = await measure();
    if (height === previous) return;
    await page.setViewportSize({ width: WIDTH, height });
    await page.waitForTimeout(500);
    await waitForRendered(page);
    previous = height;
  }
}

const shots = [
  {
    name: "first-run",
    caption: "First run: name the agency and set the password that encrypts the book",
    route: "/",
    scenario: { session: { initialised: false, unlocked: false, canUseKeychain: false } },
  },
  {
    name: "unlock",
    caption: "Daily unlock",
    route: "/",
    scenario: { session: { initialised: true, unlocked: false, canUseKeychain: false } },
  },
  {
    name: "dashboard-empty",
    caption: "An empty book offers the two ways to fill it",
    route: "/",
    scenario: { empty: true },
  },
  {
    name: "dashboard",
    caption: "Dashboard: the state of the book, with every number linking to the list behind it",
    route: "/",
    settle: 2500,
  },
  {
    name: "renewals",
    caption: "Renewals desk: tabs by urgency, with recalculate, copy emails and export",
    route: "/renewals",
  },
  {
    name: "renew-policy",
    caption: "Renewing writes next year and keeps the expiring year on record",
    route: "/renewals",
    prepare: click("Renew"),
  },
  {
    name: "clients",
    caption: "Clients: search, filter and act on the whole book",
    route: "/clients",
  },
  {
    name: "client-new",
    caption: "New client: only the full name is required",
    route: "/clients",
    prepare: click("New client"),
  },
  {
    name: "client-detail",
    caption: "Client page: contact details, members covered and every policy held",
    route: "/clients/1",
  },
  {
    name: "client-member",
    caption: "Adding a family member to attach to health and travel policies",
    route: "/clients/1",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Add", exact: true }).first().click();
      await page.waitForTimeout(500);
    },
  },
  {
    name: "policies",
    caption: "Policies: every policy year, filtered by category, status, insurer and expiry window",
    route: "/policies",
  },
  {
    name: "policy-new",
    caption: "New policy: client, insurer, dates and money in one form",
    route: "/policies",
    prepare: click("New policy"),
  },
  {
    name: "policy-history",
    caption: "History: one row per policy year of the same cover",
    route: "/policies",
    prepare: async (page) => {
      await page.getByRole("button", { name: "History" }).first().click();
      await page.waitForTimeout(500);
    },
  },
  {
    name: "import-mapping",
    caption: "Import: the app guesses your column headings, and you correct the guesses",
    route: "/import",
    prepare: click("Choose a file"),
  },
  {
    name: "import-check",
    caption: "The check reads every row and reports what it would do without saving anything",
    route: "/import",
    element: ".card:has-text('Check results')",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Choose a file" }).click();
      await page.waitForTimeout(600);
      await page.getByRole("button", { name: "Check without saving" }).click();
      // The toast floats over the report, so let it time out first.
      await page.getByText("rows would fail", { exact: false }).waitFor({ state: "detached", timeout: 15_000 });
    },
  },
  {
    name: "insurers",
    caption: "Insurers and plans, kept tidy so one company is recorded one way",
    route: "/insurers",
  },
  {
    name: "insurer-new",
    caption: "Adding an insurer",
    route: "/insurers",
    prepare: click("New insurer"),
  },
  {
    name: "settings",
    caption: "Settings: agency details, password, backups and reminder preferences",
    route: "/settings",
  },
];

async function main() {
  await mkdir(outDir, { recursive: true });

  const server = await createServer({
    root,
    configFile: path.join(root, "vite.config.ts"),
    server: { port: PORT, strictPort: true, host: "127.0.0.1" },
    logLevel: "warn",
  });
  await server.listen();
  const base = `http://127.0.0.1:${PORT}`;

  const browser = await chromium.launch();
  let taken = 0;

  try {
    // Vite compiles on demand and reloads the page the first time it optimises
    // a dependency, so walk every route once before anything is photographed.
    const warmup = await browser.newContext({ viewport: { width: WIDTH, height: 900 } });
    await warmup.addInitScript(installTauriMock, { fixtures, scenario: {} });
    const warmupPage = await warmup.newPage();
    for (const route of new Set(shots.map((shot) => shot.route))) {
      await warmupPage.goto(`${base}/#${route}`, { waitUntil: "networkidle" });
    }
    await warmup.close();

    for (const shot of shots) {
      const context = await browser.newContext({
        viewport: { width: WIDTH, height: 900 },
        // 1440px wide is plenty for a document and keeps the repository light.
        deviceScaleFactor: 1,
        colorScheme: "light",
        reducedMotion: "reduce",
      });
      await context.addInitScript(installTauriMock, {
        fixtures,
        scenario: shot.scenario ?? {},
      });

      const page = await context.newPage();
      page.on("pageerror", (error) => {
        console.warn(`  ! ${shot.name}: ${error.message}`);
      });

      await page.goto(`${base}/#${shot.route}`, { waitUntil: "networkidle" });
      // A blinking caret is the one thing that differs between otherwise
      // identical runs, so take it out of the picture.
      await page.addStyleTag({ content: "*, *::before, *::after { caret-color: transparent !important; }" });
      await waitForRendered(page);
      await page.waitForTimeout(shot.settle ?? 900);

      if (shot.prepare) await shot.prepare(page);
      await waitForRendered(page);

      const file = path.join(outDir, `${shot.name}.png`);
      if (shot.element) {
        await page.locator(shot.element).first().screenshot({ path: file });
      } else {
        await fitViewport(page);
        await waitForRendered(page);
        await page.screenshot({ path: file });
      }
      await context.close();

      taken += 1;
      console.log(`  ✓ ${shot.name}.png`);
    }

    await writeFile(
      path.join(outDir, "manifest.json"),
      `${JSON.stringify(
        {
          generatedFrom: "npm run docs:screenshots",
          book: `demo data frozen at ${fixtures.today}`,
          shots: shots.map(({ name, caption, route }) => ({ name, caption, route })),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await browser.close();
    await server.close();
  }

  console.log(`\n${taken} screenshots written to docs/guide/screenshots`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
