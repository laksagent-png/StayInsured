/**
 * The frame the whole app sits in: the sidebar an agent navigates by, the
 * counts that tell them where the work is, the search box that finds a policy
 * from anywhere, and the button that closes the book.
 */

import { describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/AppShell";
import type { Dashboard, ReminderOverview, SessionState } from "@/lib/types";
import {
  backend,
  currentRoute,
  renderApp,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from "@/test";

const NAV = [
  { label: "Dashboard", href: "/" },
  { label: "Renewals", href: "/renewals" },
  { label: "Reminders", href: "/reminders" },
  { label: "Clients", href: "/clients" },
  { label: "Policies", href: "/policies" },
  { label: "Insurers & plans", href: "/insurers" },
  { label: "Import data", href: "/import" },
  { label: "Settings", href: "/settings" },
];

function renderShell(options: { route?: string } = {}) {
  const onLocked = vi.fn<(session: SessionState) => void>();
  const rendered = renderWithProviders(
    <AppShell onLocked={onLocked}>
      <p>The page under the frame</p>
    </AppShell>,
    { route: options.route ?? "/" },
  );
  return { ...rendered, onLocked };
}

/** Answers the dashboard with figures a test can name, leaving the rest alone. */
async function withDashboard(patch: Partial<Dashboard>): Promise<void> {
  const base = await backend().invoke<Dashboard>("load_dashboard");
  backend().on("load_dashboard", () => ({ ...base, ...patch }));
  backend().clearCalls();
}

/** The same, for the reminder counts the sidebar badge adds up. */
async function withReminders(patch: Partial<ReminderOverview>): Promise<void> {
  const base = await backend().invoke<ReminderOverview>("reminder_overview");
  backend().on("reminder_overview", () => ({ ...base, ...patch }));
  backend().clearCalls();
}

/** The sidebar link carrying a label, badge and all. */
const navLink = (label: string): HTMLElement =>
  screen.getByText(label).closest("a") as HTMLElement;

const searchBox = () => screen.getByPlaceholderText(/Search clients/);

describe("the sidebar", () => {
  it("names every route the app can reach", async () => {
    renderShell();

    for (const { label, href } of NAV) {
      expect(navLink(label)).toHaveAttribute("href", href);
    }
    expect(await screen.findByText("Sharma Insurance Services")).toBeInTheDocument();
  });

  it("marks the route being looked at", async () => {
    renderShell({ route: "/policies" });

    await waitFor(() => expect(navLink("Policies")).toHaveAttribute("aria-current", "page"));
    expect(navLink("Clients")).not.toHaveAttribute("aria-current");
    expect(navLink("Dashboard")).not.toHaveAttribute("aria-current");
  });

  it("keeps the dashboard highlighted only on the dashboard", async () => {
    renderShell({ route: "/clients/1" });

    await waitFor(() => expect(navLink("Clients")).toHaveAttribute("aria-current", "page"));
    expect(navLink("Dashboard")).not.toHaveAttribute("aria-current");
  });

  it("shows the page it is framing", () => {
    renderShell();

    expect(screen.getByText("The page under the frame")).toBeInTheDocument();
  });
});

describe("the provider name", () => {
  it("comes from the settings", async () => {
    renderShell();

    expect(await screen.findByText("Sharma Insurance Services")).toBeInTheDocument();
  });

  it("falls back to the app's own name while the settings load", async () => {
    const gate = backend().hold("get_settings");
    renderShell();

    expect(screen.getByText("StayInsured")).toBeInTheDocument();
    gate.release();
    expect(await screen.findByText("Sharma Insurance Services")).toBeInTheDocument();
  });

  it("falls back to the app's own name when the book has no provider", async () => {
    backend().book.settings = {};
    renderShell();

    await waitFor(() => expect(backend().countOf("get_settings")).toBe(1));
    expect(screen.getByText("StayInsured")).toBeInTheDocument();
  });

  it("falls back to the app's own name when the provider is blank", async () => {
    backend().book.settings.provider_name = "";
    renderShell();

    await waitFor(() => expect(backend().countOf("get_settings")).toBe(1));
    expect(screen.getByText("StayInsured")).toBeInTheDocument();
  });
});

describe("the sidebar badges", () => {
  it("counts the month's expiries against Renewals", async () => {
    await withDashboard({ expiringThisMonth: 12 });
    renderShell();

    const badge = await within(navLink("Renewals")).findByText("12");
    expect(badge).toHaveClass("bg-amber-50");
  });

  it("leaves Renewals bare when nothing expires this month", async () => {
    await withDashboard({ expiringThisMonth: 0 });
    renderShell();

    await waitFor(() => expect(backend().countOf("load_dashboard")).toBe(1));
    expect(navLink("Renewals")).toHaveTextContent(/^Renewals$/);
  });

  it("adds what is due today to what failed", async () => {
    await withReminders({ dueToday: 3, failed: 2 });
    renderShell();

    expect(await within(navLink("Reminders")).findByText("5")).toBeInTheDocument();
  });

  it("raises the alarm when a message failed", async () => {
    await withReminders({ dueToday: 3, failed: 2 });
    renderShell();

    expect(await within(navLink("Reminders")).findByText("5")).toHaveClass("bg-rose-50");
  });

  it("stays calm when nothing failed", async () => {
    await withReminders({ dueToday: 3, failed: 0 });
    renderShell();

    expect(await within(navLink("Reminders")).findByText("3")).toHaveClass("bg-sky-50");
  });

  it("leaves Reminders bare when there is nothing to do", async () => {
    await withReminders({ dueToday: 0, failed: 0 });
    renderShell();

    await waitFor(() => expect(backend().countOf("reminder_overview")).toBe(1));
    expect(navLink("Reminders")).toHaveTextContent(/^Reminders$/);
  });
});

describe("the header badges", () => {
  it("counts the active policies", async () => {
    await withDashboard({ activePolicies: 14, expiringThisWeek: 3 });
    renderShell();

    expect(await screen.findByText("14 active policies")).toBeInTheDocument();
  });

  it("warns about the week's expiries", async () => {
    await withDashboard({ activePolicies: 14, expiringThisWeek: 3 });
    renderShell();

    expect(await screen.findByText("3 due this week")).toHaveClass("bg-rose-50");
  });

  it("says nothing about the week when nothing is due", async () => {
    await withDashboard({ activePolicies: 14, expiringThisWeek: 0 });
    renderShell();

    expect(await screen.findByText("14 active policies")).toBeInTheDocument();
    expect(screen.queryByText(/due this week/)).not.toBeInTheDocument();
  });
});

describe("global search", () => {
  it("takes what was typed to the policies list", async () => {
    const { user } = renderShell();

    await user.type(searchBox(), "Rohit{Enter}");

    await waitFor(() => expect(currentRoute()).toBe("/policies?q=Rohit"));
  });

  it("escapes what it puts in the address", async () => {
    const { user } = renderShell();

    await user.type(searchBox(), "MH 12/AB{Enter}");

    await waitFor(() => expect(currentRoute()).toBe("/policies?q=MH%2012%2FAB"));
  });

  it("trims the search before sending it", async () => {
    const { user } = renderShell();

    await user.type(searchBox(), "  Rohit  {Enter}");

    await waitFor(() => expect(currentRoute()).toBe("/policies?q=Rohit"));
  });

  it("goes nowhere on an empty search", async () => {
    const { user } = renderShell();

    await user.click(searchBox());
    await user.keyboard("{Enter}");

    expect(currentRoute()).toBe("/");
  });

  it("goes nowhere on a search of spaces", async () => {
    const { user } = renderShell();

    await user.type(searchBox(), "   {Enter}");

    expect(currentRoute()).toBe("/");
  });

  it("searches again from the policies list", async () => {
    const { user } = renderApp({ route: "/policies" });
    await waitFor(() => expect(backend().countOf("list_policies")).toBe(1));

    await user.type(searchBox(), "Rohit{Enter}");

    await waitFor(() => expect(currentRoute()).toBe("/policies?q=Rohit"));
    await waitFor(() => {
      expect(backend().lastCall("list_policies")?.filter).toMatchObject({ search: "Rohit" });
    });
  });

  it("keeps what was typed on screen", async () => {
    const { user } = renderShell();

    await user.type(searchBox(), "Rohit");

    expect(searchBox()).toHaveValue("Rohit");
  });
});

describe("the search shortcut", () => {
  it("puts the cursor in the search box on Cmd+K", async () => {
    const { user } = renderShell();

    await user.keyboard("{Meta>}k{/Meta}");

    expect(searchBox()).toHaveFocus();
  });

  it("puts the cursor in the search box on Ctrl+K", async () => {
    const { user } = renderShell();

    await user.keyboard("{Control>}k{/Control}");

    expect(searchBox()).toHaveFocus();
  });

  it("does not leave a stray k in the box", async () => {
    const { user } = renderShell();

    await user.click(searchBox());
    await user.keyboard("{Meta>}k{/Meta}");
    await user.keyboard("{Control>}k{/Control}");

    expect(searchBox()).toHaveValue("");
  });

  it("leaves the search box on Escape", async () => {
    const { user } = renderShell();

    await user.click(searchBox());
    await user.keyboard("{Escape}");

    expect(searchBox()).not.toHaveFocus();
  });

  it("stops listening once the shell is gone", async () => {
    const { unmount, user } = renderShell();
    unmount();

    await user.keyboard("{Meta>}k{/Meta}");

    expect(screen.queryByPlaceholderText(/Search clients/)).not.toBeInTheDocument();
  });
});

describe("locking the app", () => {
  it("closes the book and hands the session back", async () => {
    const { user, onLocked } = renderShell();

    await user.click(screen.getByRole("button", { name: /Lock app/ }));

    await waitFor(() => expect(backend().countOf("lock")).toBe(1));
    // React Query hands the mutation's own arguments along behind the session.
    expect(onLocked.mock.calls[0]?.[0]).toMatchObject({ unlocked: false, initialised: true });
  });

  it("shows the button working while the book closes", async () => {
    const gate = backend().hold("lock");
    const { user, onLocked } = renderShell();

    const button = screen.getByRole("button", { name: /Lock app/ });
    await user.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(button.querySelector(".animate-spin")).not.toBeNull();
    expect(onLocked).not.toHaveBeenCalled();

    gate.release();
    await waitFor(() => expect(onLocked).toHaveBeenCalledTimes(1));
  });

  it("asks to close the book once however many times it is clicked", async () => {
    const gate = backend().hold("lock");
    const { user } = renderShell();

    const button = screen.getByRole("button", { name: /Lock app/ });
    await user.click(button);
    await user.click(button);
    await user.click(button);

    gate.release();
    await waitFor(() => expect(backend().countOf("lock")).toBe(1));
  });

  it("says so when the book will not close", async () => {
    backend().fail("lock", { kind: "internal", message: "The book would not close" });
    const { user, onLocked } = renderShell();

    await user.click(screen.getByRole("button", { name: /Lock app/ }));

    await waitFor(() => expect(backend().countOf("lock")).toBe(1));
    expect(onLocked).not.toHaveBeenCalled();
    expect(await screen.findByText(/would not close/)).toBeInTheDocument();
  });
});

describe("when the book will not answer", () => {
  it("still frames the page", async () => {
    backend().fail("load_dashboard");
    backend().fail("get_settings");
    backend().fail("reminder_overview");
    renderShell();

    await waitFor(() => expect(backend().countOf("load_dashboard")).toBe(1));
    expect(screen.getByText("The page under the frame")).toBeInTheDocument();
    expect(screen.getByText("StayInsured")).toBeInTheDocument();
    for (const { label, href } of NAV) {
      expect(navLink(label)).toHaveAttribute("href", href);
    }
  });

  it("shows no counts it cannot stand behind", async () => {
    backend().fail("load_dashboard");
    backend().fail("reminder_overview");
    renderShell();

    await waitFor(() => expect(backend().countOf("reminder_overview")).toBe(1));
    expect(screen.queryByText(/active policies/)).not.toBeInTheDocument();
    expect(screen.queryByText(/due this week/)).not.toBeInTheDocument();
    expect(navLink("Renewals")).toHaveTextContent(/^Renewals$/);
    expect(navLink("Reminders")).toHaveTextContent(/^Reminders$/);
  });

  it("still searches and still locks", async () => {
    backend().fail("load_dashboard");
    backend().fail("get_settings");
    backend().fail("reminder_overview");
    const { user, onLocked } = renderShell();

    await user.type(searchBox(), "Rohit{Enter}");
    await waitFor(() => expect(currentRoute()).toBe("/policies?q=Rohit"));

    await user.click(screen.getByRole("button", { name: /Lock app/ }));
    await waitFor(() => expect(onLocked).toHaveBeenCalledTimes(1));
  });
});
