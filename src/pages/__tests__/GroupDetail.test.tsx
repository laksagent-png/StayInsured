/**
 * One group in full: its head, the book its members hold, the roster, and the
 * writes an operator makes from this page — joining, leaving, archiving and
 * deleting.
 *
 * The distinction this page has to keep straight is the one the schema makes: a
 * member is a client filed in the group, while the head is four columns written
 * on the group and nobody in the book at all.
 */

import { describe, expect, it, vi } from "vitest";

import {
  backend,
  createBook,
  currentRoute,
  installBackend,
  renderWithProviders,
  screen,
  waitFor,
  withGroups,
  within,
  type Rendered,
} from "@/test";
import { GroupDetailPage } from "@/pages/GroupDetail";

/** Opens /groups/:id on a book that has the Patel Group in it. */
function openGroup(id: number | string = 1): Rendered {
  installBackend(withGroups(createBook()));
  return renderWithProviders(<GroupDetailPage />, {
    route: `/groups/${id}`,
    path: "/groups/:id",
  });
}

function confirms(answer: boolean) {
  return vi.spyOn(window, "confirm").mockReturnValue(answer);
}

/** The value shown against a labelled detail in one of the summary cards. */
function detailValue(label: string): string {
  const term = screen.getByText(label, { selector: "dt" });
  return term.nextElementSibling?.textContent ?? "";
}

function memberRow(name: string | RegExp): HTMLElement {
  return screen.getByRole("row", { name });
}

/** The Group head card, to read the head's own fields rather than the page's. */
function headCard() {
  const heading = screen.getByRole("heading", { name: "Group head" });
  return within(heading.closest("section") as HTMLElement);
}

describe("the group header and cards", () => {
  it("names the group, counts its members and adds up their book", async () => {
    openGroup();

    expect(await screen.findByRole("heading", { name: "Patel Group" })).toBeInTheDocument();
    expect(screen.getByText("GR-00001")).toBeInTheDocument();
    expect(screen.getByText("2 members")).toBeInTheDocument();
    expect(screen.getByText("2 active")).toBeInTheDocument();
    expect(detailValue("Premium")).toBe("₹4,98,500");
    expect(detailValue("Next expiry")).toBe("28 Feb 2027");
  });

  it("gives the head a card of their own, with no client page behind them", async () => {
    openGroup();
    await screen.findByRole("heading", { name: "Patel Group" });

    const card = headCard();
    expect(card.getByText("Vikram Patel")).toBeInTheDocument();
    expect(card.getByText("Insurance broker")).toBeInTheDocument();
    expect(card.getByText("+919925044556")).toBeInTheDocument();
    expect(card.getByText("vikram.patel@example.com")).toBeInTheDocument();
    // A head is a contact, so nothing here leads anywhere — least of all to the
    // client who happens to share the name.
    expect(card.queryByRole("link")).toBeNull();
    expect(card.getByText(/not a client/)).toBeInTheDocument();
  });

  it("says the head is unknown, and still offers to add one", async () => {
    const book = withGroups(createBook());
    book.groups[0].headName = null;
    book.groups[0].headDesignation = null;
    book.groups[0].headPhone = null;
    book.groups[0].headEmail = null;
    installBackend(book);
    renderWithProviders(<GroupDetailPage />, { route: "/groups/1", path: "/groups/:id" });

    await screen.findByRole("heading", { name: "Patel Group" });
    expect(headCard().getByText("No referrer on file")).toBeInTheDocument();

    // The card keeps its own way in, because an empty head is a thing to fill
    // in rather than a fault to report.
    expect(headCard().getByRole("button", { name: "Edit head" })).toBeInTheDocument();
  });

  it("says the group is not there rather than failing, when it is not", async () => {
    openGroup(4242);

    expect(await screen.findByText("Group not found")).toBeInTheDocument();
  });
});

