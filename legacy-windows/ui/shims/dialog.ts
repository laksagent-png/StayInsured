/** Stands in for `@tauri-apps/plugin-dialog`. */

import { bridge, type AskOptions, type OpenOptions, type SaveOptions } from "../bridge";

/**
 * Both dialogs return paths as strings, which is the whole reason the interface
 * needs no changes: a screen picks a path and hands it to a command, and the
 * backend does the reading and writing. That contract is identical in both
 * editions.
 */
export async function open(options: OpenOptions = {}): Promise<string | string[] | null> {
  return bridge().openDialog(options);
}

export async function save(options: SaveOptions = {}): Promise<string | null> {
  return bridge().saveDialog(options);
}

export async function ask(message: string, options: AskOptions = {}): Promise<boolean> {
  return bridge().ask(message, options);
}
