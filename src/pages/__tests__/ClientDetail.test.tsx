/**
 * One client, in full: the header, the three summary cards, every policy year
 * they hold, and the writes an agent makes from this page — family links, edits,
 * archiving and deleting.
 */

import { useQuery } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { ClientDetailPage } from "@/pages/ClientDetail";
import {
  backend,
  currentRoute,
  renderWithProviders,
  screen,
  waitFor,
  within,
  type Rendered,
} from "@/test";

/**
 * Watches the clients list the way the list screen does, so a test can tell
 * whether a write on this page invalidated it.
 */
function ClientsListProbe() {
  useQuery({ queryKey: ["clients", { page: 1 }], queryFn: () => api.listClients({ page: 1 }) });
  return null;
}

/** Opens the page at /clients/:id, optionally with the list watching behind it. */
function openClient(id: number | string, options: { withList?: boolean } = {}): Rendered {
  const ui = options.withList ? (
    <>
      <ClientDetailPage />
      <ClientsListProbe />
    </>
  ) : (
    <ClientDetailPage />
  );
  return renderWithProviders(ui, { route: `/clients/${id}`, path: "/clients/:id" });
}

/** Answers the confirmation the screen puts up, and reports what it asked. */
function confirms(answer: boolean) {
  return vi.spyOn(window, "confirm").mockReturnValue(answer);
}

/** The value shown against a labelled detail in one of the summary cards. */
function detailValue(label: string): string {
  const term = screen.getByText(label, { selector: "dt" });
  return term.nextElementSibling?.textContent ?? "";
}

/** The policy row carrying a policy number. */
function policyRow(policyNumber: string): HTMLElement {
  return screen.getByText(policyNumber).closest("tr") as HTMLElement;
}

describe("the client header", () => {
  it("names the client with their code, city and occupation", async () => {
    openClient(1);

    expect(await screen.findByRole("heading", { name: "Rohit Sharma" })).toBeInTheDocument();
    expect(screen.getByText("CL-00001 · Pune · Software engineer")).toBeInTheDocument();
    expect(screen.getByText("RS")).toBeInTheDocument();
    expect(screen.getByText("2 active")).toBeInTheDocument();
    expect(screen.getByText("3 total")).toBeInTheDocument();
  });

  it("lists the contact details the book holds", async () => {
    openClient(1);
    await screen.findByRole("heading", { name: "Contact & details" });

    expect(detailValue("Email")).toBe("rohit.sharma@example.com");
    expect(detailValue("Mobile")).toBe("98765 43210");
    expect(detailValue("Date of birth")).toBe("12 Apr 1986");
    expect(detailValue("Gender")).toBe("Male");
    expect(detailValue("Address")).toBe(
      "Flat 402, Green Meadows, Baner Road, Pune, Maharashtra, 411045",
    );
    expect(detailValue("PAN")).toBe("ABCPS1234F");
    expect(detailValue("Next expiry")).toBe("21 Aug 2026");
    expect(screen.getByText("Prefers a call before renewal.")).toBeInTheDocument();
  });

  it("writes a dash for anything the book does not have", async () => {
    openClient(3);
    await screen.findByRole("heading", { name: "Vikram Patel" });

    expect(detailValue("Email")).toBe("—");
    expect(detailValue("Alternate")).toBe("—");
    expect(detailValue("Next expiry")).toBe("—");
  });

  it("warns that a client without an email cannot be reminded", async () => {
    openClient(3);

    expect(
      await screen.findByText(/No email address on file, so this client cannot receive/),
    ).toBeInTheDocument();
  });

  it("keeps the warning away from a client who has an email", async () => {
    openClient(1);
    await screen.findByRole("heading", { name: "Rohit Sharma" });

    expect(screen.queryByText(/No email address on file/)).not.toBeInTheDocument();
  });

  it("badges a client who is archived or opted out of reminders", async () => {
    backend().book.clients[0].isArchived = true;
    backend().book.clients[0].remindersOptedOut = true;
    openClient(1);

    expect(await screen.findByText("Archived")).toBeInTheDocument();
    expect(screen.getByText("Reminders off")).toBeInTheDocument();
  });

  it("reads the book value from the client's own row", async () => {
    openClient(1);
    await screen.findByRole("heading", { name: "Book value" });

    expect(detailValue("Client since")).toBe("08 Apr 2024");
    expect(detailValue("Last updated")).toBe("28 Jul 2026");
    expect(detailValue("Language")).toBe("EN");
  });

  it("holds a spinner while the client is being read", async () => {
    const gate = backend().hold("get_client");
    openClient(1);

    expect(await screen.findByText("Loading")).toBeInTheDocument();

    gate.release();
    expect(await screen.findByRole("heading", { name: "Rohit Sharma" })).toBeInTheDocument();
  });

  it("puts every section of the client on one page", async () => {
    openClient(1);
    await screen.findByRole("heading", { name: "Rohit Sharma" });

    for (const section of [
      "Contact & details",
      "Family",
      "Book value",
      "Policies",
      "Documents",
    ]) {
      expect(screen.getByRole("heading", { name: section })).toBeInTheDocument();
    }
  });

  it("goes back to the list", async () => {
    const { user } = openClient(1);

    await user.click(await screen.findByRole("link", { name: /All clients/ }));

    expect(currentRoute()).toBe("/clients");
  });

  it("says so when the client is not in the book", async () => {
    openClient(99);

    await waitFor(() => expect(screen.queryByText("Loading")).not.toBeInTheDocument());
    expect(backend().countOf("get_client")).toBe(1);
    expect(screen.queryByRole("link", { name: /All clients/ })).not.toBeInTheDocument();
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });

  it("says so when the address does not carry a client id", async () => {
    openClient("not-a-number");

    await waitFor(() => expect(screen.queryByText("Loading")).not.toBeInTheDocument());
    expect(backend().lastCall("get_client")?.id).toBeNaN();
    expect(screen.queryByRole("link", { name: /All clients/ })).not.toBeInTheDocument();
    expect(screen.getByText(/not found|is not a client/i)).toBeInTheDocument();
  });
});

