/**
 * The policies list: what it draws, what it asks the core for, and what the
 * controls above it do to that question.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  backend,
  currentRoute,
  fireEvent,
  renderApp,
  renderWithProviders,
  screen,
  tauriDialog,
  waitFor,
  within,
} from "@/test";
import { PoliciesPage } from "@/pages/Policies";
import type { PolicyFilter } from "@/lib/types";

/** The screen under test, on the route the sidebar sends an agent to. */
function open(route = "/policies") {
  return renderWithProviders(<PoliciesPage />, { route });
}

/** The filter the core was asked for last. */
function lastFilter(): PolicyFilter {
  return (backend().lastCall("list_policies")?.filter ?? {}) as PolicyFilter;
}

/** Policy numbers in the order the table draws them. */
function drawnPolicies(): string[] {
  return screen
    .queryAllByText(/^[A-Z]{2,4}\/[A-Z0-9/]+$/)
    .map((node) => node.textContent ?? "");
}

/** The row a policy number sits in. */
function rowFor(policyNumber: string): HTMLElement {
  return screen.getByText(policyNumber).closest("tr") as HTMLElement;
}

// The filter controls carry accessible names, so these reach them by name
// rather than by the position they happen to sit in.
function filterSelects() {
  return {
    category: screen.getByRole("combobox", { name: "Category" }),
    status: screen.getByRole("combobox", { name: "Status" }),
    insurer: screen.getByRole("combobox", { name: "Insurer" }),
  };
}

/** The expiry-between boxes, in the order they are read. */
function expiryBoxes(): HTMLInputElement[] {
  return [
    screen.getByLabelText<HTMLInputElement>("Expiry from"),
    screen.getByLabelText<HTMLInputElement>("Expiry to"),
  ];
}

/** Pads the book out past one page, keeping numbers and chains unique. */
function padBook(total: number) {
  const book = backend().book;
  const template = book.policies[0];
  let n = 0;
  while (book.policies.length < total) {
    n += 1;
    book.policies.push({
      ...template,
      id: 500 + n,
      chainId: `chain-pad-${n}`,
      policyYear: 1,
      previousPolicyId: null,
      policyNumber: `PAD/${String(n).padStart(3, "0")}`,
      isRenewed: false,
    });
  }
}

/**
 * Waits for the first page of rows. An empty search box asks nothing of its
 * own on arrival, so the rows landing is the whole of the first load and there
 * is no second, identical question to wait out.
 */
async function waitForRows() {
  await screen.findByText("SH/2025/0091823");
}

