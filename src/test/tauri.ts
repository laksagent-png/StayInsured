/**
 * Stand-ins for the Tauri modules the app imports directly.
 *
 * `src/test/setup.ts` points every `@tauri-apps/*` import at the spies below, so
 * a test can say what the file picker returns, fire a tray event, or check that
 * the app asked to relaunch, without a window anywhere.
 */

import { vi } from "vitest";

type EventHandler = (event: { event: string; id: number; payload: unknown }) => void;

const listeners = new Map<string, Set<EventHandler>>();
let nextListenerId = 1;

/** Every window event the app is listening for, by name. */
export function listenerCount(event: string): number {
  return listeners.get(event)?.size ?? 0;
}

/** Fire a window event, the way the tray menu or the sweep does. */
export function emitTauriEvent(event: string, payload: unknown): void {
  const handlers = listeners.get(event);
  if (!handlers) return;
  for (const handler of [...handlers]) {
    handler({ event, id: nextListenerId, payload });
  }
}

export const tauriEvent = {
  listen: vi.fn(async (event: string, handler: EventHandler) => {
    const handlers = listeners.get(event) ?? new Set<EventHandler>();
    handlers.add(handler);
    listeners.set(event, handlers);
    return () => {
      handlers.delete(handler);
    };
  }),
  emit: vi.fn(async () => {}),
};

/** The file picker and the native message boxes. */
export const tauriDialog = {
  /** Returns the path the app should treat as chosen; null means cancelled. */
  open: vi.fn<(...args: unknown[]) => Promise<string | string[] | null>>(async () => null),
  save: vi.fn<(...args: unknown[]) => Promise<string | null>>(async () => null),
  ask: vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => false),
  confirm: vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => false),
  message: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
};

export const tauriApp = {
  getVersion: vi.fn(async () => "0.3.1"),
};

export const tauriWindow = {
  isVisible: vi.fn(async () => true),
  show: vi.fn(async () => {}),
  setFocus: vi.fn(async () => {}),
};

export const tauriProcess = {
  relaunch: vi.fn(async () => {}),
  exit: vi.fn(async () => {}),
};

export const tauriAutostart = {
  isEnabled: vi.fn(async () => false),
  enable: vi.fn(async () => {}),
  disable: vi.fn(async () => {}),
};

export interface FakeUpdate {
  version: string;
  currentVersion?: string;
  date?: string;
  body?: string;
  downloadAndInstall: (onEvent?: (event: unknown) => void) => Promise<void>;
}

export const tauriUpdater = {
  /** Null means the app is already up to date, which is the default. */
  check: vi.fn<(...args: unknown[]) => Promise<FakeUpdate | null>>(async () => null),
};

/** An update the checker can find, with a spy on the install. */
export function fakeUpdate(version = "9.9.9"): FakeUpdate {
  return {
    version,
    currentVersion: "0.3.1",
    date: "2026-08-14",
    body: "Faster renewals desk.",
    downloadAndInstall: vi.fn(async () => {}),
  };
}

/** Puts every Tauri spy back to its resting state. Done for you between tests. */
export function resetTauriMocks(): void {
  listeners.clear();
  nextListenerId = 1;

  tauriEvent.listen.mockClear();
  tauriEvent.emit.mockClear();

  tauriDialog.open.mockReset().mockResolvedValue(null);
  tauriDialog.save.mockReset().mockResolvedValue(null);
  tauriDialog.ask.mockReset().mockResolvedValue(false);
  tauriDialog.confirm.mockReset().mockResolvedValue(false);
  tauriDialog.message.mockReset().mockResolvedValue(undefined);

  tauriApp.getVersion.mockReset().mockResolvedValue("0.3.1");

  tauriWindow.isVisible.mockReset().mockResolvedValue(true);
  tauriWindow.show.mockReset().mockResolvedValue(undefined);
  tauriWindow.setFocus.mockReset().mockResolvedValue(undefined);

  tauriProcess.relaunch.mockReset().mockResolvedValue(undefined);
  tauriProcess.exit.mockReset().mockResolvedValue(undefined);

  tauriAutostart.isEnabled.mockReset().mockResolvedValue(false);
  tauriAutostart.enable.mockReset().mockResolvedValue(undefined);
  tauriAutostart.disable.mockReset().mockResolvedValue(undefined);

  tauriUpdater.check.mockReset().mockResolvedValue(null);
}
