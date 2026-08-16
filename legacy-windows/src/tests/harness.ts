/**
 * A test runner in eighty lines, because the usual one cannot run these tests.
 *
 * `better-sqlite3` here is compiled against Electron 22's ABI (Node 16, module
 * 110). A plain `node` on this machine is a different ABI and cannot load it, so
 * `vitest` — which is how the app's own tests run — would fail at the import.
 * Electron with `ELECTRON_RUN_AS_NODE=1` is Node with the right ABI and no
 * Electron APIs, which is exactly the environment `core/` is written for. Nothing
 * on npm both runs there and is worth the second dependency tree on a project
 * whose whole difficulty is native modules, so the runner is here instead.
 *
 * `npm test` in this folder is the entry point.
 */

import assert from "node:assert/strict";

import { AppError, type ErrorKind } from "../core/errors";

interface Case {
  suite: string;
  name: string;
  run: () => void | Promise<void>;
}

const cases: Case[] = [];
let current = "";

export function suite(name: string, body: () => void): void {
  current = name;
  body();
  current = "";
}

export function test(name: string, run: () => void | Promise<void>): void {
  cases.push({ suite: current, name, run });
}

// Annotated because `assert` carries assertion signatures, and TypeScript refuses
// to call one through a name whose type it had to infer.
export const expect: typeof assert = assert;

/**
 * Asserts the kind rather than the message. The kind is what the interface
 * switches on, so it is the part that has to match the Rust core; the wording is
 * checked only where a screen quotes it back to the operator.
 */
export async function throwsKind(
  kind: ErrorKind,
  run: () => unknown | Promise<unknown>,
  because?: string,
): Promise<AppError> {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown !== undefined, because ?? `expected a ${kind} error, but nothing was thrown`);
  assert.ok(
    thrown instanceof AppError,
    `expected an AppError, got ${thrown instanceof Error ? thrown.stack : String(thrown)}`,
  );
  assert.equal((thrown as AppError).kind, kind, because ?? `expected a ${kind} error`);
  return thrown as AppError;
}

export interface Results {
  passed: number;
  failed: number;
}

/** Runs every registered case in order and prints one line each. */
export async function runAll(): Promise<Results> {
  let passed = 0;
  let failed = 0;
  let printed = "";

  for (const item of cases) {
    if (item.suite !== printed) {
      console.log(`\n  ${item.suite}`);
      printed = item.suite;
    }

    try {
      await item.run();
      passed += 1;
      console.log(`    ok   ${item.name}`);
    } catch (error) {
      failed += 1;
      console.log(`    FAIL ${item.name}`);
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.log(
        detail
          .split("\n")
          .map((line) => `           ${line}`)
          .join("\n"),
      );
    }
  }

  return { passed, failed };
}