describe("the policies list", () => {
  it("draws a column for the client, policy, type, expiry, premium and status", async () => {
    open();
    await waitForRows();

    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Client",
      "Policy",
      "Type",
      "Expiry",
      "Premium",
      "Status",
      "",
    ]);

    const row = rowFor("SH/2025/0091823");
    expect(row).toHaveTextContent("Rohit Sharma");
    expect(row).toHaveTextContent("rohit.sharma@example.com");
    expect(row).toHaveTextContent("Star Health · Family Health Optima");
    expect(row).toHaveTextContent("Health");
    expect(row).toHaveTextContent("yr 2");
    expect(row).toHaveTextContent("21 Aug 2026");
    expect(row).toHaveTextContent("in 7 days");
    expect(row).toHaveTextContent("₹24,500");
    expect(row).toHaveTextContent("₹10,00,000 cover");
    expect(within(row).getByText("Active")).toBeInTheDocument();
  });

  it("asks for the first page by expiry, and shows every year in the book", async () => {
    open();
    await waitForRows();

    expect(lastFilter()).toMatchObject({ page: 1, pageSize: 25, sort: "expiry" });
    expect(drawnPolicies()).toHaveLength(17);
    // Oldest expiry first, superseded years included.
    expect(drawnPolicies()[0]).toBe("HE/OR/331885");
  });

  it("takes the term the global search put in the address on first load", async () => {
    open("/policies?q=Anita");

    expect(await screen.findByText("HE/OR/554120")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Policy number, client, vehicle")).toHaveValue("Anita");
    await waitFor(() => expect(lastFilter().search).toBe("Anita"));
    expect(screen.queryByText("SH/2025/0091823")).not.toBeInTheDocument();
  });

  it("starts on the chase list when the renewals desk asks for it", async () => {
    open("/policies?view=lapsed");

    await waitFor(() => expect(lastFilter().unrenewedOnly).toBe(true));
    expect(await screen.findByText("NIA/MOT/330912")).toBeInTheDocument();
    expect(drawnPolicies().sort()).toEqual(["NIA/MOT/330912", "SH/2024/0088410"]);
  });

  it("narrows the list as a search is typed", async () => {
    const { user } = open();
    await waitForRows();

    await user.type(screen.getByPlaceholderText("Policy number, client, vehicle"), "MH12");

    await waitFor(() => expect(lastFilter()).toMatchObject({ search: "MH12", page: 1 }));
    expect(await screen.findByText("IL/MOT/778211")).toBeInTheDocument();
    expect(drawnPolicies()).toEqual(["IL/MOT/778211"]);
  });

  it("filters by category", async () => {
    const { user } = open();
    await waitForRows();

    await user.selectOptions(filterSelects().category, "motor");

    await waitFor(() => expect(lastFilter()).toMatchObject({ categories: ["motor"], page: 1 }));
    await waitFor(() =>
      expect(drawnPolicies().sort()).toEqual([
        "BA/MOT/641203",
        "IL/MOT/778211",
        "IL/MOT/815540",
        "NIA/MOT/330912",
      ]),
    );
  });

  it("filters by status", async () => {
    const { user } = open();
    await waitForRows();

    await user.selectOptions(filterSelects().status, "expired");

    await waitFor(() => expect(lastFilter()).toMatchObject({ statuses: ["expired"] }));
    await waitFor(() =>
      expect(drawnPolicies().sort()).toEqual(["NIA/MOT/330912", "SH/2024/0088410"]),
    );
  });

  it("filters by insurer", async () => {
    const { user } = open();
    await waitForRows();

    await user.selectOptions(filterSelects().insurer, "5");

    await waitFor(() => expect(lastFilter()).toMatchObject({ insurerId: 5 }));
    await waitFor(() => expect(drawnPolicies()).toEqual(["NB/RA2/119006"]));
  });

  it("filters by a window of expiry dates", async () => {
    open();
    await waitForRows();

    const [from, to] = expiryBoxes();
    fireEvent.change(from, { target: { value: "2026-08-01" } });
    fireEvent.change(to, { target: { value: "2026-08-31" } });

    await waitFor(() =>
      expect(lastFilter()).toMatchObject({ expiryFrom: "2026-08-01", expiryTo: "2026-08-31" }),
    );
    await waitFor(() =>
      expect(drawnPolicies().sort()).toEqual([
        "HE/OR/554120",
        "IL/MOT/778211",
        "NB/RA2/119006",
        "NIA/MOT/330912",
        "SH/2025/0091823",
      ]),
    );
  });

  it("hides superseded years behind Latest year only", async () => {
    const { user } = open();
    await waitForRows();

    await user.click(screen.getByRole("checkbox", { name: "Latest year only" }));

    await waitFor(() => expect(lastFilter()).toMatchObject({ latestOnly: true }));
    await waitFor(() => expect(drawnPolicies()).toHaveLength(13));
    expect(screen.queryByText("HE/OR/331885")).not.toBeInTheDocument();
    expect(screen.getByText("HE/OR/554120")).toBeInTheDocument();
  });

  it("keeps only the unrenewed years behind Expired and never renewed", async () => {
    const { user } = open();
    await waitForRows();

    await user.click(screen.getByRole("checkbox", { name: "Expired and never renewed" }));

    await waitFor(() => expect(lastFilter()).toMatchObject({ unrenewedOnly: true }));
    await waitFor(() =>
      expect(drawnPolicies().sort()).toEqual(["NIA/MOT/330912", "SH/2024/0088410"]),
    );
  });

  it("puts every control back with Clear filters", async () => {
    // Starting from a search means the cleared question is one the screen has
    // not asked yet, so the core hears it rather than the cache answering.
    const { user } = open("/policies?q=Anita");
    await screen.findByText("HE/OR/554120");

    await user.selectOptions(filterSelects().category, "health");
    await user.selectOptions(filterSelects().status, "active");
    await user.selectOptions(filterSelects().insurer, "1");
    fireEvent.change(expiryBoxes()[0], { target: { value: "2026-08-01" } });
    await user.click(screen.getByRole("checkbox", { name: "Latest year only" }));
    await waitFor(() => expect(lastFilter().latestOnly).toBe(true));

    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() => {
      const filter = lastFilter();
      expect(filter.search ?? "").toBe("");
      expect(filter.categories).toBeUndefined();
      expect(filter.statuses).toBeUndefined();
      expect(filter.insurerId).toBeUndefined();
      expect(filter.expiryFrom).toBeUndefined();
      expect(filter.expiryTo).toBeUndefined();
      expect(filter.latestOnly).toBeUndefined();
      expect(filter.unrenewedOnly).toBeUndefined();
      expect(filter).toMatchObject({ page: 1, pageSize: 25, sort: "expiry" });
    });
    expect(screen.getByPlaceholderText("Policy number, client, vehicle")).toHaveValue("");
    expect(filterSelects().category).toHaveValue("");
    expect(expiryBoxes()[0]).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "Latest year only" })).not.toBeChecked();
    await waitFor(() => expect(drawnPolicies()).toHaveLength(17));
  });

  it("offers no control for the city, premium range or expiring-within filters the core accepts", async () => {
    // PolicyFilter carries city, minPremium, maxPremium and expiringWithinDays;
    // nothing on this screen can set them. See the report.
    open();
    await waitForRows();

    expect(screen.getAllByRole("combobox")).toHaveLength(3);
    expect(document.querySelectorAll('input[type="number"]')).toHaveLength(0);
    expect(lastFilter().city).toBeUndefined();
    expect(lastFilter().minPremium).toBeUndefined();
    expect(lastFilter().expiringWithinDays).toBeUndefined();
  });
});

