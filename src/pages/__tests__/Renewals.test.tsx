/**
 * The renewals desk. Every window is checked against the book rather than a
 * number typed into the test, so a change to the fixtures moves the
 * expectations with it.
 */

import { describe, expect, it, vi } from "vitest";

import {
  backend,
  daysUntil,
  isoDaysFromToday,
  renderApp,
  renderWithProviders,
  screen,
  tauriDialog,
  waitFor,
  within,
} from "@/test";
import { RenewalsPage } from "@/pages/Renewals";
import type { Policy, PolicyFilter } from "@/lib/types";

/** What the book says a window holds: active cover stopping inside it. */
function expiringWithin(days: number): Policy[] {
  return backend().book.policies.filter(
    (row) =>
      row.status === "active" && daysUntil(row.expiryDate) >= 0 && daysUntil(row.expiryDate) <= days,
  );
}

/** What the book says is overdue: cover that stopped with nothing after it. */
function overdue(): Policy[] {
  return backend().book.policies.filter(
    (row) => !row.isRenewed && row.status !== "cancelled" && daysUntil(row.expiryDate) < 0,
  );
}

/** The filter behind the list itself. The tab counts ask for a page of one. */
function listFilter(): PolicyFilter | undefined {
  return backend()
    .callsTo("list_policies")
    .map((call) => call.args.filter as PolicyFilter)
    .filter((filter) => filter.pageSize === 25)
    .at(-1);
}

