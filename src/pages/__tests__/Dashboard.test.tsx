/**
 * The dashboard, driven the way an agent opens the app in the morning.
 *
 * Every number expected below is recomputed from the book in `src/test`, so the
 * expectations follow the fixtures rather than whatever the screen happens to
 * print today.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  CATEGORY_ORDER,
  backend,
  currentRoute,
  daysUntil,
  isoDaysFromToday,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from "@/test";
import { DashboardPage } from "@/pages/Dashboard";
import { categoryLabel, count, date, money, moneyCompact, relativeDays } from "@/lib/format";
import type { Policy } from "@/lib/types";

// ---------------------------------------------------------------- the numbers

const book = () => backend().book;
const daysLeft = (policy: Policy) => daysUntil(policy.expiryDate);

/** Active cover, the set every headline number on this page counts from. */
const activePolicies = () => book().policies.filter((row) => row.status === "active");

/** Cover that ran out and was never renewed — what the core calls overdue. */
const overduePolicies = () =>
  book().policies.filter(
    (row) => !row.isRenewed && row.status !== "cancelled" && daysLeft(row) < 0,
  );

const expiringBetween = (from: number, to: number) =>
  activePolicies().filter((row) => daysLeft(row) >= from && daysLeft(row) <= to);

const total = (rows: Policy[], key: "premiumAmount" | "commissionExpected") =>
  rows.reduce((sum, row) => sum + (row[key] ?? 0), 0);

const expiryBuckets = () => [
  { label: "Overdue", rows: overduePolicies() },
  { label: "0-7 days", rows: expiringBetween(0, 7) },
  { label: "8-15 days", rows: expiringBetween(8, 15) },
  { label: "16-30 days", rows: expiringBetween(16, 30) },
  { label: "31-60 days", rows: expiringBetween(31, 60) },
  { label: "61-90 days", rows: expiringBetween(61, 90) },
];

const activeByCategory = () =>
  CATEGORY_ORDER.map((category) => ({
    category,
    rows: activePolicies().filter((row) => row.category === category),
  })).filter((entry) => entry.rows.length > 0);

// ---------------------------------------------------------------- the screen

/** A headline tile, found by the label an agent reads. */
const tile = (label: string) => screen.getByText(label).closest(".card") as HTMLElement;

/** A titled card, found the way a person finds it: by its heading. */
const card = (title: string) =>
  screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;

/**
 * Recharts asks its container how big it is before drawing anything, and the
 * observer the shared setup installs never answers, so the charts stay empty.
 * This one answers, so a test can read the labels the chart puts on screen.
 */
class SizedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    const contentRect = {
      width: 640,
      height: 256,
      top: 0,
      left: 0,
      bottom: 256,
      right: 640,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRectReadOnly;
    this.callback(
      [{ target, contentRect } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }

  unobserve() {}
  disconnect() {}
}

const unmeasuredResizeObserver = globalThis.ResizeObserver;

function measureCharts() {
  globalThis.ResizeObserver = SizedResizeObserver as unknown as typeof ResizeObserver;
}

afterEach(() => {
  globalThis.ResizeObserver = unmeasuredResizeObserver;
});

const axisLabels = (chart: HTMLElement, axis: "x" | "y") =>
  Array.from(
    chart.querySelectorAll(`.recharts-${axis}Axis .recharts-cartesian-axis-tick-value`),
  ).map((node) => node.textContent);

describe("dashboard", () => {
  describe("opening the page", () => {
    it("waits behind a spinner until the book has been read", async () => {
      const gate = backend().hold("load_dashboard");
      renderWithProviders(<DashboardPage />);

      expect(await screen.findByText("Reading your book")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Today at a glance" })).not.toBeInTheDocument();

      gate.release();

      expect(await screen.findByRole("heading", { name: "Today at a glance" })).toBeInTheDocument();
      expect(screen.queryByText("Reading your book")).not.toBeInTheDocument();
      expect(backend().countOf("load_dashboard")).toBe(1);
    });

    it("says so when the book will not open", async () => {
      backend().fail("load_dashboard", { kind: "internal", message: "The book would not open" });
      renderWithProviders(<DashboardPage />);

      await waitFor(() => expect(backend().countOf("load_dashboard")).toBe(1));

      // Named one at a time rather than by one loose pattern, which matches the
      // heading, the core's own words and the button alike.
      expect(await screen.findByText("Your book could not be read")).toBeInTheDocument();
      expect(screen.getByText("The book would not open")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    });
  });

  describe("an empty book", () => {
    it("offers both ways to fill it", async () => {
      backend().book.clients = [];
      backend().book.policies = [];
      renderWithProviders(<DashboardPage />);

      expect(await screen.findByText("No clients yet")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Import a spreadsheet" })).toHaveAttribute(
        "href",
        "/import",
      );
      expect(screen.getByRole("link", { name: "Add a client" })).toHaveAttribute("href", "/clients");

      expect(screen.queryByText("Expiring this week")).not.toBeInTheDocument();
      expect(screen.queryByText("Renewal pipeline")).not.toBeInTheDocument();
    });
  });

  describe("the headline tiles", () => {
    it("counts what expires this week and opens the renewals desk", async () => {
      renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      const thisWeek = expiringBetween(0, 7);
      const thisMonth = expiringBetween(0, 30);
      expect(thisWeek).toHaveLength(2);
      expect(thisMonth).toHaveLength(4);

      const expiring = tile("Expiring this week");
      expect(within(expiring).getByText(count(thisWeek.length))).toBeInTheDocument();
      expect(
        within(expiring).getByText(`${count(thisMonth.length)} within 30 days`),
      ).toBeInTheDocument();
      expect(expiring).toHaveClass("border-rose-200");
      expect(expiring.closest("a")).toHaveAttribute("href", "/renewals");
    });

    it("counts cover that has stopped and opens the lapsed list", async () => {
      renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      const lapsed = overduePolicies();
      expect(lapsed).toHaveLength(2);

      const stopped = tile("Unrenewed & expired");
      expect(within(stopped).getByText(count(lapsed.length))).toBeInTheDocument();
      expect(within(stopped).getByText("Cover has stopped for these clients")).toBeInTheDocument();
      expect(stopped).toHaveClass("border-amber-200");
      expect(stopped.closest("a")).toHaveAttribute("href", "/policies?view=lapsed");
    });

    it("turns both chasing tiles calm when there is nothing to chase", async () => {
      for (const policy of book().policies) {
        const days = daysLeft(policy);
        if (days < 0) policy.isRenewed = true;
        else if (days <= 7) policy.expiryDate = isoDaysFromToday(120);
      }
      renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      const expiring = tile("Expiring this week");
      const stopped = tile("Unrenewed & expired");
      expect(within(expiring).getByText("0")).toBeInTheDocument();
      expect(within(stopped).getByText("0")).toBeInTheDocument();
      expect(expiring).toHaveClass("border-emerald-200");
      expect(stopped).toHaveClass("border-emerald-200");
    });

    it("adds the premium up in compact rupees", async () => {
      renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      const active = activePolicies();
      const premium = total(active, "premiumAmount");
      expect(active).toHaveLength(11);
      // 2,50,300 rupees, written the way the compact Indian format writes it.
      expect(moneyCompact(premium)).toBe("₹2.5L");

      const managed = tile("Premium under management");
      expect(within(managed).getByText(moneyCompact(premium))).toBeInTheDocument();
      expect(
        within(managed).getByText(`${count(active.length)} active policies`),
      ).toBeInTheDocument();
      expect(managed).toHaveClass("border-brand-200");
      // Nothing to open behind this one, so it is not a link.
      expect(managed.closest("a")).toBeNull();
    });

    it("adds the commission up in compact rupees", async () => {
      renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      const commission = total(activePolicies(), "commissionExpected");
      expect(moneyCompact(commission)).toBe("₹27.2K");

      // Policyholders, not people: the family members the book holds as clients
      // are covered under somebody else and are not counted here.
      const clients = book().clients.filter((row) => !row.isArchived && !row.isDependent);
      expect(clients).toHaveLength(8);

      const expected = tile("Commission expected");
      expect(within(expected).getByText(moneyCompact(commission))).toBeInTheDocument();
      expect(
        within(expected).getByText(`${count(clients.length)} active clients`),
      ).toBeInTheDocument();
      expect(expected).toHaveClass("border-sky-200");
    });
  });

  describe("the renewal pipeline", () => {
    it("names every expiry bucket along the bottom", async () => {
      measureCharts();
      renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      const chart = card("Renewal pipeline");
      expect(axisLabels(chart, "x")).toEqual(expiryBuckets().map((bucket) => bucket.label));
      expect(axisLabels(chart, "x")).toEqual([
        "Overdue",
        "0-7 days",
        "8-15 days",
        "16-30 days",
        "31-60 days",
        "61-90 days",
      ]);
    });

    it("scales to the busiest bucket and marks the overdue one out in red", async () => {
      measureCharts();
      renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      const chart = card("Renewal pipeline");
      const buckets = expiryBuckets();
      const busiest = buckets.reduce((best, bucket) =>
        bucket.rows.length > best.rows.length ? bucket : best,
      );

      // The count axis has to reach the tallest bar for the chart to be readable.
      expect(axisLabels(chart, "y").at(-1)).toBe(count(busiest.rows.length));

      let bars: HTMLElement[] = [];
      await waitFor(() => {
        bars = Array.from(chart.querySelectorAll<HTMLElement>("path.recharts-rectangle"));
        expect(bars).toHaveLength(buckets.length);
      });

      const heights = bars.map((bar) => Number(bar.getAttribute("height")));
      expect(buckets[heights.indexOf(Math.max(...heights))].label).toBe(busiest.label);
      expect(bars[0].getAttribute("fill")).toBe("#f43f5e");
      expect(bars.slice(1).map((bar) => bar.getAttribute("fill"))).toEqual(
        Array(buckets.length - 1).fill("#0d9488"),
      );
    });

    it("keeps the chart's place even when nothing measures it", async () => {
      renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      // Left to the harness's own resize observer the container never gets a
      // size, so recharts draws nothing; only the frame is on the page.
      const chart = card("Renewal pipeline");
      expect(chart.querySelector(".recharts-responsive-container")).toBeInTheDocument();
      expect(within(chart).queryByText("Overdue")).not.toBeInTheDocument();
    });
  });

  describe("the category mix", () => {
    it("breaks the active book down by category", async () => {
      measureCharts();
      renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      const mix = card("Mix by category");
      const expected = activeByCategory();
      const rows = within(mix).getAllByRole("listitem");
      expect(rows).toHaveLength(expected.length);

      expected.forEach((entry, index) => {
        const row = within(rows[index]);
        expect(row.getByText(categoryLabel(entry.category))).toBeInTheDocument();
        expect(row.getByText(count(entry.rows.length))).toBeInTheDocument();
        expect(row.getByText(moneyCompact(total(entry.rows, "premiumAmount")))).toBeInTheDocument();
      });

      expect(rows.map((row) => row.textContent)).toEqual([
        "Health4₹1.2L",
        "Life2₹84K",
        "Motor3₹38.3K",
        "Travel / International1₹4.2K",
        "Personal Accident1₹6.4K",
      ]);
      expect(mix.querySelector(".recharts-pie")).toBeInTheDocument();
    });

    it("says when no policy is active", async () => {
      for (const policy of book().policies) policy.status = "expired";
      renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      const mix = card("Mix by category");
      expect(within(mix).getByText("No active policies")).toBeInTheDocument();
      expect(within(mix).queryAllByRole("listitem")).toHaveLength(0);
    });

    it("accounts for every category the book holds", async () => {
      book().policies[2].category = "home";
      book().policies[8].category = "critical_illness";
      book().policies[12].category = "other";
      renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      const mix = card("Mix by category");
      expect(activeByCategory()).toHaveLength(8);
      expect(within(mix).getAllByRole("listitem")).toHaveLength(8);
    });
  });

  describe("the next 45 days", () => {
    it("lists the renewals due, most urgent first", async () => {
      renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      const expected = expiringBetween(0, 45).sort((a, b) => daysLeft(a) - daysLeft(b));
      const rows = within(card("Next 45 days")).getAllByRole("listitem");
      expect(rows).toHaveLength(expected.length);

      expect(rows.map((row) => within(row).getByRole("link").textContent)).toEqual(
        expected.map((policy) => policy.clientName),
      );
      const wording = rows.map(
        (row) => within(row).getByText(/^(Today|Tomorrow|in \d+ days)$/).textContent,
      );
      expect(wording).toEqual(expected.map((policy) => relativeDays(daysLeft(policy))));
      expect(wording).toEqual([
        "in 3 days",
        "in 7 days",
        "in 15 days",
        "in 17 days",
        "in 32 days",
        "in 36 days",
      ]);

      const first = expected[0];
      expect(rows[0]).toHaveTextContent(first.policyNumber);
      expect(rows[0]).toHaveTextContent(first.insurerName);
      expect(rows[0]).toHaveTextContent(categoryLabel(first.category));
      expect(within(rows[0]).getByText(date(first.expiryDate))).toBeInTheDocument();
      expect(within(rows[0]).getByText("17 Aug 2026")).toBeInTheDocument();
    });

    it("says today and tomorrow rather than counting to one", async () => {
      const [first, second] = activePolicies();
      first.expiryDate = isoDaysFromToday(0);
      second.expiryDate = isoDaysFromToday(1);
      renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      const rows = within(card("Next 45 days")).getAllByRole("listitem");
      expect(within(rows[0]).getByText(relativeDays(0))).toHaveTextContent("Today");
      expect(within(rows[1]).getByText(relativeDays(1))).toHaveTextContent("Tomorrow");
    });

    it("colours each row by how close the expiry is", async () => {
      renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      const expected = expiringBetween(0, 45).sort((a, b) => daysLeft(a) - daysLeft(b));
      const rows = within(card("Next 45 days")).getAllByRole("listitem");

      expected.forEach((policy, index) => {
        const badge = within(rows[index]).getByText(relativeDays(daysLeft(policy)));
        // Fifteen days or less is a fire; anything up to 45 is a warning.
        expect(badge).toHaveClass(daysLeft(policy) <= 15 ? "text-rose-700" : "text-amber-700");
      });
    });

    it("opens the client behind a renewal", async () => {
      const { user } = renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      const soonest = expiringBetween(0, 45).sort((a, b) => daysLeft(a) - daysLeft(b))[0];
      const rows = within(card("Next 45 days")).getAllByRole("listitem");
      const link = within(rows[0]).getByRole("link");
      expect(link).toHaveAttribute("href", `/clients/${soonest.clientId}`);

      await user.click(link);
      expect(currentRoute()).toBe(`/clients/${soonest.clientId}`);
    });

    it("offers the renewals desk from the card itself", async () => {
      renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      expect(screen.getByRole("link", { name: "Open renewals" })).toHaveAttribute(
        "href",
        "/renewals",
      );
    });

    it("says when the next 45 days are clear", async () => {
      for (const policy of book().policies) {
        if (policy.status === "active" && daysLeft(policy) <= 45) {
          policy.expiryDate = isoDaysFromToday(200);
        }
      }
      renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      const upcoming = card("Next 45 days");
      expect(within(upcoming).getByText("Nothing expires in the next 45 days.")).toBeInTheDocument();
      expect(within(upcoming).queryAllByRole("listitem")).toHaveLength(0);
    });
  });

  describe("recently lapsed", () => {
    it("lists lapsed cover newest first, with the premium at risk", async () => {
      renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      const expected = overduePolicies().sort((a, b) => daysLeft(b) - daysLeft(a));
      const rows = within(card("Recently lapsed")).getAllByRole("listitem");
      expect(rows).toHaveLength(expected.length);

      expect(rows.map((row) => within(row).getByRole("link").textContent)).toEqual(
        expected.map((policy) => policy.clientName),
      );
      expected.forEach((policy, index) => {
        expect(rows[index]).toHaveTextContent(
          `${categoryLabel(policy.category)} · expired ${date(policy.expiryDate)}`,
        );
        expect(within(rows[index]).getByText(money(policy.premiumAmount))).toBeInTheDocument();
      });

      expect(rows[0]).toHaveTextContent("Motor · expired 09 Aug 2026");
      expect(within(rows[0]).getByText("₹9,600")).toBeInTheDocument();
      expect(rows[1]).toHaveTextContent("Health · expired 29 Jul 2026");
      expect(within(rows[1]).getByText("₹21,500")).toBeInTheDocument();
    });

    it("opens the client behind a lapse", async () => {
      const { user } = renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      const newest = overduePolicies().sort((a, b) => daysLeft(b) - daysLeft(a))[0];
      const rows = within(card("Recently lapsed")).getAllByRole("listitem");
      await user.click(within(rows[0]).getByRole("link"));

      expect(currentRoute()).toBe(`/clients/${newest.clientId}`);
    });

    it("reassures when everything has been renewed", async () => {
      for (const policy of overduePolicies()) policy.isRenewed = true;
      renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      const lapsed = card("Recently lapsed");
      expect(within(lapsed).getByText(/Everything current has been renewed/)).toBeInTheDocument();
      expect(within(lapsed).queryAllByRole("listitem")).toHaveLength(0);
    });
  });

  describe("clients with no email", () => {
    it("warns about the clients reminders cannot reach", async () => {
      renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      // A child with no email address is not a client the agency is failing to
      // reach, so the warning counts policyholders only.
      const missing = book().clients.filter((row) => !row.email && !row.isDependent);
      expect(missing).toHaveLength(1);

      const warning = screen.getByRole("link", { name: /no email address/ });
      expect(warning).toHaveAttribute("href", "/clients?missingEmail=1");
      expect(warning).toHaveTextContent("They will be skipped when reminders start going out.");
      expect(
        within(warning).getByText(new RegExp(`^${count(missing.length)} client`)),
      ).toBeInTheDocument();
    });

    it("counts a single client in the singular", async () => {
      renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      expect(screen.getByRole("link", { name: /no email address/ })).toHaveTextContent(
        "1 client has no email address.",
      );
    });

    it("keeps quiet when every client can be reached", async () => {
      for (const client of book().clients) client.email ??= "someone@example.com";
      renderWithProviders(<DashboardPage />);
      await screen.findByRole("heading", { name: "Today at a glance" });

      expect(screen.queryByText(/no email address/)).not.toBeInTheDocument();
    });
  });
});
