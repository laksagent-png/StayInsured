/**
 * The renderer's half of the bridge.
 *
 * Everything in `ui/shims/` is aliased over a `@tauri-apps/*` module when the
 * interface is built for this edition, so the app's own source never learns it is
 * running in Electron. Nothing under `src/` had to change to make that work,
 * which is the point: one interface, two backends, and no `if (isElectron)`
 * scattered through the screens.
 *
 * `window.stayinsured` is what `src/preload.ts` exposes.
 */

export interface WireError {
  kind: string;
  message: string;
}

export interface DialogFilter {
  name: string;
  extensions: string[];
}

export interface OpenOptions {
  multiple?: boolean;
  directory?: boolean;
  title?: string;
  defaultPath?: string;
  filters?: DialogFilter[];
}

export interface SaveOptions {
  title?: string;
  defaultPath?: string;
  filters?: DialogFilter[];
}

export interface AskOptions {
  title?: string;
  kind?: "info" | "warning" | "error";
  okLabel?: string;
  cancelLabel?: string;
}

export interface Bridge {
  invoke(command: string, args: Record<string, unknown>): Promise<{ ok: true; value: unknown } | { ok: false; error: WireError }>;
  on(event: string, handler: (payload: unknown) => void): () => void;
  version(): Promise<string>;
  isWindowVisible(): Promise<boolean>;
  openDialog(options: OpenOptions): Promise<string | string[] | null>;
  saveDialog(options: SaveOptions): Promise<string | null>;
  ask(message: string, options: AskOptions): Promise<boolean>;
  autostart: {
    isEnabled(): Promise<boolean>;
    enable(): Promise<void>;
    disable(): Promise<void>;
  };
  relaunch(): Promise<void>;
}

declare global {
  interface Window {
    stayinsured?: Bridge;
  }
}

export function bridge(): Bridge {
  const found = window.stayinsured;
  if (!found) {
    // Only reachable if the preload script failed to load, which would otherwise
    // surface as a hundred unrelated errors from every screen at once.
    throw new Error("The Electron bridge is missing: the preload script did not run.");
  }
  return found;
}
