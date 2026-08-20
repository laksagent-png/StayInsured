/**
 * The clients list: what it draws, what it asks the core for, and what the
 * buttons on a row do.
 */

import { describe, expect, it } from "vitest";

import {
  backend,
  currentRoute,
  renderWithProviders,
  screen,
  settle,
  tauriDialog,
  waitFor,
  within,
} from "@/test";
import type { Client, ClientFilter } from "@/lib/types";
import { ClientsPage } from "@/pages/Clients";

/** The filter the list last asked the core for. */
function lastFilter(): ClientFilter | undefined {
  return backend().lastCall("list_clients")?.filter as ClientFilter | undefined;
}

/** Every client name on screen, in the order the table shows them. */
function names(): string[] {
  return screen.queryAllByRole("link").map((link) => link.textContent ?? "");
}

function searchBox(): HTMLElement {
  return screen.getByPlaceholderText("Name, phone, email, code or PAN");
}

/** The two dropdowns above the table, each asked for by name. */
function filterSelects(): { city: HTMLElement; policyType: HTMLElement } {
  return {
    city: screen.getByRole("combobox", { name: "City" }),
    policyType: screen.getByRole("combobox", { name: "Policy type" }),
  };
}

function row(name: string | RegExp): HTMLElement {
  return screen.getByRole("row", { name });
}

/** A book with enough clients to page through. */
function manyClients(total: number): Client[] {
  const template = backend().book.clients[0];
  return Array.from({ length: total }, (_, index) => ({
    ...template,
    id: 500 + index,
    clientCode: `CL-${String(index + 1).padStart(5, "0")}`,
    fullName: `Client ${String(index + 1).padStart(2, "0")}`,
    email: `client${index + 1}@example.com`,
  }));
}