describe("the client's policies", () => {
  it("lists every policy year with its status and expiry, latest expiry first", async () => {
    openClient(1);

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);

    expect(within(rows[0]).getByText("IL/MOT/778211")).toBeInTheDocument();
    expect(within(rows[0]).getByText("31 Aug 2026")).toBeInTheDocument();
    expect(within(rows[0]).getByText("in 17 days")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Active")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Motor")).toBeInTheDocument();

    expect(within(rows[1]).getByText("SH/2025/0091823")).toBeInTheDocument();
    expect(within(rows[1]).getByText("21 Aug 2026")).toBeInTheDocument();
    expect(within(rows[1]).getByText("in 7 days")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Active")).toBeInTheDocument();
    expect(within(rows[1]).getByText("yr 2")).toBeInTheDocument();

    // Last year's cover keeps its place, marked as renewed rather than expiring.
    expect(within(rows[2]).getByText("SH/2024/0091823")).toBeInTheDocument();
    expect(within(rows[2]).getAllByText("Renewed")).toHaveLength(2);

    expect(screen.getByText("1–3 of 3")).toBeInTheDocument();
  });

  it("asks the core only for this client's policies", async () => {
    openClient(1);
    await screen.findByRole("table");

    expect(backend().lastCall("list_policies")?.filter).toMatchObject({
      clientId: 1,
      page: 1,
      pageSize: 20,
      sort: "expiry",
      descending: true,
    });
  });

  it("invites a first policy when the client holds none", async () => {
    backend().book.policies = [];
    openClient(1);

    expect(await screen.findByText("No policies yet")).toBeInTheDocument();
    expect(
      screen.getByText("Add the client's first policy to start tracking renewals."),
    ).toBeInTheDocument();
  });

  it("opens the policy for editing when its row is clicked", async () => {
    const { user } = openClient(1);
    await screen.findByRole("table");

    await user.click(policyRow("SH/2025/0091823"));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Edit policy SH/2025/0091823" }),
    ).toBeInTheDocument();
  });

  it("adds a policy without asking which client it is for", async () => {
    const { user } = openClient(1);

    await user.click(await screen.findByRole("button", { name: "Add policy" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "New policy" })).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("Rohit Sharma")).toBeDisabled();
  });

  it("renews a policy from here", async () => {
    const { user } = openClient(1);
    await screen.findByRole("table");

    await user.click(within(policyRow("SH/2025/0091823")).getByRole("button", { name: "Renew" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Renew Rohit Sharma's Health policy" }),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Record renewal" }));

    expect(await screen.findByText("Renewal recorded")).toBeInTheDocument();
    await waitFor(() => {
      expect(within(screen.getByRole("table")).getAllByRole("row").slice(1)).toHaveLength(4);
    });
  });

  it("deletes a policy year after asking", async () => {
    const confirm = confirms(true);
    const { user } = openClient(1);
    await screen.findByRole("table");

    await user.click(within(policyRow("SH/2025/0091823")).getByRole("button", { name: "Delete" }));

    expect(confirm).toHaveBeenCalledWith(
      "Delete policy SH/2025/0091823? This removes this policy year permanently.",
    );
    expect(await screen.findByText("Policy deleted")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("SH/2025/0091823")).not.toBeInTheDocument();
    });
  });

  it("keeps the header counts in step when a policy goes", async () => {
    confirms(true);
    const { user } = openClient(1);
    await screen.findByRole("table");

    await user.click(within(policyRow("SH/2025/0091823")).getByRole("button", { name: "Delete" }));
    await screen.findByText("Policy deleted");

    expect(await screen.findByText("1 active")).toBeInTheDocument();
  });

  it("says when the policies could not be read", async () => {
    backend().fail("list_policies", { kind: "internal", message: "The book would not open" });
    openClient(1);
    await screen.findByRole("heading", { name: "Policies" });

    await waitFor(() => expect(backend().countOf("list_policies")).toBe(1));
    expect(screen.queryByText("No policies yet")).not.toBeInTheDocument();
  });
});

