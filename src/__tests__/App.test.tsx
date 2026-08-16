/**
 * Booting the app: the wait for the session, which screen that session leads
 * to, where each route lands, and what survives the book being closed again.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserEvent } from "@testing-library/user-event";

import {
  CORRECT_PASSWORD,
  backend,
  currentRoute,
  emitTauriEvent,
  renderApp,
  screen,
  waitFor,
} from "@/test";

// The real offer is covered in `src/lib/__tests__/updates.test.ts`; here the
// only question is whether App asks for it, and when.
const { offerUpdate } = vi.hoisted(() => ({ offerUpdate: vi.fn(async () => {}) }));
vi.mock("@/lib/updates", () => ({ offerUpdate }));

/** Starts the app with the book closed and no saved key to open it. */
function startLocked() {
  backend().book.session.unlocked = false;
  backend().book.session.canUseKeychain = false;
}

const unlockButton = () => screen.getByRole("button", { name: /^Unlock$/ });

async function unlock(user: UserEvent) {
  await user.type(screen.getByLabelText(/^Password/), CORRECT_PASSWORD);
  await user.click(unlockButton());
}

beforeEach(() => {
  // A mock of our own is outside what the harness resets between tests.
  offerUpdate.mockReset().mockImplementation(async () => {});
});

describe("starting up", () => {
  it("waits on a spinner while the session is being read", async () => {
    const gate = backend().hold("session_state");
    renderApp();

    expect(await screen.findByText("Starting StayInsured")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Today at a glance" })).not.toBeInTheDocument();

    gate.release();
    expect(await screen.findByRole("heading", { name: "Today at a glance" })).toBeInTheDocument();
  });

  it("shows the lock screen instead of the shell when the book is closed", async () => {
    startLocked();
    renderApp();

    expect(await screen.findByText("Welcome back")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Clients/ })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Search clients/)).not.toBeInTheDocument();
  });

  it("asks for a new password when there is no book yet", async () => {
    backend().book.session.initialised = false;
    startLocked();
    renderApp();

    expect(await screen.findByText("Set up your practice")).toBeInTheDocument();
  });

  it("goes from first run to the dashboard in one journey", async () => {
    backend().book.session.initialised = false;
    startLocked();
    const { user } = renderApp();
    await screen.findByText("Set up your practice");

    await user.type(screen.getByLabelText(/Agency name/), "Sharma Insurance Services");
    await user.type(screen.getByLabelText(/^Password/), "a-long-enough-password");
    await user.type(screen.getByLabelText(/Confirm password/), "a-long-enough-password");
    await user.click(screen.getByRole("button", { name: /Create encrypted database/ }));

    expect(await screen.findByRole("heading", { name: "Today at a glance" })).toBeInTheDocument();
  });

  it("says so when the session cannot be read at all", async () => {
    backend().fail("session_state", {
      kind: "internal",
      message: "The data folder could not be read",
    });
    renderApp();

    expect(await screen.findByText(/could not be read/)).toBeInTheDocument();
  });
});

describe("routes", () => {
  const routes: Array<[string, string]> = [
    ["/", "Today at a glance"],
    ["/clients", "Clients"],
    ["/clients/1", "Rohit Sharma"],
    ["/policies", "Policies"],
    ["/renewals", "Renewals"],
    ["/reminders", "Reminders"],
    ["/import", "Import data"],
    ["/insurers", "Insurers & plans"],
    ["/settings", "Settings"],
  ];

  it.each(routes)("opens %s", async (route, heading) => {
    renderApp({ route });

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(currentRoute()).toBe(route);
  });

  it("sends an address that means nothing back to the dashboard", async () => {
    renderApp({ route: "/renwals" });

    expect(await screen.findByRole("heading", { name: "Today at a glance" })).toBeInTheDocument();
    expect(currentRoute()).toBe("/");
  });

  it("moves between screens from the sidebar", async () => {
    const { user } = renderApp();
    await screen.findByRole("heading", { name: "Today at a glance" });

    await user.click(screen.getByRole("link", { name: /Policies/ }));

    expect(await screen.findByRole("heading", { name: "Policies" })).toBeInTheDocument();
    expect(currentRoute()).toBe("/policies");
  });
});

describe("locking", () => {
  it("returns to the lock screen when the tray closes the book", async () => {
    renderApp({ route: "/clients" });
    await screen.findByRole("heading", { name: "Clients" });

    backend().book.session.unlocked = false;
    emitTauriEvent("session:locked", { ...backend().book.session });

    expect(await screen.findByText("Welcome back")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Clients" })).not.toBeInTheDocument();
  });

  it("asks for the password after a deliberate lock, saved key or not", async () => {
    renderApp();
    await screen.findByRole("heading", { name: "Today at a glance" });

    backend().book.session.unlocked = false;
    emitTauriEvent("session:locked", { ...backend().book.session });
    await screen.findByText("Welcome back");

    expect(backend().book.session.canUseKeychain).toBe(true);
    expect(backend().countOf("unlock_with_keychain")).toBe(0);
  });

  it("reads the book again from scratch on the way back in", async () => {
    const { user } = renderApp({ route: "/clients" });
    await screen.findByRole("heading", { name: "Clients" });
    await waitFor(() => expect(backend().countOf("list_clients")).toBeGreaterThan(0));
    const readsBeforeLock = backend().countOf("list_clients");

    backend().book.session.unlocked = false;
    emitTauriEvent("session:locked", { ...backend().book.session });
    await screen.findByText("Welcome back");

    await unlock(user);

    expect(await screen.findByRole("heading", { name: "Clients" })).toBeInTheDocument();
    await waitFor(() => {
      expect(backend().countOf("list_clients")).toBeGreaterThan(readsBeforeLock);
    });
  });

  it("closes the book from the sidebar too", async () => {
    const { user } = renderApp();
    await screen.findByRole("heading", { name: "Today at a glance" });

    await user.click(screen.getByRole("button", { name: /Lock app/ }));

    expect(await screen.findByText("Welcome back")).toBeInTheDocument();
    expect(backend().countOf("lock")).toBe(1);
  });
});

describe("the update offer", () => {
  it("waits until the book is open before looking for a new version", async () => {
    startLocked();
    const { user } = renderApp();
    await screen.findByText("Welcome back");

    expect(offerUpdate).not.toHaveBeenCalled();

    await unlock(user);

    await screen.findByRole("heading", { name: "Today at a glance" });
    await waitFor(() => expect(offerUpdate).toHaveBeenCalledTimes(1));
  });

  it("offers it straight away when the book is already open", async () => {
    renderApp();

    await screen.findByRole("heading", { name: "Today at a glance" });
    await waitFor(() => expect(offerUpdate).toHaveBeenCalledTimes(1));
  });
});