describe("sorting the policies list", () => {
  const sortable: Array<[string, string]> = [
    ["Client", "client"],
    ["Policy", "policyNumber"],
    ["Type", "category"],
    ["Premium", "premium"],
  ];

  for (const [header, key] of sortable) {
    it(`sorts on ${header}, and reverses on a second click`, async () => {
      const { user } = open();
      await waitForRows();

      await user.click(screen.getByRole("columnheader", { name: header }));
      await waitFor(() => expect(lastFilter()).toMatchObject({ sort: key, descending: false }));

      await user.click(screen.getByRole("columnheader", { name: header }));
      await waitFor(() => expect(lastFilter()).toMatchObject({ sort: key, descending: true }));
    });
  }

  it("reverses the expiry order the list already starts on", async () => {
    const { user } = open();
    await waitForRows();

    await user.click(screen.getByRole("columnheader", { name: "Expiry" }));
    await waitFor(() => expect(lastFilter()).toMatchObject({ sort: "expiry", descending: true }));
    await waitFor(() => expect(drawnPolicies()[0]).toBe("LIC/915/661074"));

    await user.click(screen.getByRole("columnheader", { name: "Expiry" }));
    await waitFor(() => expect(lastFilter()).toMatchObject({ sort: "expiry", descending: false }));
    await waitFor(() => expect(drawnPolicies()[0]).toBe("HE/OR/331885"));
  });

  it("reorders the rows it draws", async () => {
    const { user } = open();
    await waitForRows();

    await user.click(screen.getByRole("columnheader", { name: "Premium" }));
    await waitFor(() => expect(drawnPolicies()[0]).toBe("TA/TG/908771"));

    await user.click(screen.getByRole("columnheader", { name: "Premium" }));
    await waitFor(() => expect(drawnPolicies()[0]).toBe("LIC/915/220481"));
  });

  it("leaves the unsortable columns alone", async () => {
    const { user } = open();
    await waitForRows();

    await user.click(screen.getByRole("columnheader", { name: "Status" }));

    await waitFor(() => expect(lastFilter()).toMatchObject({ sort: "expiry" }));
    expect(lastFilter().descending).toBeUndefined();
  });
});

describe("paging the policies list", () => {
  it("pages through the list, and says where it is", async () => {
    padBook(30);
    const { user } = open();
    await waitForRows();

    expect(await screen.findByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("1–25 of 30")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(lastFilter()).toMatchObject({ page: 2 }));
    expect(await screen.findByText("26–30 of 30")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("goes back to the first page when a filter changes", async () => {
    padBook(30);
    const { user } = open();
    await waitForRows();

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastFilter().page).toBe(2));

    await user.selectOptions(filterSelects().category, "motor");

    await waitFor(() => expect(lastFilter()).toMatchObject({ categories: ["motor"], page: 1 }));
  });

  it("goes back to the first page when the search changes", async () => {
    padBook(30);
    const { user } = open();
    await waitForRows();

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastFilter().page).toBe(2));

    await user.type(screen.getByPlaceholderText("Policy number, client, vehicle"), "Anita");

    await waitFor(() => expect(lastFilter()).toMatchObject({ search: "Anita", page: 1 }));
  });

  it("goes back to the first page when the sort changes", async () => {
    padBook(30);
    const { user } = open();
    await waitForRows();

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastFilter().page).toBe(2));

    await user.click(screen.getByRole("columnheader", { name: "Premium" }));

    await waitFor(() => expect(lastFilter()).toMatchObject({ sort: "premium", page: 1 }));
  });

  it("hides the pager when nothing matches", async () => {
    const { user } = open();
    await waitForRows();

    await user.type(screen.getByPlaceholderText("Policy number, client, vehicle"), "zzzz");

    expect(await screen.findByText("No policies match")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });
});

