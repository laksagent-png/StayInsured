/**
 * One client, in full: the header, the three summary cards, every policy year
 * they hold, and the writes an agent makes from this page — members, edits,
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
      "Members covered",
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

describe("insured members", () => {
  it("lists the lives the client covers", async () => {
    openClient(1);
    const card = (await screen.findByRole("heading", { name: "Members covered" })).closest(
      "section",
    ) as HTMLElement;

    const names = within(card)
      .getAllByRole("listitem")
      .map((row) => row.textContent);
    expect(names[0]).toContain("Rohit Sharma");
    expect(names[0]).toContain("Self · 12 Apr 1986");
    expect(names[1]).toContain("Sneha Sharma");
    expect(names[1]).toContain("Spouse · 03 Sep 1988");
    expect(names[2]).toContain("Aarav Sharma");
    expect(names[2]).toContain("Son · 19 Jan 2016");
    expect(backend().lastCall("list_members")).toMatchObject({ clientId: 1 });
  });

  it("invites the first member and the first document when there are neither", async () => {
    openClient(5);

    expect(await screen.findByRole("heading", { name: "Suresh Nair" })).toBeInTheDocument();
    expect(
      screen.getByText("Add family members to attach them to health and travel policies."),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/Keep the policy schedule, the proposal form/),
    ).toBeInTheDocument();
  });

  it("says what the buttons on a member do", async () => {
    openClient(1);
    const row = (await screen.findByText("Sneha Sharma")).closest("li") as HTMLElement;

    // Three controls, not two: the name opens the editor alongside the pencil.
    expect(within(row).getAllByRole("button")).toHaveLength(3);
    expect(within(row).getByRole("button", { name: "Edit Sneha Sharma" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("adds a member and shows them on the client", async () => {
    const { user } = openClient(1);

    await user.click(await screen.findByRole("button", { name: "Add" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Add member" })).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Full name/), "Ishaan Sharma");
    await user.selectOptions(within(dialog).getByLabelText("Relationship"), "son");
    await user.selectOptions(within(dialog).getByLabelText("Gender"), "male");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Member added")).toBeInTheDocument();
    expect(backend().lastCall("create_member")?.input).toMatchObject({
      clientId: 1,
      fullName: "Ishaan Sharma",
      relationship: "son",
      gender: "male",
    });
    expect(await screen.findByText("Ishaan Sharma")).toBeInTheDocument();
    await waitFor(() => expect(backend().countOf("list_members")).toBe(2));
  });

  it("refuses a member with no name, and stays open to be corrected", async () => {
    const { user } = openClient(1);

    await user.click(await screen.findByRole("button", { name: "Add" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("A member needs a name")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add member" })).toBeInTheDocument();
  });

  it("starts the add form empty every time", async () => {
    const { user } = openClient(1);

    await user.click(await screen.findByRole("button", { name: "Add" }));
    await user.type(
      within(await screen.findByRole("dialog")).getByLabelText(/Full name/),
      "Ishaan Sharma",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Member added");

    await user.click(screen.getByRole("button", { name: "Add" }));

    const reopened = await screen.findByRole("dialog");
    expect(within(reopened).getByRole("heading", { name: "Add member" })).toBeInTheDocument();
    expect(within(reopened).getByLabelText(/Full name/)).toHaveValue("");
  });

  it("edits a member", async () => {
    const { user } = openClient(1);
    const row = (await screen.findByText("Sneha Sharma")).closest("li") as HTMLElement;

    // The pencil by name, since the member's own name is a control too.
    await user.click(within(row).getByRole("button", { name: "Edit Sneha Sharma" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Edit Sneha Sharma" })).toBeInTheDocument();
    const name = within(dialog).getByLabelText(/Full name/);
    await user.clear(name);
    await user.type(name, "Sneha S Sharma");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Member updated")).toBeInTheDocument();
    expect(backend().lastCall("update_member")).toMatchObject({
      id: 2,
      input: { fullName: "Sneha S Sharma", relationship: "spouse" },
    });
    expect(await screen.findByText("Sneha S Sharma")).toBeInTheDocument();
  });

  it("leaves the member alone when the edit is cancelled", async () => {
    const { user } = openClient(1);
    const row = (await screen.findByText("Sneha Sharma")).closest("li") as HTMLElement;

    await user.click(within(row).getByRole("button", { name: "Edit Sneha Sharma" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(backend().countOf("update_member")).toBe(0);
  });

  it("opens the editor when a member's name is clicked", async () => {
    const { user } = openClient(1);

    await user.click(await screen.findByText("Sneha Sharma"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Edit Sneha Sharma" })).toBeInTheDocument();
  });

  it("opens the editor from the name without a mouse", async () => {
    const { user } = openClient(1);
    const row = (await screen.findByText("Sneha Sharma")).closest("li") as HTMLElement;
    const name = within(row).getByRole("button", { name: /^Sneha Sharma/ });

    name.focus();
    expect(name).toHaveFocus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Edit Sneha Sharma" })).toBeInTheDocument();
  });

  it("asks before removing a member, then removes them", async () => {
    const confirm = confirms(true);
    const { user } = openClient(1);
    const row = (await screen.findByText("Aarav Sharma")).closest("li") as HTMLElement;

    // The bin by name, since the member's own name is a control too.
    await user.click(within(row).getByRole("button", { name: "Remove Aarav Sharma" }));

    expect(confirm).toHaveBeenCalledWith("Remove Aarav Sharma?");
    expect(await screen.findByText("Member removed")).toBeInTheDocument();
    expect(backend().lastCall("delete_member")).toMatchObject({ id: 3 });
    await waitFor(() => expect(screen.queryByText("Aarav Sharma")).not.toBeInTheDocument());
  });

  it("keeps the member when the confirmation is declined", async () => {
    confirms(false);
    const { user } = openClient(1);
    const row = (await screen.findByText("Aarav Sharma")).closest("li") as HTMLElement;

    await user.click(within(row).getByRole("button", { name: "Remove Aarav Sharma" }));

    expect(backend().countOf("delete_member")).toBe(0);
    expect(screen.getByText("Aarav Sharma")).toBeInTheDocument();
  });

  it("reports a removal the core refuses", async () => {
    confirms(true);
    backend().fail("delete_member", { kind: "internal", message: "The book is open elsewhere" });
    const { user } = openClient(1);
    const row = (await screen.findByText("Aarav Sharma")).closest("li") as HTMLElement;

    await user.click(within(row).getByRole("button", { name: "Remove Aarav Sharma" }));

    expect(await screen.findByText("The book is open elsewhere")).toBeInTheDocument();
    expect(screen.getByText("Aarav Sharma")).toBeInTheDocument();
  });

  it("says when the members could not be read", async () => {
    backend().fail("list_members", { kind: "internal", message: "The book would not open" });
    openClient(1);
    await screen.findByRole("heading", { name: "Members covered" });

    await waitFor(() => expect(backend().countOf("list_members")).toBe(1));
    expect(
      screen.queryByText("Add family members to attach them to health and travel policies."),
    ).not.toBeInTheDocument();
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

  it("asks before deleting, naming what goes with the client", async () => {
    const confirm = confirms(false);
    const { user } = openClient(1);

    await user.click(await screen.findByRole("button", { name: "Delete permanently" }));

    expect(confirm).toHaveBeenCalledWith(
      "Delete Rohit Sharma and all 3 policy records? This cannot be undone.",
    );
    expect(backend().countOf("delete_client")).toBe(0);
    expect(currentRoute()).toBe("/clients/1");
  });

  it("deletes the client and returns to the list", async () => {
    backend().book.policies = [];
    confirms(true);
    const { user } = openClient(1);

    await user.click(await screen.findByRole("button", { name: "Delete permanently" }));

    expect(await screen.findByText("Client deleted")).toBeInTheDocument();
    expect(backend().lastCall("delete_client")).toMatchObject({ id: 1 });
    await waitFor(() => expect(currentRoute()).toBe("/clients"));
  });

  it("reports a delete the core refuses, staying on the client", async () => {
    confirms(true);
    backend().fail("delete_client", {
      kind: "conflict",
      message: "This client still has policies, so they cannot be deleted",
    });
    const { user } = openClient(1);

    await user.click(await screen.findByRole("button", { name: "Delete permanently" }));

    expect(
      await screen.findByText("This client still has policies, so they cannot be deleted"),
    ).toBeInTheDocument();
    expect(currentRoute()).toBe("/clients/1");
  });
});
