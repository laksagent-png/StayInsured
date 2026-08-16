/**
 * The browser dialogs the app still uses.
 *
 * Destructive actions ask through `window.confirm`, which jsdom answers by
 * logging "not implemented", so a test has to say what the operator clicked.
 * The spy is restored between tests by the `restoreMocks` setting.
 */

import { vi, type MockInstance } from "vitest";

/** The operator clicks OK on the next confirmation. */
export function acceptConfirm(): MockInstance<(message?: string) => boolean> {
  return vi.spyOn(window, "confirm").mockReturnValue(true);
}

/** The operator clicks Cancel on the next confirmation. */
export function dismissConfirm(): MockInstance<(message?: string) => boolean> {
  return vi.spyOn(window, "confirm").mockReturnValue(false);
}
