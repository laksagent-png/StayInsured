/**
 * The one test that fails when the two editions drift apart.
 *
 * The interface is shared and unmodified: every screen reaches its backend through
 * `call<T>()` in `src/lib/api.ts`, naming a command. So a command the Rust core has
 * and this one does not is a screen that breaks here, and a command this one has
 * that Rust does not is a screen that will break there when the name is corrected.
 * Neither is caught by any other test, because each edition's tests only know their
 * own side.
 *
 * It reads the Rust rather than a list kept by hand, so adding a command in
 * `lib.rs` and forgetting this edition is a failure here rather than a discovery in
 * the field.
 */

import fs from "node:fs";
import path from "node:path";

import { COMMANDS } from "../core/commands";
import { suite, test, expect } from "./harness";

/** The names inside `tauri::generate_handler![...]` in the Rust core's `lib.rs`. */
function rustCommands(): string[] {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "src-tauri", "src", "lib.rs"),
    "utf8",
  );

  const start = source.indexOf("generate_handler![");
  if (start === -1) throw new Error("no generate_handler! in src-tauri/src/lib.rs");
  const end = source.indexOf("]", start);
  const block = source.slice(start, end);

  const names = [...block.matchAll(/commands::([a-z0-9_]+)/g)].map((match) => match[1]);
  if (names.length === 0) throw new Error("generate_handler! parsed as empty");
  return names;
}

/** Names still answered by `unbuilt`, read from the source that declares them. */
function unbuiltCommands(): string[] {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "legacy-windows", "src", "core", "commands.ts"),
    "utf8",
  );
  return [...source.matchAll(/^ {2}([a-z0-9_]+): unbuilt\(/gm)].map((match) => match[1]);
}

suite("the command surface both editions share", () => {
  test("has every command the Rust core answers", () => {
    const missing = rustCommands().filter((name) => !(name in COMMANDS));
    expect.equal(
      missing.join(", "),
      "",
      "commands the interface can call that this edition does not answer",
    );
  });

  test("invents none of its own", () => {
    const rust = new Set(rustCommands());
    const extra = Object.keys(COMMANDS).filter((name) => !rust.has(name));
    expect.equal(extra.join(", "), "", "commands here that the Rust core does not have");
  });

  test("counts the same on both sides", () => {
    expect.equal(Object.keys(COMMANDS).length, new Set(rustCommands()).size);
  });

  test("reports how much of it is real", () => {
    const total = Object.keys(COMMANDS).length;
    const unbuilt = unbuiltCommands();
    console.log(
      `      ${total - unbuilt.length} of ${total} commands built` +
        (unbuilt.length > 0 ? `, still refusing: ${unbuilt.join(", ")}` : ", all of them"),
    );
    expect.ok(unbuilt.every((name) => name in COMMANDS), "an unbuilt name not in the table");
  });
});
