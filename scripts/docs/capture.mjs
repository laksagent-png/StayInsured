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
    caption: "Client page: contact details, the family, every policy held and the paperwork behind them",
    route: "/clients/1",
  },
  {
    name: "client-relative",
    caption: "Linking a relative: everybody in a family is a client in their own right",
    route: "/clients/1",
    prepare: click("Link relative"),
  },
  {
    name: "client-documents",
    caption: "Documents kept inside the encrypted book, filed against the policy they belong to",
    route: "/clients/1",
    element: ".card:has-text('Documents')",
  },
  {
    name: "document-attach",
    caption: "Attaching a scan: name it, and say which policy it belongs to",
    route: "/clients/1",
    prepare: click("Attach"),
  },
  {
    name: "client-company",
    caption: "A company client: the person to ask for in place of a date of birth, and the group it is filed in",
    route: "/clients/12",
  },
  {
    name: "groups",
    caption: "Groups: clients worked as one book, each with the contact who introduced them",
    route: "/groups",
  },
  {
    name: "group-new",
    caption: "Opening a group: only the name is required, and the head is four plain boxes",
    route: "/groups",
    prepare: click("New group"),
  },
  {
    name: "group-detail",
    caption: "Group page: who introduced the group, what the members hold between them, and who is in it",
    route: "/groups/1",
  },
  {
    name: "group-member",
    caption: "Adding a member: find the firm in the book, or open a company for it",
    route: "/groups/1",
    prepare: click("Add member"),
  },
  {
    name: "policies",
    caption: "Policies: every policy year, filtered by category, status, insurer and expiry window",
    route: "/policies",
  },
  {
    name: "policy-new",
    caption: "New policy: the form as health asks for it, in the order a proposal is written",
    route: "/policies",
    prepare: click("New policy"),
  },
  {
    name: "policy-new-motor",
    caption: "New policy: what a motor proposal asks about the vehicle and the two covers",
    route: "/policies",
    prepare: async (page) => {
      await click("New policy")(page);
      // The list behind the dialog has a category filter of its own.
      await page.getByRole("dialog").getByLabel("Category *").selectOption("motor");
      await page.waitForTimeout(600);
    },
  },
  {
    name: "policy-new-general",
    caption: "The same form for every other category: client, insurer, dates and money",
    route: "/policies",
    prepare: async (page) => {
      await click("New policy")(page);
      await page.getByRole("dialog").getByLabel("Category *").selectOption("travel");
      await page.waitForTimeout(600);
    },
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
    name: "reminders",
    caption: "Reminders: what goes out today, and how the last run went",
    route: "/reminders",
  },
  {
    name: "reminder-rules",
    caption: "The ladder: each rule sends one message, once, per policy year",
    route: "/reminders",
    prepare: click("Rules"),
  },
  {
    name: "reminder-message",
    caption: "Writing a message, with the preview filled in from a real policy",
    route: "/reminders",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Messages" }).click();
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: "Edit" }).first().click();
      await page.waitForTimeout(800);
    },
  },
  {
    name: "reminder-history",
    caption: "History: every message, why one was skipped, and what to retry",
    route: "/reminders",
    prepare: click("History"),
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
    caption: "Settings: agency details, password, backups, reminders and your mail server",
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