describe("the policies list with nothing to show", () => {
  it("says nothing matches when the filters exclude everything", async () => {
    const { user } = open();
    await waitForRows();

    await user.type(screen.getByPlaceholderText("Policy number, client, vehicle"), "zzzz");

    expect(await screen.findByText("No policies match")).toBeInTheDocument();
    expect(screen.getByText("Adjust the filters, or add a policy.")).toBeInTheDocument();
  });

  it("tells a new book to record its first policy", async () => {
    backend().book.policies = [];
    open();

    expect(await screen.findByText(/No policies yet/i)).toBeInTheDocument();
  });

  it("shows the pager only once there is something to page", async () => {
    backend().book.policies = [];
    open();

    // An unfiltered empty book is a new book, so it reads that way here.
    expect(await screen.findByText("No policies yet")).toBeInTheDocument();
    expect(screen.queryByText(/Page 1 of/)).not.toBeInTheDocument();
  });
});

describe("the policies list while it waits and when it breaks", () => {
  it("shows a spinner while the core is reading", async () => {
    const gate = backend().hold("list_policies");
    open();

    expect(await screen.findByText("Loading")).toBeInTheDocument();
    gate.release();
    await waitForRows();
    expect(screen.queryByText("Loading")).not.toBeInTheDocument();
  });

  it("says so when the list cannot be read", async () => {
    backend().fail("list_policies", { kind: "internal", message: "The book would not open" });
    open();

    expect(await screen.findByText("The book would not open")).toBeInTheDocument();
  });
});