describe("the roster", () => {
  it("lists the members with their own policies, and marks them as companies", async () => {
    openGroup();
    await screen.findByRole("heading", { name: "Patel Group" });

    expect(await screen.findByText("Patel Weaves Pvt Ltd")).toBeInTheDocument();
    const weaves = within(memberRow(/Patel Weaves/));
    expect(weaves.getByText("Company")).toBeInTheDocument();
    // The contact person, not the city: on a firm that is who the agency rings.
    expect(weaves.getByText(/Nishita Patel/)).toBeInTheDocument();
    expect(weaves.getByRole("link", { name: "Patel Weaves Pvt Ltd" })).toHaveAttribute(
      "href",
      "/clients/12",
    );

    // The client who shares the head's name holds a book of his own and is not
    // on this list, because he is not in the group.
    expect(screen.queryByText("Vikram Patel", { selector: "a.font-medium" })).toBeNull();
  });

  it("takes a member out of the group without taking them out of the book", async () => {
    const confirm = confirms(true);
    const { user } = openGroup();
    await screen.findByText("Patel Weaves Pvt Ltd");

    await user.click(within(memberRow(/Patel Weaves/)).getByRole("button", { name: /Take Patel Weaves/ }));

    expect(confirm.mock.calls[0][0]).toContain("They stay in the book");
    await waitFor(() =>
      expect(backend().book.clients.find((row) => row.id === 12)?.groupId).toBeNull(),
    );
    expect(await screen.findByText(/They stay in the book/)).toBeInTheDocument();
  });

  it("leaves the member alone when the confirmation is declined", async () => {
    confirms(false);
    const { user } = openGroup();
    await screen.findByText("Patel Weaves Pvt Ltd");

    await user.click(within(memberRow(/Patel Weaves/)).getByRole("button", { name: /Take Patel Weaves/ }));

    expect(backend().countOf("set_client_group")).toBe(0);
    expect(backend().book.clients.find((row) => row.id === 12)?.groupId).toBe(1);
  });
});

describe("adding a member", () => {
  it("files a client already in the book into the group", async () => {
    const { user } = openGroup();
    await screen.findByRole("heading", { name: "Patel Group" });

    await user.click(screen.getByRole("button", { name: /Add member/ }));
    await user.type(screen.getByPlaceholderText("Sundaram Textiles"), "Anita");
    await user.click(await screen.findByText("Anita Desai"));

    await waitFor(() =>
      expect(backend().book.clients.find((row) => row.id === 2)?.groupId).toBe(1),
    );
    expect(await screen.findByText("Added to Patel Group")).toBeInTheDocument();
  });

  it("opens a company already filed in the group", async () => {
    const { user } = openGroup();
    await screen.findByRole("heading", { name: "Patel Group" });

    await user.click(screen.getByRole("button", { name: /Add member/ }));
    await user.click(screen.getByRole("button", { name: "New company" }));

    // The form is asked for from this group's page, so it opens on this group
    // rather than asking which one was meant.
    await waitFor(() => expect(screen.getByLabelText(/^Group/)).toHaveValue("1"));

    await user.type(screen.getByLabelText(/^Company name/), "Patel Spinning Pvt Ltd");
    await user.click(screen.getByRole("button", { name: "Add client" }));

    await waitFor(() =>
      expect(
        backend().book.clients.find((row) => row.fullName === "Patel Spinning Pvt Ltd")?.groupId,
      ).toBe(1),
    );
    expect(await screen.findByText("Added to Patel Group")).toBeInTheDocument();
  });

  it("warns before moving somebody who is already filed elsewhere", async () => {
    const { user } = openGroup();
    await screen.findByRole("heading", { name: "Patel Group" });

    await user.click(screen.getByRole("button", { name: /Add member/ }));
    await user.type(screen.getByPlaceholderText("Sundaram Textiles"), "Patel Weaves");

    // A client sits in one group at a time, so the search has to say which one
    // they would be leaving.
    expect(await screen.findByText(/already in this group/)).toBeInTheDocument();
  });
});

describe("archiving and deleting a group", () => {
  it("archives the members with the group, and reaches no one else", async () => {
    const { user } = openGroup();
    await screen.findByRole("heading", { name: "Patel Group" });

    await user.click(screen.getByRole("button", { name: "Archive group and members" }));

    expect(await screen.findByText("Group archived with 2 clients")).toBeInTheDocument();
    const clients = backend().book.clients;
    expect(clients.find((row) => row.id === 12)?.isArchived).toBe(true);
    expect(clients.find((row) => row.id === 3)?.isArchived).toBe(false);
  });

  it("deletes the group and releases the clients rather than taking them", async () => {
    const { user } = openGroup();
    await screen.findByRole("heading", { name: "Patel Group" });

    await user.click(screen.getByRole("button", { name: /Delete group/ }));
    // The modal has to say what survives, because a folder that took its
    // contents with it is the reasonable thing to fear here.
    expect(await screen.findByText(/2 clients stay in the book/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Delete the group, keep the clients/ }));

    await waitFor(() => expect(backend().book.groups).toHaveLength(0));
    expect(backend().book.clients.find((row) => row.id === 12)).toBeDefined();
    expect(backend().book.clients.find((row) => row.id === 12)?.groupId).toBeNull();
    await waitFor(() => expect(currentRoute()).toBe("/groups"));
  });
});
