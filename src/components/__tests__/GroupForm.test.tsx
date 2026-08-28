/**
 * The form that opens a group.
 *
 * The one thing it does differently from every other form here is the referrer:
 * a group head is a client, so the field is a search of the book rather than a
 * box to type a name into.
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
} from "@/test";
import type { GroupInput } from "@/lib/types";
import { GroupForm } from "@/components/GroupForm";

function lastInput(): GroupInput | undefined {
  return backend().lastCall("create_group")?.input as GroupInput | undefined;
}

function openNew() {
  return renderWithProviders(<GroupForm open onClose={() => {}} />);
}

describe("opening a group", () => {
  it("reserves the next group code", async () => {
    const { user } = openNew();

    await waitFor(() => expect(screen.getByLabelText(/Group code/)).toHaveValue("GR-00001"));
    await user.type(screen.getByLabelText(/Group name/), "Patel Group");
  });

  it("finds the referrer in the book and saves their id, not their name", async () => {
    const { user } = openNew();
    await waitFor(() => expect(screen.getByLabelText(/Group code/)).toHaveValue("GR-00001"));

    await user.type(screen.getByLabelText(/Group name/), "Patel Group");
    await user.type(screen.getByPlaceholderText("Search the book by name"), "Vikram");
    await user.click(await screen.findByText("Vikram Patel"));
    await user.click(screen.getByRole("button", { name: "Open group" }));

    await waitFor(() =>
      expect(lastInput()).toMatchObject({ name: "Patel Group", headClientId: 3 }),
    );
  });

  it("refuses to open a group with nobody named as the referrer", async () => {
    const { user } = openNew();
    await waitFor(() => expect(screen.getByLabelText(/Group code/)).toHaveValue("GR-00001"));

    await user.type(screen.getByLabelText(/Group name/), "Patel Group");
    await user.click(screen.getByRole("button", { name: "Open group" }));

    // Said here as well as in the core, because the reason is worth having on
    // screen while the box that fixes it is still open.
    expect(await screen.findByText("Name the client who referred this group")).toBeInTheDocument();
    expect(backend().countOf("create_group")).toBe(0);
  });

  it("says so when the search finds nobody, rather than offering to invent them", async () => {
    const { user } = openNew();
    await waitFor(() => expect(screen.getByLabelText(/Group code/)).toHaveValue("GR-00001"));

    await user.type(screen.getByPlaceholderText("Search the book by name"), "Nobody At All");

    // Unlike the family panel, this form will not open a client for you: a
    // referrer is somebody the agency already deals with.
    expect(await screen.findByText(/A group head has to be a client/)).toBeInTheDocument();
  });

  it("lets the referrer be swapped for somebody else", async () => {
    const { user } = openNew();
    await waitFor(() => expect(screen.getByLabelText(/Group code/)).toHaveValue("GR-00001"));

    await user.type(screen.getByPlaceholderText("Search the book by name"), "Vikram");
    await user.click(await screen.findByText("Vikram Patel"));
    await user.click(screen.getByRole("button", { name: "Change" }));

    expect(screen.getByPlaceholderText("Search the book by name")).toHaveValue("");
  });
});

describe("editing a group", () => {
  it("opens with the group as it stands, referrer and all", async () => {
    const book = withGroups(createBook());
    installBackend(book);
    renderWithProviders(<GroupForm open group={book.groups[0]} onClose={() => {}} />);

    expect(screen.getByLabelText(/Group name/)).toHaveValue("Patel Group");
    expect(screen.getByLabelText(/Group code/)).toHaveValue("GR-00001");
    expect(screen.getByText(/Vikram Patel/)).toBeInTheDocument();
    // No code is reserved when editing: the group already has one.
    expect(backend().countOf("next_group_code")).toBe(0);
  });
});