describe("working a policy from the list", () => {
  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("opens an empty form from New policy", async () => {
    const { user } = open();
    await waitForRows();

    await user.click(screen.getByRole("button", { name: /New policy/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "New policy" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Policy number/)).toHaveValue("");
  });

  it("opens the policy that was clicked", async () => {
    const { user } = open();
    await waitForRows();

    await user.click(screen.getByText("SH/2025/0091823"));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Edit policy SH/2025/0091823" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Policy number/)).toHaveValue("SH/2025/0091823");
  });

  it("only navigates when the client's name is clicked", async () => {
    const { user } = open();
    await waitForRows();

    await user.click(screen.getAllByRole("link", { name: "Rohit Sharma" })[0]);

    expect(currentRoute()).toBe("/clients/1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("deletes a policy year after asking", async () => {
    const { user } = open();
    await waitForRows();

    await user.click(within(rowFor("SH/2025/0091823")).getByRole("button", { name: "Delete" }));

    expect(window.confirm).toHaveBeenCalledWith(
      "Delete policy SH/2025/0091823? This removes this policy year permanently.",
    );
    await waitFor(() => expect(backend().lastCall("delete_policy")).toEqual({ id: 1 }));
    expect(await screen.findByText("Policy deleted")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("SH/2025/0091823")).not.toBeInTheDocument());
  });

  it("keeps the policy when the asking is refused", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user } = open();
    await waitForRows();

    await user.click(within(rowFor("SH/2025/0091823")).getByRole("button", { name: "Delete" }));

    expect(backend().countOf("delete_policy")).toBe(0);
    expect(screen.getByText("SH/2025/0091823")).toBeInTheDocument();
  });

  it("reports a delete the core refuses", async () => {
    backend().fail("delete_policy", { kind: "conflict", message: "That year is referenced" });
    const { user } = open();
    await waitForRows();

    await user.click(within(rowFor("SH/2025/0091823")).getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("That year is referenced")).toBeInTheDocument();
    expect(screen.getByText("SH/2025/0091823")).toBeInTheDocument();
  });

  it("records a renewal from the row", async () => {
    const { user } = open();
    await waitForRows();

    await user.click(within(rowFor("SH/2025/0091823")).getByRole("button", { name: "Renew" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: /Renew Rohit Sharma's Health policy/ }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Record renewal" }));

    await waitFor(() =>
      expect(backend().lastCall("renew_policy")?.input).toMatchObject({
        policyId: 1,
        policyNumber: "SH/2025/0091823",
        startDate: "2026-08-22",
        expiryDate: "2027-08-21",
      }),
    );
    expect(await screen.findByText("Renewal recorded")).toBeInTheDocument();
  });

  it("does not offer to renew a year that has already been renewed", async () => {
    open();
    await waitForRows();

    expect(within(rowFor("HE/OR/331885")).queryByRole("button", { name: "Renew" })).toBeNull();
  });

  it("still offers to renew a cancelled policy", async () => {
    // Cancelling ends a year early; it does not decide that the client is gone.
    // The renewals desk leaves a cancelled policy alone, so the row is the only
    // place left to write next year from when they come back.
    backend().book.policies[0].status = "cancelled";
    open();
    await waitForRows();

    expect(
      within(rowFor("SH/2025/0091823")).getByRole("button", { name: "Renew" }),
    ).toBeInTheDocument();
  });

  it("keeps a cancelled year saying cancelled after it is renewed", async () => {
    // The record of a cancellation is the whole point of it: renewing the year
    // the client came back from must not write over what they did last year.
    backend().book.policies[0].status = "cancelled";
    const { user } = open();
    await waitForRows();

    await user.click(within(rowFor("SH/2025/0091823")).getByRole("button", { name: "Renew" }));
    const dialog = await screen.findByRole("dialog");
    const number = within(dialog).getByLabelText(/New policy number/);
    await user.clear(number);
    await user.type(number, "SH/2026/0091823");
    await user.click(within(dialog).getByRole("button", { name: "Record renewal" }));
    await screen.findByText("Renewal recorded");

    const row = await waitFor(() => rowFor("SH/2025/0091823"));
    expect(within(row).getByText("Cancelled")).toBeInTheDocument();
    // And it cannot be renewed a second time into a forked chain.
    expect(within(row).queryByRole("button", { name: "Renew" })).toBeNull();
  });

  it("shows the history of a chain", async () => {
    const { user } = open();
    await waitForRows();

    await user.click(within(rowFor("HE/OR/554120")).getByRole("button", { name: "History" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Anita Desai — policy history" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Year 1 · HE\/OR\/331885/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Year 3 · HE\/OR\/554120/)).toBeInTheDocument();
  });

  it("can mark a policy cancelled", async () => {
    const { user } = open();
    await waitForRows();

    await user.click(screen.getByText("SH/2025/0091823"));
    const dialog = await screen.findByRole("dialog");

    await user.selectOptions(within(dialog).getByLabelText(/Status/), "cancelled");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(backend().lastCall("update_policy")?.input).toMatchObject({ status: "cancelled" }),
    );
  });
});

describe("exporting the policies list", () => {
  it("exports whatever the filters show, to the chosen file", async () => {
    tauriDialog.save.mockResolvedValue("/tmp/motor.xlsx");
    const { user } = open();
    await waitForRows();

    await user.selectOptions(filterSelects().category, "motor");
    await waitFor(() => expect(lastFilter().categories).toEqual(["motor"]));

    await user.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(backend().countOf("export_policies")).toBe(1));
    expect(tauriDialog.save).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Export policies", defaultPath: "policies.xlsx" }),
    );
    const call = backend().lastCall("export_policies");
    expect(call?.path).toBe("/tmp/motor.xlsx");
    expect(call?.filter).toEqual(lastFilter());
    expect(await screen.findByText("Exported 4 policies")).toBeInTheDocument();
  });

  it("exports nothing when the picker is cancelled", async () => {
    tauriDialog.save.mockResolvedValue(null);
    const { user } = open();
    await waitForRows();

    await user.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => expect(tauriDialog.save).toHaveBeenCalledTimes(1));
    expect(backend().countOf("export_policies")).toBe(0);
    expect(screen.queryByText(/Exported/)).not.toBeInTheDocument();
  });

  it("reports an export the core refuses", async () => {
    tauriDialog.save.mockResolvedValue("/tmp/policies.xlsx");
    backend().fail("export_policies", { kind: "internal", message: "That folder is read only" });
    const { user } = open();
    await waitForRows();

    await user.click(screen.getByRole("button", { name: "Export" }));

    expect(await screen.findByText("That folder is read only")).toBeInTheDocument();
  });
});

describe("the policies list inside the whole app", () => {
  it("picks up a later search from the global box", async () => {
    const { user } = renderApp({ route: "/policies" });
    await waitForRows();

    const box = screen.getByPlaceholderText("Search clients, policy numbers, vehicles…");
    await user.type(box, "Anita{Enter}");

    expect(currentRoute()).toBe("/policies?q=Anita");
    await waitFor(() => expect(lastFilter().search).toBe("Anita"));
    expect(screen.queryByText("SH/2025/0091823")).not.toBeInTheDocument();
  });
});
