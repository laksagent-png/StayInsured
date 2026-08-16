/**
 * Proves the harness itself: the bridge, the book, the clock and the routing.
 * If these fail, every other test in the suite is unreliable.
 */

import { describe, expect, it } from "vitest";

import { backend, emitTauriEvent, renderApp, renderWithProviders, screen, waitFor } from "@/test";
import { DashboardPage } from "@/pages/Dashboard";

describe("test harness", () => {
  it("answers invoke from the book", async () => {
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText("Today at a glance")).toBeInTheDocument();
    expect(backend().countOf("load_dashboard")).toBe(1);
  });

  it("gives each test its own book", async () => {
    backend().book.clients = [];
    expect(backend().book.clients).toHaveLength(0);
  });

  it("starts the next test from a full book again", () => {
    expect(backend().book.clients.length).toBeGreaterThan(0);
  });

  it("freezes the clock on the day the book was written", () => {
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-08-14");
  });

  it("boots the whole app onto the dashboard", async () => {
    renderApp();

    expect(await screen.findByRole("heading", { name: "Today at a glance" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Clients/ })).toBeInTheDocument();
  });

  it("shows the lock screen when the book is closed", async () => {
    backend().book.session.unlocked = false;
    renderApp();

    expect(await screen.findByRole("button", { name: /Unlock/i })).toBeInTheDocument();
  });

  it("delivers window events the app listens for", async () => {
    renderApp();
    await screen.findByRole("heading", { name: "Today at a glance" });

    emitTauriEvent("session:locked", {
      initialised: true,
      unlocked: false,
      canUseKeychain: true,
      schemaVersion: 3,
      dataDir: "/tmp",
    });

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Today at a glance" })).not.toBeInTheDocument();
    });
  });

  it("can hold a command open to show a loading state", async () => {
    const gate = backend().hold("load_dashboard");
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText("Reading your book")).toBeInTheDocument();
    gate.release();
    expect(await screen.findByText("Today at a glance")).toBeInTheDocument();
  });

  it("can make a command fail", async () => {
    backend().fail("load_dashboard", { kind: "internal", message: "The book would not open" });
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(backend().countOf("load_dashboard")).toBe(1);
    });
  });
});
