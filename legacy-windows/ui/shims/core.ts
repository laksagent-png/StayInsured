/** Stands in for `@tauri-apps/api/core`. */

import { bridge } from "../bridge";

/**
 * `call<T>()` in `src/lib/api.ts` rebuilds its `ApiError` from a thrown value
 * carrying `kind` and `message`, so a failed command has to reject with that
 * object rather than with an `Error`. Electron's IPC cannot reject with a plain
 * object of its own accord — an error crossing `ipcMain.handle` arrives as a
 * string with a prefix — so the main process returns the failure as data and it
 * becomes a rejection here.
 */
export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const result = await bridge().invoke(command, args ?? {});
  if (result.ok) return result.value as T;
  throw result.error;
}

/**
 * Tauri turns a filesystem path into a URL its asset protocol can serve. Nothing
 * in the app calls this — documents are read as bytes and shown from a blob URL —
 * and it exists only so the module's shape matches.
 */
export function convertFileSrc(filePath: string): string {
  return `file://${filePath}`;
}