describe("the client's family", () => {
  it("lists the people related to this client, spouse first", async () => {
    openClient(1);
    const card = (await screen.findByRole("heading", { name: "Family" })).closest(
      "section",
    ) as HTMLElement;

    const names = within(card)
      .getAllByRole("listitem")
      .map((row) => row.textContent);
    expect(names).toHaveLength(2);
    expect(names[0]).toContain("Sneha Sharma");
    expect(names[0]).toContain("Spouse · 03 Sep 1988");
    expect(names[1]).toContain("Aarav Sharma");
    expect(names[1]).toContain("Son · 19 Jan 2016");
    expect(backend().lastCall("list_relatives")).toMatchObject({ clientId: 1 });
  });

  it("reads the relationship the other way round from the other page", async () => {
    // The son's page shows the same one edge, stored on the father: the word
    // does not invert, it gains a preposition.
    openClient(10);
    const card = (await screen.findByRole("heading", { name: "Family" })).closest(
      "section",
    ) as HTMLElement;

    expect(within(card).getByRole("listitem")).toHaveTextContent("Son of");
    expect(within(card).getByRole("link", { name: /Rohit Sharma/ })).toHaveAttribute(
      "href",
      "/clients/1",
    );
  });

  it("badges a client who is only somebody's family member", async () => {
    openClient(10);

    expect(await screen.findByRole("heading", { name: "Aarav Sharma" })).toBeInTheDocument();
    expect(screen.getByText("Family member")).toBeInTheDocument();
    expect(screen.getByText("1 relative")).toBeInTheDocument();
  });

  it("invites the first relative and the first document when there are neither", async () => {
    openClient(5);

    expect(await screen.findByRole("heading", { name: "Suresh Nair" })).toBeInTheDocument();
    expect(
      screen.getByText(/Link a spouse, child or parent to cover them on a floater/),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/Keep the policy schedule, the proposal form/),
    ).toBeInTheDocument();
  });

  it("says what the controls on a relative do", async () => {
    openClient(1);
    const row = (await screen.findByText("Sneha Sharma")).closest("li") as HTMLElement;

    // The name is a link to her own page, not a control on this one.
    expect(within(row).getByRole("link", { name: /Sneha Sharma/ })).toHaveAttribute(
      "href",
      "/clients/9",
    );
    expect(
      within(row).getByRole("button", { name: "Change how Sneha Sharma is related" }),
    ).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Unlink Sneha Sharma" })).toBeInTheDocument();
  });

  it("links a client already in the book, without opening a second one for them", async () => {
    const { user } = openClient(2);
    await screen.findByRole("heading", { name: "Anita Desai" });

    await user.click(screen.getByRole("button", { name: /Link relative/ }));
    const dialog = await screen.findByRole("dialog", { name: "Link a relative" });
    await user.type(within(dialog).getByLabelText(/Name/), "Kavita");
    await user.click(await within(dialog).findByRole("button", { name: /Kavita Joshi/ }));
    await user.selectOptions(within(dialog).getByLabelText(/^Relationship/), "sister");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Relative linked")).toBeInTheDocument();
    expect(backend().lastCall("link_clients")?.input).toMatchObject({
      clientId: 2,
      relatedClientId: 8,
      relationship: "sister",
    });
    expect(backend().countOf("create_client")).toBe(0);
    expect(await screen.findByText("Kavita Joshi")).toBeInTheDocument();
  });

  it("opens a client for a relative nobody has entered yet, at the household's address", async () => {
    const { user } = openClient(2);
    await screen.findByRole("heading", { name: "Anita Desai" });

    await user.click(screen.getByRole("button", { name: /Link relative/ }));
    const dialog = await screen.findByRole("dialog", { name: "Link a relative" });
    await user.type(within(dialog).getByLabelText(/Name/), "Rhea Desai");
    await user.selectOptions(within(dialog).getByLabelText(/^Relationship/), "daughter");
    await user.click(within(dialog).getByRole("button", { name: "Add and link" }));

    expect(await screen.findByText("Relative linked")).toBeInTheDocument();
    const holder = backend().book.clients.find((row) => row.id === 2)!;
    expect(backend().lastCall("create_client")?.input).toMatchObject({
      fullName: "Rhea Desai",
      city: holder.city,
      pincode: holder.pincode,
    });
    expect(backend().lastCall("link_clients")?.input).toMatchObject({
      clientId: 2,
      relationship: "daughter",
    });
  });

  it("corrects the word on a relationship already recorded", async () => {
    const { user } = openClient(1);
    const row = (await screen.findByText("Sneha Sharma")).closest("li") as HTMLElement;

    await user.click(within(row).getByRole("button", { name: "Change how Sneha Sharma is related" }));

    const dialog = await screen.findByRole("dialog", { name: "How is Sneha Sharma related?" });
    // The person is settled, so the modal asks only about the word.
    expect(within(dialog).queryByLabelText(/^Name/)).not.toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText(/^Relationship/), "sister");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Relationship updated")).toBeInTheDocument();
    expect(backend().lastCall("link_clients")?.input).toMatchObject({
      clientId: 1,
      relatedClientId: 9,
      relationship: "sister",
    });
  });

  it("leaves the relationship alone when the edit is cancelled", async () => {
    const { user } = openClient(1);
    const row = (await screen.findByText("Sneha Sharma")).closest("li") as HTMLElement;

    await user.click(within(row).getByRole("button", { name: "Change how Sneha Sharma is related" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(backend().countOf("link_clients")).toBe(0);
  });

  it("reports a relationship the core refuses, staying open to be corrected", async () => {
    backend().fail("link_clients", {
      kind: "validation",
      message: "That would make somebody their own ancestor",
    });
    const { user } = openClient(1);
    const row = (await screen.findByText("Sneha Sharma")).closest("li") as HTMLElement;

    await user.click(within(row).getByRole("button", { name: "Change how Sneha Sharma is related" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("That would make somebody their own ancestor"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("asks before unlinking, then keeps the person as a client", async () => {
    const confirm = confirms(true);
    const { user } = openClient(1);
    const row = (await screen.findByText("Aarav Sharma")).closest("li") as HTMLElement;

    await user.click(within(row).getByRole("button", { name: "Unlink Aarav Sharma" }));

    expect(confirm).toHaveBeenCalledWith(
      "Unlink Aarav Sharma from Rohit Sharma? They stay in the book as a client.",
    );
    expect(await screen.findByText(/Relationship removed/)).toBeInTheDocument();
    expect(backend().lastCall("unlink_clients")).toMatchObject({ clientId: 1, relatedClientId: 10 });
    await waitFor(() => expect(screen.queryByText("Aarav Sharma")).not.toBeInTheDocument());
    expect(backend().book.clients.some((row) => row.fullName === "Aarav Sharma")).toBe(true);
  });

  it("keeps the relationship when the confirmation is declined", async () => {
    confirms(false);
    const { user } = openClient(1);
    const row = (await screen.findByText("Aarav Sharma")).closest("li") as HTMLElement;

    await user.click(within(row).getByRole("button", { name: "Unlink Aarav Sharma" }));

    expect(backend().countOf("unlink_clients")).toBe(0);
    expect(screen.getByText("Aarav Sharma")).toBeInTheDocument();
  });

  it("reports an unlink the core refuses", async () => {
    confirms(true);
    backend().fail("unlink_clients", { kind: "internal", message: "The book is open elsewhere" });
    const { user } = openClient(1);
    const row = (await screen.findByText("Aarav Sharma")).closest("li") as HTMLElement;

    await user.click(within(row).getByRole("button", { name: "Unlink Aarav Sharma" }));

    expect(await screen.findByText("The book is open elsewhere")).toBeInTheDocument();
    expect(screen.getByText("Aarav Sharma")).toBeInTheDocument();
  });

  it("says when the family could not be read", async () => {
    backend().fail("list_relatives", { kind: "internal", message: "The book would not open" });
    openClient(1);
    await screen.findByRole("heading", { name: "Family" });

    await waitFor(() => expect(backend().countOf("list_relatives")).toBe(1));
    expect(await screen.findByText("The family could not be read")).toBeInTheDocument();
    expect(
      screen.queryByText(/Link a spouse, child or parent to cover them on a floater/),
    ).not.toBeInTheDocument();
  });
});

describe("archiving a household from the client's page", () => {
  it("moves the client and the people linked to them together", async () => {
    const { user } = openClient(1);

    await user.click(await screen.findByRole("button", { name: "Archive family" }));

    expect(await screen.findByText("3 clients archived")).toBeInTheDocument();
    expect(backend().lastCall("set_family_archived")).toMatchObject({ id: 1, archived: true });
    const archived = backend()
      .book.clients.filter((row) => row.isArchived)
      .map((row) => row.fullName);
    expect(archived).toEqual(["Rohit Sharma", "Sneha Sharma", "Aarav Sharma"]);
  });

  it("is not offered to a client with nobody linked to them", async () => {
    openClient(5);
    await screen.findByRole("heading", { name: "Suresh Nair" });

    expect(screen.getByRole("button", { name: "Archive client" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive family" })).not.toBeInTheDocument();
  });

  it("reports a family archive the core refuses", async () => {
    backend().fail("set_family_archived", {
      kind: "internal",
      message: "The book is open elsewhere",
    });
    const { user } = openClient(1);

    await user.click(await screen.findByRole("button", { name: "Archive family" }));

    expect(await screen.findByText("The book is open elsewhere")).toBeInTheDocument();
  });
});

describe("editing the client from their page", () => {
  it("saves the change, and refreshes both this page and the list", async () => {
    const { user } = openClient(1, { withList: true });
    await waitFor(() => expect(backend().countOf("list_clients")).toBe(1));

    await user.click(await screen.findByRole("button", { name: "Edit" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Edit Rohit Sharma" })).toBeInTheDocument();
    const name = within(dialog).getByLabelText(/Full name/);
    await user.clear(name);
    await user.type(name, "Rohit K Sharma");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Client updated")).toBeInTheDocument();
    expect(backend().lastCall("update_client")).toMatchObject({
      id: 1,
      input: { fullName: "Rohit K Sharma" },
    });
    expect(await screen.findByRole("heading", { name: "Rohit K Sharma" })).toBeInTheDocument();
    await waitFor(() => {
      expect(backend().countOf("get_client")).toBe(2);
      expect(backend().countOf("list_clients")).toBe(2);
    });
  });

  it("reports an edit the core refuses, keeping the form open", async () => {
    backend().fail("update_client", { kind: "validation", message: "A client needs a name" });
    const { user } = openClient(1);

    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await within(dialog).findByText("A client needs a name")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("archiving and deleting from the client's page", () => {
  it("archives the client and marks them archived", async () => {
    const { user } = openClient(1);

    await user.click(await screen.findByRole("button", { name: "Archive client" }));

    expect(await screen.findByText("Client archived")).toBeInTheDocument();
    expect(backend().lastCall("set_client_archived")).toMatchObject({ id: 1, archived: true });
    expect(await screen.findByText("Archived")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore client" })).toBeInTheDocument();
  });

  it("restores an archived client", async () => {
    backend().book.clients[0].isArchived = true;
    const { user } = openClient(1);

    await user.click(await screen.findByRole("button", { name: "Restore client" }));

    expect(await screen.findByText("Client restored")).toBeInTheDocument();
    expect(backend().lastCall("set_client_archived")).toMatchObject({ id: 1, archived: false });
    await waitFor(() => expect(screen.queryByText("Archived")).not.toBeInTheDocument());
  });

  it("reports an archive the core refuses", async () => {
    backend().fail("set_client_archived", {
      kind: "internal",
      message: "The book is open elsewhere",
    });
    const { user } = openClient(1);

    await user.click(await screen.findByRole("button", { name: "Archive client" }));

    expect(await screen.findByText("The book is open elsewhere")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive client" })).toBeInTheDocument();
  });

  it("takes an archived client out of the clients list", async () => {
    const { user } = openClient(1, { withList: true });
    await waitFor(() => expect(backend().countOf("list_clients")).toBe(1));

    await user.click(await screen.findByRole("button", { name: "Archive client" }));
    await screen.findByText("Client archived");

    await waitFor(() => expect(backend().countOf("list_clients")).toBe(2));
  });

  it("asks what goes with the client, naming the family on file", async () => {
    const { user } = openClient(1);

    await user.click(await screen.findByRole("button", { name: "Delete permanently" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete Rohit Sharma?" });
    expect(dialog).toHaveTextContent("This removes the client and 3 policy records");
    expect(within(dialog).getByText(/Sneha Sharma — spouse/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Aarav Sharma — son/)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Delete this client only, and keep the family" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Delete this client and 2 relatives" }),
    ).toBeInTheDocument();
    expect(backend().countOf("delete_client")).toBe(0);
  });

  it("deletes the client alone, leaving their family standing", async () => {
    const { user } = openClient(1);

    await user.click(await screen.findByRole("button", { name: "Delete permanently" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Delete this client only, and keep the family" }),
    );

    expect(await screen.findByText("Client deleted")).toBeInTheDocument();
    expect(backend().lastCall("delete_client")).toMatchObject({ id: 1, scope: "linksOnly" });
    await waitFor(() => expect(currentRoute()).toBe("/clients"));
    expect(backend().book.clients.map((row) => row.fullName)).toContain("Sneha Sharma");
  });

  it("deletes the household when that is what was asked for", async () => {
    const { user } = openClient(1);

    await user.click(await screen.findByRole("button", { name: "Delete permanently" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Delete this client and 2 relatives" }),
    );

    expect(await screen.findByText("3 clients deleted")).toBeInTheDocument();
    expect(backend().lastCall("delete_client")).toMatchObject({
      id: 1,
      scope: "immediateFamily",
    });
    await waitFor(() => expect(currentRoute()).toBe("/clients"));
    const left = backend().book.clients.map((row) => row.fullName);
    expect(left).not.toContain("Sneha Sharma");
    expect(left).not.toContain("Aarav Sharma");
  });

  it("offers one choice only when nobody is linked to the client", async () => {
    const { user } = openClient(5);
    await screen.findByRole("heading", { name: "Suresh Nair" });

    await user.click(screen.getByRole("button", { name: "Delete permanently" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete Suresh Nair?" });
    expect(within(dialog).getByRole("button", { name: "Delete this client" })).toBeInTheDocument();
    expect(within(dialog).queryByText("Family on file")).not.toBeInTheDocument();
  });

  it("reports a delete the core refuses, staying on the client", async () => {
    backend().fail("delete_client", {
      kind: "conflict",
      message: "This client still has policies, so they cannot be deleted",
    });
    const { user } = openClient(1);

    await user.click(await screen.findByRole("button", { name: "Delete permanently" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Delete this client only, and keep the family",
      }),
    );

    expect(
      await screen.findByText("This client still has policies, so they cannot be deleted"),
    ).toBeInTheDocument();
    expect(currentRoute()).toBe("/clients/1");
  });
});
