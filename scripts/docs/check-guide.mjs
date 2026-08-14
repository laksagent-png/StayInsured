/**
 * Fails when the interface has moved on and docs/HOW-TO.md has not.
 *
 * It reads the routes, the navigation and every button label out of the source,
 * then insists the guide talks about each one and that the screenshots on disk,
 * the screenshots in the guide and the shots the capture script takes are the
 * same set. Run it with `npm run docs:check`.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const guidePath = path.join(root, "docs", "HOW-TO.md");
const shotsDir = path.join(root, "docs", "screenshots");

/**
 * Labels that carry no meaning on their own. A guide that explains "Cancel"
 * once does not need to explain it seven more times.
 */
const GENERIC_LABELS = new Set([
  "cancel",
  "save",
  "add",
  "edit",
  "restore",
  "previous",
  "next",
  "dismiss",
  "close",
  "show all",
  "view policies",
  "open renewals",
  "all clients",
]);

const problems = [];
const fail = (message) => problems.push(message);

const normalise = (value) =>
  value
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();

async function readSource(relative) {
  return readFile(path.join(root, relative), "utf8");
}

async function pageSources() {
  const dir = path.join(root, "src", "pages");
  const files = (await readdir(dir)).filter((file) => file.endsWith(".tsx"));
  return Promise.all(
    files.map(async (file) => ({
      file: `src/pages/${file}`,
      text: await readFile(path.join(dir, file), "utf8"),
    })),
  );
}

/**
 * Pulls the visible text out of every `<Button>…</Button>` in a page.
 *
 * Attributes such as `icon={<Plus />}` contain angle brackets of their own, so
 * the opening tag is walked with a brace counter rather than matched.
 */
function buttonLabels(source) {
  const labels = new Set();
  const tag = "<Button";

  for (let at = source.indexOf(tag); at !== -1; at = source.indexOf(tag, at + 1)) {
    let depth = 0;
    let cursor = at + tag.length;
    for (; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      else if (character === ">" && depth === 0) break;
    }
    if (source[cursor - 1] === "/") continue; // self-closing, icon only

    const end = source.indexOf("</Button>", cursor);
    if (end === -1) continue;

    const text = source
      .slice(cursor + 1, end)
      .replace(/\{[\s\S]*?\}/g, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text && /[a-z]/i.test(text)) labels.add(text);
  }

  return labels;
}

const guide = await readFile(guidePath, "utf8");
const guideText = normalise(guide);
const mentions = (value) => guideText.includes(normalise(value));

// ---------------------------------------------------------------- routes
const appSource = await readSource("src/App.tsx");
const routes = Array.from(appSource.matchAll(/path="([^"]+)"/g))
  .map((match) => match[1])
  .filter((route) => route !== "*")
  .map((route) => route.replace(/\/:[^/]+/g, ""))
  .filter((route) => route !== "");

for (const route of new Set(routes)) {
  if (!guide.includes(route)) {
    fail(`Route ${route} is routed in src/App.tsx but never named in the guide`);
  }
}

// ---------------------------------------------------------------- navigation
const shellSource = await readSource("src/components/AppShell.tsx");
for (const match of shellSource.matchAll(/label: "([^"]+)"/g)) {
  if (!mentions(match[1])) {
    fail(`Sidebar item "${match[1]}" is missing from the guide`);
  }
}

// ---------------------------------------------------------------- operations
for (const { file, text } of await pageSources()) {
  for (const label of buttonLabels(text)) {
    if (GENERIC_LABELS.has(normalise(label))) continue;
    if (!mentions(label)) {
      fail(`Button "${label}" in ${file} is not explained in the guide`);
    }
  }
}

// ---------------------------------------------------------------- screenshots
const onDisk = new Set(
  (await readdir(shotsDir)).filter((file) => file.endsWith(".png")).map((file) => file.slice(0, -4)),
);
const referenced = new Set(
  Array.from(guide.matchAll(/!\[[^\]]*\]\(screenshots\/([^)]+)\.png\)/g)).map((match) => match[1]),
);

let manifest = { shots: [] };
try {
  manifest = JSON.parse(await readFile(path.join(shotsDir, "manifest.json"), "utf8"));
} catch {
  fail("docs/screenshots/manifest.json is missing — run `npm run docs:screenshots`");
}
const captured = new Set(manifest.shots.map((shot) => shot.name));

for (const name of captured) {
  if (!onDisk.has(name)) fail(`Screenshot ${name}.png is in the manifest but not on disk`);
  if (!referenced.has(name)) fail(`Screenshot ${name}.png is captured but never shown in the guide`);
}
for (const name of referenced) {
  if (!onDisk.has(name)) fail(`The guide points at screenshots/${name}.png, which does not exist`);
}
for (const name of onDisk) {
  if (!captured.has(name)) {
    fail(`docs/screenshots/${name}.png is not produced by the capture script — delete it or add the shot`);
  }
}

// ---------------------------------------------------------------- result
if (problems.length > 0) {
  console.error("The how-to guide is out of step with the app:\n");
  for (const problem of problems) console.error(`  • ${problem}`);
  console.error("\nUpdate docs/HOW-TO.md, then run `npm run docs:screenshots`.");
  process.exit(1);
}

console.log(
  `docs/HOW-TO.md covers ${new Set(routes).size} routes and ${captured.size} screenshots, and is in step with the app.`,
);