describe("the clients list", () => {
  it("draws a row for every client in the book", async () => {
    renderWithProviders(<ClientsPage />);

    expect(await screen.findByText("Rohit Sharma")).toBeInTheDocument();
    expect(screen.getByText("8 in the book")).toBeInTheDocument();
    expect(names()).toHaveLength(8);

    for (const header of ["Client", "Contact", "Policies", "Next expiry"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
    }
  });

  it("shows the code, city, contact details, policy counts and next expiry on a row", async () => {
    renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    const rohit = within(row(/Rohit Sharma/));
    expect(rohit.getByText("CL-00001 · Pune")).toBeInTheDocument();
    expect(rohit.getByText("rohit.sharma@example.com")).toBeInTheDocument();
    expect(rohit.getByText("98765 43210")).toBeInTheDocument();
    expect(rohit.getByText("2")).toBeInTheDocument();
    expect(rohit.getByText("/ 3")).toBeInTheDocument();
    expect(rohit.getByText("21 Aug 2026")).toBeInTheDocument();
  });

  it("warns on a client who cannot be emailed", async () => {
    renderWithProviders(<ClientsPage />);
    await screen.findByText("Vikram Patel");

    expect(within(row(/Vikram Patel/)).getByText("No email")).toBeInTheDocument();
  });

  it("marks a client who asked not to be emailed", async () => {
    renderWithProviders(<ClientsPage />);
    await screen.findByText("Kavita Joshi");

    expect(within(row(/Kavita Joshi/)).getByText("No reminders")).toBeInTheDocument();
  });

  it("shows an em dash where a client has no phone and no expiry", async () => {
    backend().book.clients[2].phone = null;
    renderWithProviders(<ClientsPage />);
    await screen.findByText("Vikram Patel");

    // Vikram holds nothing active, so both his phone and his next expiry are blank.
    expect(within(row(/Vikram Patel/)).getAllByText("—")).toHaveLength(2);
  });
});

describe("searching the clients list", () => {
  it("sends what was typed and narrows the rows to the matches", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.type(searchBox(), "Anita");

    await waitFor(() => expect(lastFilter()).toMatchObject({ search: "Anita" }));
    expect(await screen.findByText("Anita Desai")).toBeInTheDocument();
    await waitFor(() => expect(names()).toEqual(["Anita Desai"]));
  });

  it("matches on a phone number, a code and a PAN as well as a name", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.type(searchBox(), "AWXPP4432M");

    await waitFor(() => expect(names()).toEqual(["Vikram Patel"]));
  });

  it("asks the core once for a burst of typing", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");
    await settle();
    backend().clearCalls();

    await user.type(searchBox(), "Anita");

    await waitFor(() => expect(lastFilter()).toMatchObject({ search: "Anita" }));
    expect(backend().countOf("list_clients")).toBe(1);
  });

  it("puts every client back when the box is emptied", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.type(searchBox(), "Anita");
    await waitFor(() => expect(names()).toEqual(["Anita Desai"]));
    await user.clear(searchBox());

    await waitFor(() => expect(names()).toHaveLength(8));
  });

  it("drops the search from the filter when the box is emptied", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.type(searchBox(), "Anita");
    await waitFor(() => expect(lastFilter()).toMatchObject({ search: "Anita" }));
    await user.clear(searchBox());

    await waitFor(() => expect(names()).toHaveLength(8));
    expect(lastFilter()?.search).toBeUndefined();
  });

  it("loads the list once when the screen opens", async () => {
    renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");
    await settle();

    expect(backend().countOf("list_clients")).toBe(1);
  });

  it("says nothing matched, and offers a way out", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.type(searchBox(), "zzzz");

    expect(await screen.findByText("No clients match")).toBeInTheDocument();
    expect(screen.getByText(/Try clearing the filters/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("filtering the clients list", () => {
  it("narrows to one city", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.selectOptions(filterSelects().city, "Pune");

    await waitFor(() => expect(lastFilter()).toMatchObject({ city: "Pune", page: 1 }));
    await waitFor(() => expect(names()).toEqual(["Anita Desai", "Rohit Sharma"]));
    expect(screen.getByText("2 in the book")).toBeInTheDocument();
  });

  it("offers every city in the book", async () => {
    renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await waitFor(() =>
      expect(within(filterSelects().city).getAllByRole("option").map((o) => o.textContent)).toEqual(
        [
          "All cities",
          "Ahmedabad",
          "Bengaluru",
          "Chennai",
          "Hyderabad",
          "Kochi",
          "Nashik",
          "Pune",
        ],
      ),
    );
  });

  it("narrows to clients holding a kind of cover", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");
    await waitFor(() =>
      expect(within(filterSelects().policyType).getAllByRole("option").length).toBeGreaterThan(1),
    );

    await user.selectOptions(filterSelects().policyType, "motor");

    await waitFor(() => expect(lastFilter()).toMatchObject({ category: "motor", page: 1 }));
    await waitFor(() =>
      expect(names()).toEqual(["Arjun Reddy", "Priya Menon", "Rohit Sharma", "Vikram Patel"]),
    );
  });

  it("narrows to clients with no email", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.click(screen.getByRole("checkbox", { name: /Missing email/ }));

    await waitFor(() => expect(lastFilter()).toMatchObject({ missingEmail: true, page: 1 }));
    await waitFor(() => expect(names()).toEqual(["Vikram Patel"]));
  });

  it("starts on missing email when the dashboard sends you here", async () => {
    renderWithProviders(<ClientsPage />, { route: "/clients?missingEmail=1" });

    await waitFor(() => expect(lastFilter()).toMatchObject({ missingEmail: true }));
    expect(screen.getByRole("checkbox", { name: /Missing email/ })).toBeChecked();
    await waitFor(() => expect(names()).toEqual(["Vikram Patel"]));
  });

  it("hides archived clients until they are asked for", async () => {
    backend().book.clients[7].isArchived = true;
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await waitFor(() => expect(names()).toHaveLength(7));
    expect(screen.queryByText("Kavita Joshi")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /Include archived/ }));

    await waitFor(() => expect(lastFilter()).toMatchObject({ includeArchived: true, page: 1 }));
    expect(await screen.findByText("Kavita Joshi")).toBeInTheDocument();
    expect(within(row(/Kavita Joshi/)).getByText("Archived")).toBeInTheDocument();
  });

  it("browses the policyholders, and shows the family when asked", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await waitFor(() => expect(names()).toHaveLength(8));
    expect(screen.queryByText("Aarav Sharma")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /Include family members/ }));

    await waitFor(() => expect(lastFilter()).toMatchObject({ includeFamily: true, page: 1 }));
    expect(await screen.findByText("Aarav Sharma")).toBeInTheDocument();
    expect(within(row(/Aarav Sharma/)).getByText("Family member")).toBeInTheDocument();
  });

  it("finds a family member by name without the box being ticked", async () => {
    // A book that held a child but would not admit it when asked by name would
    // be worse than one that never held them.
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.type(searchBox(), "Aarav");

    await waitFor(() => expect(names()).toEqual(["Aarav Sharma"]));
    expect(lastFilter()?.includeFamily).toBeFalsy();
  });

  it("combines the filters rather than replacing them", async () => {
    backend().book.clients[1].email = null;
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");
    await waitFor(() =>
      expect(within(filterSelects().policyType).getAllByRole("option").length).toBeGreaterThan(1),
    );

    await user.selectOptions(filterSelects().city, "Pune");
    await user.selectOptions(filterSelects().policyType, "health");
    await user.click(screen.getByRole("checkbox", { name: /Missing email/ }));

    await waitFor(() =>
      expect(lastFilter()).toMatchObject({ city: "Pune", category: "health", missingEmail: true }),
    );
    await waitFor(() => expect(names()).toEqual(["Anita Desai"]));
  });

  it("drops a filter when its box is unticked", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.click(screen.getByRole("checkbox", { name: /Missing email/ }));
    await waitFor(() => expect(names()).toEqual(["Vikram Patel"]));
    await user.click(screen.getByRole("checkbox", { name: /Missing email/ }));

    await waitFor(() => expect(lastFilter()).toMatchObject({ missingEmail: false }));
    await waitFor(() => expect(names()).toHaveLength(8));
  });

  it("drops the city from the filter when All cities is chosen", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.selectOptions(filterSelects().city, "Pune");
    await waitFor(() => expect(names()).toEqual(["Anita Desai", "Rohit Sharma"]));
    await user.selectOptions(filterSelects().city, "");

    await waitFor(() => expect(names()).toHaveLength(8));
    expect(lastFilter()?.city).toBeUndefined();
  });

  it("keeps the rows on screen while a filter is applied", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");
    await settle();

    const gate = backend().hold("list_clients");
    await user.selectOptions(filterSelects().city, "Pune");
    const stillOnScreen = screen.queryByText("Rohit Sharma");
    gate.release();

    expect(stillOnScreen).toBeInTheDocument();
  });
});

