/**
 * The groups list: what a group row says about the book underneath it, and what
 * archiving one does to the clients filed in it.
 */

import { describe, expect, it } from "vitest";

import {
  backend,
  createBook,
  installBackend,
  renderWithProviders,
  screen,
  waitFor,
  withGroups,
  within,
} from "@/test";
import type { GroupFilter } from "@/lib/types";
import { GroupsPage } from "@/pages/Groups";

/** The filter the list last asked the core for. */
function lastFilter(): GroupFilter | undefined {
  return backend().lastCall("list_groups")?.filter as GroupFilter | undefined;
}

function openGroups() {
  installBackend(withGroups(createBook()));
  return renderWithProviders(<GroupsPage />);
}

function row(name: string | RegExp): HTMLElement {
  return screen.getByRole("row", { name });
}

describe("the groups list", () => {
  it("draws a row for every group, with the book its members hold", async () => {
    openGroups();

    expect(await screen.findByText("Patel Group")).toBeInTheDocument();
    const patel = within(row(/Patel Group/));
    expect(patel.getByText("GR-00001")).toBeInTheDocument();
    // Two firms and one policy each, so the members count and the active count
    // both read 2, and the premium is the two of them added up.
    expect(patel.getAllByText("2")).toHaveLength(2);
    expect(patel.getByText("/ 2")).toBeInTheDocument();
    expect(patel.getByText("₹4,98,500")).toBeInTheDocument();
    expect(patel.getByText("28 Feb 2027")).toBeInTheDocument();
  });

  it("names the head as plain text, with what they do beneath it", async () => {
    openGroups();
    await screen.findByText("Patel Group");

    const patel = within(row(/Patel Group/));
    expect(patel.getByText("Vikram Patel")).toBeInTheDocument();
    expect(patel.getByText("Insurance broker")).toBeInTheDocument();
    // The head is a contact written on the group, so there is no client page
    // for the column to lead to.
    expect(patel.queryByRole("link", { name: /Vikram Patel/ })).toBeNull();
  });

  it("says so plainly when nobody is named as the head", async () => {
    const book = withGroups(createBook());
    book.groups[0].headName = null;
    book.groups[0].headDesignation = null;
    installBackend(book);
    renderWithProviders(<GroupsPage />);

    expect(await screen.findByText("No referrer on file")).toBeInTheDocument();
  });

  it("hides archived groups until they are asked for", async () => {
    const book = withGroups(createBook());
    book.groups[0].isArchived = true;
    installBackend(book);
    const { user } = renderWithProviders(<GroupsPage />);

    // Asking for archived groups is not a filter that narrows, so a desk whose
    // only group is put away reads as a desk with no groups — the same way the
    // clients list treats an archived book.
    expect(await screen.findByText("No groups yet")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Include archived"));

    expect(await screen.findByText("Patel Group")).toBeInTheDocument();
    expect(within(row(/Patel Group/)).getByText("Archived")).toBeInTheDocument();
  });

  it("searches by name, code or the head's name", async () => {
    const { user } = openGroups();
    await screen.findByText("Patel Group");

    await user.type(screen.getByPlaceholderText("Group name, code or the referrer's name"), "Vikram");

    await waitFor(() => expect(lastFilter()).toMatchObject({ search: "Vikram" }));
    expect(await screen.findByText("Patel Group")).toBeInTheDocument();
  });

  it("invites the first group when the desk has none", async () => {
    renderWithProviders(<GroupsPage />);

    expect(await screen.findByText("No groups yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open a group" })).toBeInTheDocument();
  });
});

describe("archiving a group from the list", () => {
  it("takes the members with it, and says how many went", async () => {
    const { user } = openGroups();
    await screen.findByText("Patel Group");

    await user.click(within(row(/Patel Group/)).getByRole("button", { name: "Archive" }));

    // The count is the point: an operator who thought they were putting away one
    // row put away two clients with it.
    expect(await screen.findByText("Group archived with 2 clients")).toBeInTheDocument();
    const clients = backend().book.clients;
    expect(clients.find((row) => row.id === 12)?.isArchived).toBe(true);
    expect(clients.find((row) => row.id === 13)?.isArchived).toBe(true);
    // The client who shares the head's name was never in the group, so nothing
    // about archiving it reaches him.
    expect(clients.find((row) => row.id === 3)?.isArchived).toBe(false);
  });
});
