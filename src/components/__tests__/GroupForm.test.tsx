/**
 * The form that opens a group.
 *
 * The head is four boxes written on the group. Naming one adds nobody to the
 * book, and leaving all four empty is a group like any other.
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
import type { Group, GroupInput } from "@/lib/types";
import { GroupForm } from "@/components/GroupForm";

function lastInput(): GroupInput | undefined {
  return backend().lastCall("create_group")?.input as GroupInput | undefined;
}

/** The group the fake core wrote, as it holds it. */
function saved(name: string): Group | undefined {
  return backend().book.groups.find((row) => row.name === name);
}

function openNew() {
  return renderWithProviders(<GroupForm open onClose={() => {}} />);
}

async function codeReserved(): Promise<void> {
  await waitFor(() => expect(screen.getByLabelText(/^Group code/)).toHaveValue("GR-00001"));
}

describe("opening a group", () => {
  it("reserves the next group code", async () => {
    const { user } = openNew();

    await codeReserved();
    await user.type(screen.getByLabelText(/^Group name/), "Patel Group");
  });

  it("asks for the head in four plain boxes, and requires none of them", async () => {
    openNew();
    await codeReserved();

    for (const label of [/^Group head/, /^Designation/, /^Phone/, /^Email/]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("Who introduced this group")).toBeInTheDocument();
    // Only the group's own name is required.
    expect(screen.getAllByText("*")).toHaveLength(1);
  });

  it("records the head on the group without adding them to the book", async () => {
    const { user } = openNew();
    await codeReserved();

    await user.type(screen.getByLabelText(/^Group name/), "Patel Group");
    await user.type(screen.getByLabelText(/^Group head/), "Nirmal Shah");
    await user.type(screen.getByLabelText(/^Designation/), "Chartered accountant");
    await user.type(screen.getByLabelText(/^Phone/), "9825011223");
    await user.type(screen.getByLabelText(/^Email/), "nirmal@example.com");
    await user.click(screen.getByRole("button", { name: "Open group" }));

    await waitFor(() =>
      expect(lastInput()).toMatchObject({
        name: "Patel Group",
        headName: "Nirmal Shah",
        headDesignation: "Chartered accountant",
        headPhone: "9825011223",
        headEmail: "nirmal@example.com",
      }),
    );
    // A referrer is somebody to ring, not somebody to insure. The book is the
    // same size it was.
    expect(backend().book.clients).toHaveLength(11);
    expect(backend().countOf("create_client")).toBe(0);
    expect(backend().countOf("list_clients")).toBe(0);
  });

  it("opens a group before anybody knows who referred it", async () => {
    const { user } = openNew();
    await codeReserved();

    await user.type(screen.getByLabelText(/^Group name/), "Patel Group");
    await user.click(screen.getByRole("button", { name: "Open group" }));

    await waitFor(() => expect(backend().countOf("create_group")).toBe(1));
    expect(await screen.findByText("Group opened")).toBeInTheDocument();
    expect(saved("Patel Group")?.headName).toBeNull();
  });

  it("treats a head made of spaces as no head at all", async () => {
    const { user } = openNew();
    await codeReserved();

    await user.type(screen.getByLabelText(/^Group name/), "Patel Group");
    await user.type(screen.getByLabelText(/^Group head/), "   ");
    await user.click(screen.getByRole("button", { name: "Open group" }));

    await waitFor(() => expect(backend().countOf("create_group")).toBe(1));
    // Nothing, rather than an empty string somebody later has to explain.
    expect(lastInput()?.headName).toBeNull();
    expect(saved("Patel Group")?.headName).toBeNull();
  });

  it("holds the head's phone and email to the shape a client's are held to", async () => {
    const { user } = openNew();
    await codeReserved();

    await user.type(screen.getByLabelText(/^Group name/), "Patel Group");
    await user.type(screen.getByLabelText(/^Phone/), "+91 98765-43210");
    await user.type(screen.getByLabelText(/^Email/), "mehta at example.com");
    await user.click(screen.getByRole("button", { name: "Open group" }));

    expect(await screen.findByText("The group head's email is not an address")).toBeInTheDocument();
    expect(backend().book.groups).toHaveLength(0);

    await user.clear(screen.getByLabelText(/^Email/));
    await user.click(screen.getByRole("button", { name: "Open group" }));

    await waitFor(() => expect(saved("Patel Group")).toBeDefined());
    expect(saved("Patel Group")?.headPhone).toBe("+919876543210");
    expect(saved("Patel Group")?.headEmail).toBeNull();
  });

  it("still refuses a group with no name of its own", async () => {
    const { user } = openNew();
    await codeReserved();

    await user.type(screen.getByLabelText(/^Group head/), "Nirmal Shah");
    await user.click(screen.getByRole("button", { name: "Open group" }));

    expect(await screen.findByText("Give the group a name")).toBeInTheDocument();
    expect(backend().countOf("create_group")).toBe(0);
  });
});

describe("editing a group", () => {
  it("opens with the group as it stands, head and all", async () => {
    const book = withGroups(createBook());
    installBackend(book);
    renderWithProviders(<GroupForm open group={book.groups[0]} onClose={() => {}} />);

    expect(screen.getByLabelText(/^Group name/)).toHaveValue("Patel Group");
    expect(screen.getByLabelText(/^Group code/)).toHaveValue("GR-00001");
    expect(screen.getByLabelText(/^Group head/)).toHaveValue("Vikram Patel");
    expect(screen.getByLabelText(/^Designation/)).toHaveValue("Insurance broker");
    expect(screen.getByLabelText(/^Phone/)).toHaveValue("+919925044556");
    expect(screen.getByLabelText(/^Email/)).toHaveValue("vikram.patel@example.com");
    // No code is reserved when editing: the group already has one.
    expect(backend().countOf("next_group_code")).toBe(0);
  });

  it("names a head on a group that had none", async () => {
    const book = withGroups(createBook());
    book.groups[0].headName = null;
    book.groups[0].headDesignation = null;
    book.groups[0].headPhone = null;
    book.groups[0].headEmail = null;
    installBackend(book);
    const { user } = renderWithProviders(
      <GroupForm open group={book.groups[0]} onClose={() => {}} />,
    );

    await user.type(screen.getByLabelText(/^Group head/), "Nirmal Shah");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(backend().book.groups[0].headName).toBe("Nirmal Shah"));
    // Naming a head moves nobody: the two firms are still where they were.
    expect(backend().book.groups[0].members).toBe(2);
  });
});