describe("sorting the clients list", () => {
  it("starts on name, ascending", async () => {
    renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    expect(lastFilter()).toMatchObject({ sort: "name" });
    expect(names()[0]).toBe("Anita Desai");
  });

  it("reverses a column that is already sorted", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");
    const ascending = names();

    await user.click(screen.getByRole("columnheader", { name: "Client" }));

    await waitFor(() => expect(lastFilter()).toMatchObject({ sort: "name", descending: true }));
    await waitFor(() => expect(names()).toEqual([...ascending].reverse()));

    await user.click(screen.getByRole("columnheader", { name: "Client" }));

    await waitFor(() => expect(lastFilter()).toMatchObject({ sort: "name", descending: false }));
    await waitFor(() => expect(names()).toEqual(ascending));
  });

  it("sorts by how many policies a client holds", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.click(screen.getByRole("columnheader", { name: "Policies" }));

    await waitFor(() =>
      expect(lastFilter()).toMatchObject({ sort: "policies", descending: false }),
    );
    await waitFor(() => expect(names()[0]).toBe("Vikram Patel"));

    const ascending = names();
    await user.click(screen.getByRole("columnheader", { name: "Policies" }));

    await waitFor(() => expect(lastFilter()).toMatchObject({ sort: "policies", descending: true }));
    await waitFor(() => expect(names()).toEqual([...ascending].reverse()));
  });

  it("sorts by the next policy to expire", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.click(screen.getByRole("columnheader", { name: "Next expiry" }));

    await waitFor(() =>
      expect(lastFilter()).toMatchObject({ sort: "nextExpiry", descending: false }),
    );
    // Anita's health cover expires on 17 August, sooner than anyone else's.
    await waitFor(() => expect(names()[0]).toBe("Anita Desai"));
  });

  it("leaves the contact column alone", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");
    await settle();
    const before = backend().countOf("list_clients");

    await user.click(screen.getByRole("columnheader", { name: "Contact" }));

    expect(backend().countOf("list_clients")).toBe(before);
    expect(lastFilter()).toMatchObject({ sort: "name" });
  });
});

