/**
 * The update offer: what an operator is shown, and — more often — what they are
 * deliberately not shown when the app is current, offline, or still in the tray.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeUpdate, tauriDialog, tauriProcess, tauriUpdater, tauriWindow } from "@/test";

/**
 * `offerUpdate` remembers for the life of the process that it has run, so each
 * case loads a fresh copy of the module and starts the launch over. The Tauri
 * spies survive the reset, because the harness answers those imports from a
 * mock the module registry does not rebuild.
 */
async function launch() {
  vi.resetModules();
  const { offerUpdate } = await import("@/lib/updates");
  return { offerUpdate };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("offering an update", () => {
  it("says nothing when the app is already current", async () => {
    const { offerUpdate } = await launch();

    await offerUpdate();

    expect(tauriUpdater.check).toHaveBeenCalledTimes(1);
    expect(tauriDialog.ask).not.toHaveBeenCalled();
  });

  it("names both versions when there is something to install", async () => {
    const { offerUpdate } = await launch();
    tauriUpdater.check.mockResolvedValue(fakeUpdate("1.4.0"));

    await offerUpdate();

    expect(tauriDialog.ask).toHaveBeenCalledTimes(1);
    const [message, options] = tauriDialog.ask.mock.calls[0] as [string, { title: string }];
    expect(message).toContain("1.4.0");
    expect(message).toContain("0.3.1");
    expect(message).toMatch(/clients, policies and settings stay exactly as they are/);
    expect(options.title).toBe("Update available");
  });

  it("installs and restarts when the offer is accepted", async () => {
    const { offerUpdate } = await launch();
    const update = fakeUpdate("1.4.0");
    tauriUpdater.check.mockResolvedValue(update);
    tauriDialog.ask.mockResolvedValue(true);

    await offerUpdate();

    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(tauriProcess.relaunch).toHaveBeenCalledTimes(1);
  });

  it("installs without restarting when the restart is put off", async () => {
    const { offerUpdate } = await launch();
    const update = fakeUpdate("1.4.0");
    tauriUpdater.check.mockResolvedValue(update);
    tauriDialog.ask.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await offerUpdate();

    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(tauriProcess.relaunch).not.toHaveBeenCalled();
  });

  it("downloads nothing when the offer is declined", async () => {
    const { offerUpdate } = await launch();
    const update = fakeUpdate("1.4.0");
    tauriUpdater.check.mockResolvedValue(update);
    tauriDialog.ask.mockResolvedValue(false);

    await offerUpdate();

    expect(tauriDialog.ask).toHaveBeenCalledTimes(1);
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    expect(tauriProcess.relaunch).not.toHaveBeenCalled();
  });

  it("swallows a check that fails, so a missing network is not an interruption", async () => {
    const { offerUpdate } = await launch();
    tauriUpdater.check.mockRejectedValue(new Error("Could not reach the release server"));

    await expect(offerUpdate()).resolves.toBeUndefined();

    expect(tauriDialog.ask).not.toHaveBeenCalled();
  });

  it("carries on when the download itself fails", async () => {
    const { offerUpdate } = await launch();
    const update = fakeUpdate("1.4.0");
    update.downloadAndInstall = vi.fn(async () => {
      throw new Error("The release file would not open");
    });
    tauriUpdater.check.mockResolvedValue(update);
    tauriDialog.ask.mockResolvedValue(true);

    await expect(offerUpdate()).resolves.toBeUndefined();

    expect(tauriProcess.relaunch).not.toHaveBeenCalled();
  });

  it("leaves a window hidden in the tray alone", async () => {
    const { offerUpdate } = await launch();
    tauriWindow.isVisible.mockResolvedValue(false);

    await offerUpdate();

    expect(tauriUpdater.check).not.toHaveBeenCalled();
    expect(tauriDialog.ask).not.toHaveBeenCalled();
  });

  it("looks only once in a launch, however often it is asked", async () => {
    const { offerUpdate } = await launch();
    tauriUpdater.check.mockResolvedValue(fakeUpdate("1.4.0"));

    await offerUpdate();
    await offerUpdate();

    expect(tauriUpdater.check).toHaveBeenCalledTimes(1);
  });

  it("offers the update once the tray window is opened", async () => {
    const { offerUpdate } = await launch();
    tauriWindow.isVisible.mockResolvedValue(false);
    tauriUpdater.check.mockResolvedValue(fakeUpdate("1.4.0"));

    await offerUpdate();
    tauriWindow.isVisible.mockResolvedValue(true);
    await offerUpdate();

    expect(tauriUpdater.check).toHaveBeenCalledTimes(1);
  });
});
