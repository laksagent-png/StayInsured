/**
 * The decisions the tray and the window are made of, kept apart from the Electron
 * objects that carry them out.
 *
 * `app`, `Tray` and `BrowserWindow` do not exist under `ELECTRON_RUN_AS_NODE`,
 * which is the only environment this edition's tests can run in — see
 * `tests/harness.ts` for why. A tray built in a test is therefore not something
 * that can be built at all, let alone clicked. What can be held to the Rust core
 * is everything worth getting wrong: the menu's items and their wording, and
 * whether closing the window ends the app or parks it. Those live here; `main.ts`
 * wires them to Electron and decides nothing itself.
 */

/** The ids `tray.rs` gives its menu items, which are also what its match reads. */
export type TrayItemId = "open" | "lock" | "quit";

export type TrayMenuItem =
  | { kind: "separator" }
  | { kind: "command"; id: TrayItemId; label: string };

/** What the icon calls itself when hovered. `tooltip` in `tray.rs`. */
export const TRAY_TOOLTIP = "StayInsured";

/**
 * The same items in the same order and the same words as `tray.rs`. The guide
 * names all three, so the wording is part of what both editions promise an
 * operator rather than a label either one is free to improve on.
 */
export function trayMenu(): TrayMenuItem[] {
  return [
    { kind: "command", id: "open", label: "Open StayInsured" },
    { kind: "command", id: "lock", label: "Lock now" },
    { kind: "separator" },
    { kind: "command", id: "quit", label: "Quit StayInsured" },
  ];
}

export type TrayEffect = "lock" | "show" | "quit";

/**
 * What an item does, in the order it does it. Locking before showing is the order
 * `tray.rs` uses and it is the whole point of the item: the window comes up on the
 * lock screen because the book was already closed and the interface already told,
 * rather than arriving on a screen it has to be taken off again.
 */
export function trayEffects(id: TrayItemId): TrayEffect[] {
  switch (id) {
    case "open":
      return ["show"];
    case "lock":
      return ["lock", "show"];
    case "quit":
      return ["quit"];
  }
}

/**
 * The size to draw the tray icon at, in points, or null to leave it as it is.
 *
 * The app's icon is 32 pixels square, which is what a Windows notification area
 * wants and what it scales for itself. A Mac menu bar is a fixed height and draws
 * a status icon at whatever size it is handed, so there the same file has to be
 * brought down to the 16 points a status item is built around — which is what the
 * Rust core's tray does for us before the icon ever reaches the bar.
 */
export function trayIconPoints(platform: string): number | null {
  return platform === "darwin" ? 16 : null;
}

/**
 * Started by the OS at login, the app goes straight to the tray rather than
 * putting a window in front of someone who was logging in, not opening it. The
 * flag is the one the Rust core's autostart plugin is registered with.
 */
export function startsHidden(argv: string[]): boolean {
  return argv.includes("--background");
}

export interface CloseContext {
  /** Whether a tray icon exists to bring the window back with. */
  tray: boolean;
  /** Whether the app is already on its way out, which is the one close to allow. */
  quitting: boolean;
}

export type CloseAction = "hide" | "close";

/**
 * Closing the window parks the app in the tray so scheduled work keeps running,
 * which is what `on_window_event` does in the Rust core. Without a tray there
 * would be no way back to a hidden window, so the diagnostics — which have no
 * tray — close as any window does.
 *
 * `quitting` has no counterpart in the Rust core, where quitting is an immediate
 * exit that asks no window's permission. Here quitting closes the windows, and a
 * close refused on the way out is an app that cannot be quit.
 */
export function closeAction({ tray, quitting }: CloseContext): CloseAction {
  if (quitting) return "close";
  return tray ? "hide" : "close";
}