describe("paging through the clients list", () => {
  it("counts the page it is showing and moves to the next one", async () => {
    backend().book.clients = manyClients(30);
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Client 01");

    expect(screen.getByText("1–25 of 30")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await settle();

    await user.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(lastFilter()).toMatchObject({ page: 2, pageSize: 25 }));
    expect(await screen.findByText("Client 26")).toBeInTheDocument();
    expect(names()).toHaveLength(5);
    expect(screen.getByText("26–30 of 30")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("goes back to the first page when a filter changes", async () => {
    backend().book.clients = manyClients(30);
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Client 01");
    await settle();

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastFilter()).toMatchObject({ page: 2 }));

    await user.click(screen.getByRole("checkbox", { name: /Include archived/ }));

    await waitFor(() => expect(lastFilter()).toMatchObject({ includeArchived: true, page: 1 }));
    expect(await screen.findByText("Client 01")).toBeInTheDocument();
  });

  it("goes back to the first page when the search changes", async () => {
    backend().book.clients = manyClients(30);
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Client 01");
    await settle();

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastFilter()).toMatchObject({ page: 2 }));

    await user.type(searchBox(), "Client 0");

    await waitFor(() => expect(lastFilter()).toMatchObject({ search: "Client 0", page: 1 }));
  });

  it("goes back to the first page when the sort changes", async () => {
    backend().book.clients = manyClients(30);
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Client 01");
    await settle();

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastFilter()).toMatchObject({ page: 2 }));

    await user.click(screen.getByRole("columnheader", { name: "Client" }));

    await waitFor(() => expect(lastFilter()).toMatchObject({ descending: true }));
    expect(lastFilter()?.page).toBe(1);
  });

  it("hides the pager when there is nothing to page through", async () => {
    backend().book.clients = [];
    renderWithProviders(<ClientsPage />);

    expect(await screen.findByRole("button", { name: /Add a client/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });
});

describe("the empty book", () => {
  it("offers to add the first client", async () => {
    backend().book.clients = [];
    const { user } = renderWithProviders(<ClientsPage />);

    await user.click(await screen.findByRole("button", { name: /Add a client/ }));

    expect(await screen.findByRole("dialog", { name: "New client" })).toBeInTheDocument();
  });

  it("greets an empty book with something other than the no-results state", async () => {
    backend().book.clients = [];
    renderWithProviders(<ClientsPage />);

    await screen.findByRole("button", { name: /Add a client/ });
    expect(screen.queryByText(/Try clearing the filters/)).not.toBeInTheDocument();
  });
});

describe("the client form on the list", () => {
  it("opens blank for a new client, with the next code reserved", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.click(screen.getByRole("button", { name: /New client/ }));

    const dialog = within(await screen.findByRole("dialog", { name: "New client" }));
    expect(dialog.getByLabelText(/Full name/)).toHaveValue("");
    // One past the highest code in the book, family members counted: they are
    // clients and hold codes of their own.
    await waitFor(() => expect(dialog.getByLabelText(/Client code/)).toHaveValue("CL-00012"));
  });

  it("opens on the client whose Edit was pressed", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.click(within(row(/Anita Desai/)).getByRole("button", { name: "Edit" }));

    const dialog = within(await screen.findByRole("dialog", { name: "Edit Anita Desai" }));
    expect(dialog.getByLabelText(/Full name/)).toHaveValue("Anita Desai");
    expect(backend().countOf("next_client_code")).toBe(0);
  });

  it("shows the new client in the list once it is saved", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.click(screen.getByRole("button", { name: /New client/ }));
    const dialog = within(await screen.findByRole("dialog", { name: "New client" }));
    await user.type(dialog.getByLabelText(/Full name/), "Nikhil Rao");
    await user.click(dialog.getByRole("button", { name: "Add client" }));

    expect(await screen.findByText("Nikhil Rao")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("9 in the book")).toBeInTheDocument());
  });

  it("shows an edit in the list once it is saved", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.click(within(row(/Rohit Sharma/)).getByRole("button", { name: "Edit" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Edit Rohit Sharma" }));
    await user.clear(dialog.getByLabelText(/Mobile/));
    await user.type(dialog.getByLabelText(/Mobile/), "90000 11111");
    await user.click(dialog.getByRole("button", { name: "Save changes" }));

    // The core keeps a phone as its digits, so the list shows it without the space.
    expect(await screen.findByText("9000011111")).toBeInTheDocument();
  });
});

