/**
 * What every test file gets for free.
 *
 * The Tauri modules are replaced with the spies in `./tauri`, `invoke` is wired
 * to the fake core in `./backend`, and the clock is frozen to the day the book
 * in `./fixtures` was written, so "expires in 7 days" means the same thing in
 * every test. A fresh book is installed before each test.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

import { installBackend } from "./backend";
import { FROZEN_NOW } from "./fixtures";
import { resetTauriMocks } from "./tauri";

vi.mock("@tauri-apps/api/core", async () => {
  const { dispatchInvoke } = await import("./backend");
  return {
    invoke: (command: string, args?: Record<string, unknown>) => dispatchInvoke(command, args),
    convertFileSrc: (path: string) => path,
  };
});

vi.mock("@tauri-apps/api/event", async () => {
  const { tauriEvent } = await import("./tauri");
  return { listen: tauriEvent.listen, emit: tauriEvent.emit, once: tauriEvent.listen };
});

vi.mock("@tauri-apps/api/app", async () => {
  const { tauriApp } = await import("./tauri");
  return { getVersion: tauriApp.getVersion };
});

vi.mock("@tauri-apps/api/window", async () => {
  const { tauriWindow } = await import("./tauri");
  return { getCurrentWindow: () => tauriWindow };
});

vi.mock("@tauri-apps/plugin-dialog", async () => {
  const { tauriDialog } = await import("./tauri");
  return tauriDialog;
});

vi.mock("@tauri-apps/plugin-process", async () => {
  const { tauriProcess } = await import("./tauri");
  return tauriProcess;
});

vi.mock("@tauri-apps/plugin-updater", async () => {
  const { tauriUpdater } = await import("./tauri");
  return tauriUpdater;
});

vi.mock("@tauri-apps/plugin-autostart", async () => {
  const { tauriAutostart } = await import("./tauri");
  return tauriAutostart;
});

// Recharts measures its container, and jsdom has no layout engine.
class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= TestResizeObserver as unknown as typeof ResizeObserver;

globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof matchMedia;

// Saving a document to disk goes through a blob URL, which jsdom does not have.
globalThis.URL.createObjectURL ??= (() => "blob:stayinsured/test") as typeof URL.createObjectURL;
globalThis.URL.revokeObjectURL ??= (() => {}) as typeof URL.revokeObjectURL;

// jsdom has no layout, so anything that scrolls into view would throw.
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

beforeEach(() => {
  // Only Date is faked: setTimeout stays real so user-event and React behave.
  vi.useFakeTimers({ toFake: ["Date"], now: FROZEN_NOW });
  // Deleting anything asks through window.confirm, which jsdom refuses to
  // answer. The default is Cancel, so a test that means to delete has to say
  // so with acceptConfirm() — and one that does not cannot destroy by accident.
  vi.spyOn(window, "confirm").mockReturnValue(false);
  installBackend();
  resetTauriMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