function tabButton(label: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${label}`) });
}

function rowFor(policyNumber: string): HTMLElement {
  return within(screen.getByRole("table")).getByText(policyNumber).closest("tr")!;
}

/** The policy numbers on screen, in the order the desk drew them. */
function listedPolicyNumbers(): string[] {
  const known = backend().book.policies.map((row) => row.policyNumber);
  return within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((row) => known.find((number) => row.textContent?.includes(number)) ?? "");
}

/** Enough cover expiring in three weeks to push the list onto a second page. */
function fillWindow(rows: number): void {
  const template = backend().book.policies.find((row) => row.id === 1)!;
  for (let index = 0; index < rows; index += 1) {
    backend().book.policies.push({
      ...template,
      id: 900 + index,
      chainId: `chain-bulk-${index}`,
      policyYear: 1,
      previousPolicyId: null,
      policyNumber: `BULK/${String(index).padStart(3, "0")}`,
      status: "active",
      isRenewed: false,
      expiryDate: isoDaysFromToday(20),
    });
  }
}

/** Cover that stopped two days ago while the book still calls it active. */
function addLapsedButActive(): void {
  backend().book.policies.push({
    ...backend().book.policies[0],
    id: 900,
    chainId: "chain-stale",
    policyNumber: "STALE/001",
    policyYear: 1,
    previousPolicyId: null,
    status: "active",
    isRenewed: false,
    expiryDate: isoDaysFromToday(-2),
  });
}

/** jsdom has no clipboard, so Copy emails writes to a spy instead. */
function stubClipboard() {
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

describe("the renewals desk", () => {
  it("opens on the month ahead", async () => {
    renderWithProviders(<RenewalsPage />);

    expect(await screen.findByRole("heading", { name: "Renewals" })).toBeInTheDocument();
    await waitFor(() => {
      expect(listedPolicyNumbers()).toHaveLength(expiringWithin(30).length);
    });
    expect(listFilter()).toEqual({
      expiringWithinDays: 30,
      statuses: ["active"],
      sort: "expiry",
      descending: false,
      page: 1,
      pageSize: 25,
    });
  });

  it("orders the month by how soon cover stops", async () => {
    renderWithProviders(<RenewalsPage />);

    const soonestFirst = [...expiringWithin(30)]
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))
      .map((row) => row.policyNumber);
    await waitFor(() => expect(listedPolicyNumbers()).toEqual(soonestFirst));
  });

  it("counts every window on its tab", async () => {
    renderWithProviders(<RenewalsPage />);

    const expected: Array<[string, number]> = [
      ["Overdue", overdue().length],
      ["Next 7 days", expiringWithin(7).length],
      ["Next 30 days", expiringWithin(30).length],
      ["Next 60 days", expiringWithin(60).length],
      ["Next 90 days", expiringWithin(90).length],
    ];

    for (const [label, total] of expected) {
      await waitFor(() => {
        expect(within(tabButton(label)).getByText(String(total))).toBeInTheDocument();
      });
    }
  });

  it("asks for a narrower window when the tab changes", async () => {
    const { user } = renderWithProviders(<RenewalsPage />);
    await screen.findByRole("table");

    await user.click(tabButton("Next 7 days"));

    await waitFor(() => {
      expect(listFilter()).toMatchObject({ expiringWithinDays: 7, statuses: ["active"] });
    });
    await waitFor(() => {
      expect(listedPolicyNumbers()).toEqual(
        [...expiringWithin(7)]
          .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))
          .map((row) => row.policyNumber),
      );
    });
  });

  it("asks for unrenewed cover on the overdue tab", async () => {
    const { user } = renderWithProviders(<RenewalsPage />);
    await screen.findByRole("table");

    await user.click(tabButton("Overdue"));

    await waitFor(() => {
      expect(listFilter()).toMatchObject({ unrenewedOnly: true });
    });
    // The window is dropped entirely rather than widened, so nothing current leaks in.
    expect(listFilter()?.expiringWithinDays).toBeUndefined();
    await waitFor(() => {
      expect(listedPolicyNumbers().sort()).toEqual(overdue().map((row) => row.policyNumber).sort());
    });
  });

  it("sorts by a column heading, and turns the order round on a second press", async () => {
    const { user } = renderWithProviders(<RenewalsPage />);
    await screen.findByRole("table");

    const byPremium = [...expiringWithin(30)].sort(
      (a, b) => (a.premiumAmount ?? 0) - (b.premiumAmount ?? 0),
    );

    await user.click(screen.getByRole("columnheader", { name: /Premium/ }));
    await waitFor(() => expect(listFilter()).toMatchObject({ sort: "premium", descending: false }));
    await waitFor(() => {
      expect(listedPolicyNumbers()[0]).toBe(byPremium[0].policyNumber);
    });

    await user.click(screen.getByRole("columnheader", { name: /Premium/ }));
    await waitFor(() => expect(listFilter()).toMatchObject({ sort: "premium", descending: true }));
    await waitFor(() => {
      expect(listedPolicyNumbers()[0]).toBe(byPremium.at(-1)!.policyNumber);
    });
  });

  it("pages a long list twenty-five at a time", async () => {
    fillWindow(30);
    const total = expiringWithin(30).length;
    const { user } = renderWithProviders(<RenewalsPage />);

    await waitFor(() => expect(listedPolicyNumbers()).toHaveLength(25));
    expect(screen.getByText(`1–25 of ${total}`)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(listFilter()).toMatchObject({ page: 2 }));
    await waitFor(() => expect(listedPolicyNumbers()).toHaveLength(total - 25));
    expect(screen.getByText(`26–${total} of ${total}`)).toBeInTheDocument();
  });

  it("returns to the first page when the window changes", async () => {
    fillWindow(30);
    const { user } = renderWithProviders(<RenewalsPage />);

    await waitFor(() => expect(listedPolicyNumbers()).toHaveLength(25));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(listFilter()).toMatchObject({ page: 2 }));

    await user.click(tabButton("Next 90 days"));

    await waitFor(() => {
      expect(listFilter()).toMatchObject({ expiringWithinDays: 90, page: 1 });
    });
  });

  it("returns to the first page when the order changes", async () => {
    fillWindow(30);
    const { user } = renderWithProviders(<RenewalsPage />);

    await waitFor(() => expect(listedPolicyNumbers()).toHaveLength(25));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(listFilter()).toMatchObject({ page: 2 }));

    await user.click(screen.getByRole("columnheader", { name: /Premium/ }));

    await waitFor(() => expect(listFilter()).toMatchObject({ sort: "premium", page: 1 }));
  });

  it("opens the renew dialog on its own, not the policy form behind it", async () => {
    const target = expiringWithin(30)[0].policyNumber;
    const { user } = renderWithProviders(<RenewalsPage />);
    await screen.findByRole("table");

    await user.click(within(rowFor(target)).getByRole("button", { name: "Renew" }));

    const dialogs = await screen.findAllByRole("dialog");
    expect(dialogs).toHaveLength(1);
    expect(within(dialogs[0]).getByRole("button", { name: "Record renewal" })).toBeInTheDocument();
  });

  it("takes a policy off the list once it is renewed", async () => {
    const expiring = expiringWithin(30);
    const target = expiring[0].policyNumber;
    const { user } = renderWithProviders(<RenewalsPage />);
    await waitFor(() => expect(listedPolicyNumbers()).toHaveLength(expiring.length));

    await user.click(within(rowFor(target)).getByRole("button", { name: "Renew" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Record renewal" }));

    expect(await screen.findByText("Renewal recorded")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => {
      expect(listedPolicyNumbers()).toHaveLength(expiring.length - 1);
    });
    expect(within(screen.getByRole("table")).queryByText(target)).not.toBeInTheDocument();
  });

  it("clears a lapsed policy off the overdue tab when it is renewed", async () => {
    const lapsed = overdue();
    const { user } = renderWithProviders(<RenewalsPage />);
    await screen.findByRole("table");

    await user.click(tabButton("Overdue"));
    await waitFor(() => expect(listedPolicyNumbers()).toHaveLength(lapsed.length));

    await user.click(within(rowFor(lapsed[0].policyNumber)).getByRole("button", { name: "Renew" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Record renewal" }));

    await screen.findByText("Renewal recorded");
    await waitFor(() => {
      expect(listedPolicyNumbers()).toHaveLength(lapsed.length - 1);
    });
  });

  it("counts the windows again after a renewal", async () => {
    const before = expiringWithin(30).length;
    const target = expiringWithin(30)[0].policyNumber;
    const { user } = renderWithProviders(<RenewalsPage />);
    await waitFor(() => expect(listedPolicyNumbers()).toHaveLength(before));

    await user.click(within(rowFor(target)).getByRole("button", { name: "Renew" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Record renewal" }));
    await screen.findByText("Renewal recorded");

    await waitFor(() => {
      expect(within(tabButton("Next 30 days")).getByText(String(before - 1))).toBeInTheDocument();
    });
  });

  it("recalculates the statuses against today", async () => {
    const { user } = renderWithProviders(<RenewalsPage />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: /Recalculate/ }));

    await waitFor(() => expect(backend().countOf("refresh_statuses")).toBe(1));
    expect(await screen.findByText(/recalculated/i)).toBeInTheDocument();
  });

  it("says how many statuses moved on", async () => {
    addLapsedButActive();
    const { user } = renderWithProviders(<RenewalsPage />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: /Recalculate/ }));

    // The selector keeps this on the toast rather than the button that raised it.
    const toast = await screen.findByText(/recalculat/i, { selector: "span" });
    expect(toast).toHaveTextContent("1");
  });

  it("shows the recalculated status on the list", async () => {
    addLapsedButActive();
    const { user } = renderWithProviders(<RenewalsPage />);
    await screen.findByRole("table");
    await user.click(tabButton("Overdue"));
    await waitFor(() => expect(within(rowFor("STALE/001")).getByText("Active")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Recalculate/ }));
    await waitFor(() => expect(backend().countOf("refresh_statuses")).toBe(1));

    await waitFor(() => {
      expect(within(rowFor("STALE/001")).getByText("Expired")).toBeInTheDocument();
    });
  });

  it("shows the earlier years behind a policy when it is renewed", async () => {
    const chain = backend().book.policies.filter((row) => row.chainId === "chain-c");
    const current = chain.find((row) => row.status === "active")!;
    const { user } = renderWithProviders(<RenewalsPage />);
    await screen.findByRole("table");

    await user.click(within(rowFor(current.policyNumber)).getByRole("button", { name: "Renew" }));

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("History")).toBeInTheDocument();
    await waitFor(() => {
      expect(backend().lastCall("policy_chain")).toEqual({ id: current.id });
    });
    for (const year of chain) {
      expect(within(dialog).getByText(new RegExp(`^Year ${year.policyYear} ·`))).toBeInTheDocument();
    }
  });

  it("exports the window on show", async () => {
    tauriDialog.save.mockResolvedValue("/tmp/renewals.xlsx");
    const { user } = renderWithProviders(<RenewalsPage />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: /Export/ }));

    await waitFor(() => expect(backend().countOf("export_policies")).toBe(1));
    expect(tauriDialog.save).toHaveBeenCalledWith({
      title: "Export renewal list",
      defaultPath: "renewals-30.xlsx",
      filters: [
        { name: "Excel", extensions: ["xlsx"] },
        { name: "CSV", extensions: ["csv"] },
      ],
    });
    const call = backend().lastCall("export_policies");
    expect(call?.path).toBe("/tmp/renewals.xlsx");
    expect(call?.filter).toMatchObject({ expiringWithinDays: 30, statuses: ["active"] });
    expect(
      await screen.findByText(`Exported ${expiringWithin(30).length} rows`),
    ).toBeInTheDocument();
  });

  it("exports the overdue list under its own name", async () => {
    tauriDialog.save.mockResolvedValue("/tmp/overdue.xlsx");
    const { user } = renderWithProviders(<RenewalsPage />);
    await screen.findByRole("table");
    await user.click(tabButton("Overdue"));
    await waitFor(() => expect(listedPolicyNumbers()).toHaveLength(overdue().length));

    await user.click(screen.getByRole("button", { name: /Export/ }));

    await waitFor(() => expect(backend().countOf("export_policies")).toBe(1));
    expect(tauriDialog.save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "renewals-overdue.xlsx" }),
    );
    expect(backend().lastCall("export_policies")?.filter).toMatchObject({ unrenewedOnly: true });
  });

  it("writes nothing when the save dialog is cancelled", async () => {
    tauriDialog.save.mockResolvedValue(null);
    const { user } = renderWithProviders(<RenewalsPage />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: /Export/ }));

    await waitFor(() => expect(tauriDialog.save).toHaveBeenCalled());
    expect(backend().countOf("export_policies")).toBe(0);
    expect(screen.queryByText(/Exported/)).not.toBeInTheDocument();
  });

  it("reports an export that fails", async () => {
    tauriDialog.save.mockResolvedValue("/tmp/renewals.xlsx");
    backend().fail("export_policies", { kind: "internal", message: "The file is open in Excel" });
    const { user } = renderWithProviders(<RenewalsPage />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: /Export/ }));

    expect(await screen.findByText("The file is open in Excel")).toBeInTheDocument();
  });

  it("copies one address per client, leaving out anyone opted out", async () => {
    const { user } = renderWithProviders(<RenewalsPage />);
    await screen.findByRole("table");
    const writeText = stubClipboard();

    await user.click(tabButton("Next 90 days"));
    await waitFor(() => expect(listedPolicyNumbers()).toHaveLength(expiringWithin(90).length));
    await user.click(screen.getByRole("button", { name: /Copy emails/ }));

    const wanted = new Set(
      expiringWithin(90)
        .filter((row) => row.clientEmail && !row.remindersOptedOut)
        .map((row) => row.clientEmail as string),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0].split(", ");
    expect(copied.sort()).toEqual([...wanted].sort());
    const optedOut = expiringWithin(90).find((row) => row.remindersOptedOut);
    expect(copied).not.toContain(optedOut?.clientEmail);
    expect(await screen.findByText(`Copied ${wanted.size} email addresses`)).toBeInTheDocument();
  });

  it("says so when the list has no addresses to copy", async () => {
    const { user } = renderWithProviders(<RenewalsPage />);
    await screen.findByRole("table");
    const writeText = stubClipboard();

    await user.click(tabButton("Overdue"));
    await waitFor(() => expect(listedPolicyNumbers()).toHaveLength(overdue().length));
    await user.click(screen.getByRole("button", { name: /Copy emails/ }));

    expect(await screen.findByText("No email addresses in this list")).toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("says the window is quiet when nothing expires in it", async () => {
    backend().book.policies = [];
    renderWithProviders(<RenewalsPage />);

    expect(await screen.findByText("Nothing expires in this window")).toBeInTheDocument();
    expect(screen.getByText("Check a wider window, or enjoy the quiet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("says nothing has lapsed when the overdue tab is clear", async () => {
    backend().book.policies = backend().book.policies.filter(
      (row) => daysUntil(row.expiryDate) >= 0,
    );
    const { user } = renderWithProviders(<RenewalsPage />);
    await screen.findByRole("table");

    await user.click(tabButton("Overdue"));

    expect(await screen.findByText("Nothing has lapsed")).toBeInTheDocument();
    expect(
      screen.getByText("Every expired policy has been renewed or closed off."),
    ).toBeInTheDocument();
  });

  it("waits with a spinner while the list loads", async () => {
    renderWithProviders(<RenewalsPage />);

    expect(screen.getByText("Loading")).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByText("Loading")).not.toBeInTheDocument());
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("says so when the list will not load", async () => {
    backend().fail("list_policies", { kind: "internal", message: "The book would not open" });
    renderWithProviders(<RenewalsPage />);

    await waitFor(() => expect(backend().countOf("list_policies")).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByText("Loading")).not.toBeInTheDocument());
    expect(screen.queryByText("Nothing expires in this window")).not.toBeInTheDocument();
  });

  // RenewModal stays mounted with its form state when the desk closes it, so
  // this guards the reset that runs as the row goes away and comes back.
  it("opens a second time on the policy's own figures", async () => {
    const target = expiringWithin(30)[0];
    const { user } = renderWithProviders(<RenewalsPage />);
    await screen.findByRole("table");

    await user.click(within(rowFor(target.policyNumber)).getByRole("button", { name: "Renew" }));
    const premium = within(await screen.findByRole("dialog")).getByLabelText(/^Premium/);
    await user.clear(premium);
    await user.type(premium, "99999");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(within(rowFor(target.policyNumber)).getByRole("button", { name: "Renew" }));

    const reopened = within(await screen.findByRole("dialog")).getByLabelText(/^Premium/);
    expect(reopened).toHaveValue(target.premiumAmount);
  });
});

describe("the desk and the sidebar", () => {
  it("counts the month the same way as the sidebar badge", async () => {
    renderApp({ route: "/renewals" });
    const expected = String(expiringWithin(30).length);

    const nav = await screen.findByRole("link", { name: /Renewals/ });
    await waitFor(() => expect(within(nav).getByText(expected)).toBeInTheDocument());
    await waitFor(() => {
      expect(within(tabButton("Next 30 days")).getByText(expected)).toBeInTheDocument();
    });
  });

  it("keeps agreeing with the sidebar badge after a renewal", async () => {
    const before = expiringWithin(30).length;
    const target = expiringWithin(30)[0].policyNumber;
    const { user } = renderApp({ route: "/renewals" });
    await waitFor(() => expect(listedPolicyNumbers()).toHaveLength(before));

    await user.click(within(rowFor(target)).getByRole("button", { name: "Renew" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Record renewal" }));
    await screen.findByText("Renewal recorded");

    const nav = await screen.findByRole("link", { name: /Renewals/ });
    await waitFor(() => expect(within(nav).getByText(String(before - 1))).toBeInTheDocument());
    expect(within(tabButton("Next 30 days")).getByText(String(before - 1))).toBeInTheDocument();
  });
});