describe("archiving from the list", () => {
  it("archives a client and takes them out of the working list", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Kavita Joshi");

    await user.click(within(row(/Kavita Joshi/)).getByRole("button", { name: "Archive" }));

    await waitFor(() =>
      expect(backend().lastCall("set_client_archived")).toEqual({ id: 8, archived: true }),
    );
    expect(await screen.findByText("Client updated")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Kavita Joshi")).not.toBeInTheDocument());
  });

  it("restores an archived client", async () => {
    backend().book.clients[7].isArchived = true;
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.click(screen.getByRole("checkbox", { name: /Include archived/ }));
    await screen.findByText("Kavita Joshi");
    await user.click(within(row(/Kavita Joshi/)).getByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(backend().lastCall("set_client_archived")).toEqual({ id: 8, archived: false }),
    );
    await waitFor(() =>
      expect(within(row(/Kavita Joshi/)).queryByText("Archived")).not.toBeInTheDocument(),
    );
  });

  it("says why archiving failed and leaves the row as it was", async () => {
    backend().fail("set_client_archived", {
      kind: "internal",
      message: "The book is open elsewhere",
    });
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Kavita Joshi");

    await user.click(within(row(/Kavita Joshi/)).getByRole("button", { name: "Archive" }));

    expect(await screen.findByText("The book is open elsewhere")).toBeInTheDocument();
    expect(screen.getByText("Kavita Joshi")).toBeInTheDocument();
  });
});

describe("exporting the list", () => {
  it("exports exactly what the filters are showing", async () => {
    tauriDialog.save.mockResolvedValue("/tmp/clients.xlsx");
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.selectOptions(filterSelects().city, "Pune");
    await waitFor(() => expect(names()).toEqual(["Anita Desai", "Rohit Sharma"]));
    const shown = lastFilter();
    await user.click(screen.getByRole("button", { name: /Export/ }));

    await waitFor(() =>
      expect(backend().lastCall("export_clients")).toEqual({
        filter: shown,
        path: "/tmp/clients.xlsx",
      }),
    );
    expect(await screen.findByText("Exported 2 clients")).toBeInTheDocument();
  });

  it("offers a name and both formats in the file picker", async () => {
    tauriDialog.save.mockResolvedValue("/tmp/clients.xlsx");
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.click(screen.getByRole("button", { name: /Export/ }));

    await waitFor(() =>
      expect(tauriDialog.save).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Export clients",
          defaultPath: "clients.xlsx",
          filters: [
            { name: "Excel", extensions: ["xlsx"] },
            { name: "CSV", extensions: ["csv"] },
          ],
        }),
      ),
    );
  });

  it("exports nothing when the picker is cancelled", async () => {
    tauriDialog.save.mockResolvedValue(null);
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.click(screen.getByRole("button", { name: /Export/ }));

    await waitFor(() => expect(tauriDialog.save).toHaveBeenCalled());
    expect(backend().countOf("export_clients")).toBe(0);
    expect(screen.queryByText(/Exported/)).not.toBeInTheDocument();
  });

  it("says why an export failed", async () => {
    tauriDialog.save.mockResolvedValue("/tmp/clients.xlsx");
    backend().fail("export_clients", { kind: "internal", message: "That folder is read only" });
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.click(screen.getByRole("button", { name: /Export/ }));

    expect(await screen.findByText("That folder is read only")).toBeInTheDocument();
  });
});

describe("leaving the clients list", () => {
  it("opens a client from their name", async () => {
    const { user } = renderWithProviders(<ClientsPage />);
    await screen.findByText("Rohit Sharma");

    await user.click(screen.getByRole("link", { name: "Rohit Sharma" }));

    expect(currentRoute()).toBe("/clients/1");
  });
});

describe("while the list is busy or broken", () => {
  it("shows a spinner instead of an empty table while the book is read", async () => {
    // The screen reads the book once when it opens, so one gate holds it all.
    const first = backend().hold("list_clients");
    renderWithProviders(<ClientsPage />);

    expect(screen.getAllByText("Loading").length).toBeGreaterThan(0);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("No clients match")).not.toBeInTheDocument();

    first.release();
    expect(await screen.findByText("Rohit Sharma")).toBeInTheDocument();
  });

  it("says the list could not be read when the core fails", async () => {
    backend().fail("list_clients", { kind: "internal", message: "The book would not open" });
    renderWithProviders(<ClientsPage />);

    expect(await screen.findByText("The book would not open")).toBeInTheDocument();
  });

  it("does not offer to page a list it could not read", async () => {
    backend().fail("list_clients", { kind: "internal", message: "The book would not open" });
    renderWithProviders(<ClientsPage />);

    await waitFor(() => expect(backend().countOf("list_clients")).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });

  it("recovers when the core answers again", async () => {
    backend().failOnce("list_clients", { kind: "internal", message: "Busy" });
    const { user } = renderWithProviders(<ClientsPage />);
    await waitFor(() => expect(backend().countOf("list_clients")).toBeGreaterThan(0));

    await user.click(screen.getByRole("checkbox", { name: /Include archived/ }));

    expect(await screen.findByText("Rohit Sharma")).toBeInTheDocument();
  });
});