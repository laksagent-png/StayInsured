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

  it("names the referrer, and links to them rather than to the group", async () => {
    openGroups();
    await screen.findByText("Patel Group");

    const referrer = within(row(/Patel Group/)).getByRole("link", { name: /Vikram Patel/ });
    expect(referrer).toHaveAttribute("href", "/clients/3");
  });

  it("says so plainly when a group has outlived the client who referred it", async () => {
    const book = withGroups(createBook());
    // What the schema does when a referrer is deleted: the group stands, with
    // nobody named on it.
    book.groups[0].headClientId = null;
    book.groups[0].headName = null;
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

  it("searches by name, code or the referrer's name", async () => {
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
    // The referrer was never in the group, so they stay where they were.
    expect(clients.find((row) => row.id === 3)?.isArchived).toBe(false);
  });
});
