/**
 * The client form: what it shows, what it sends, and how it behaves when the
 * core refuses the save.
 */

import { describe, expect, it, vi } from "vitest";

import {
  backend,
  createBook,
  installBackend,
  renderWithProviders,
  screen,
  waitFor,
  withGroups,
} from "@/test";
import type { Client, ClientInput } from "@/lib/types";
import { ClientForm } from "@/components/ClientForm";

/** A client out of the book, by the id the fixtures give them. */
function client(id: number): Client {
  return backend().book.clients.find((row) => row.id === id)!;
}

function renderForm(props: { client?: Client } = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const rendered = renderWithProviders(
    <ClientForm open onClose={onClose} onSaved={onSaved} client={props.client} />,
  );
  return { ...rendered, onClose, onSaved, props };
}

/** A field by its label. The labels wrap their hint, so these are loose. */
function field(label: RegExp): HTMLElement {
  return screen.getByLabelText(label);
}

function addButton(): HTMLElement {
  return screen.getByRole("button", { name: "Add client" });
}

/** What the last save sent across the bridge. */
function sentInput(command: "create_client" | "update_client"): ClientInput {
  return backend().lastCall(command)?.input as ClientInput;
}

/**
 * The code the book would hand out next: one past the highest of the eleven
 * clients it holds, family members included, since they are clients too.
 */
const NEXT_CODE = "CL-00012";

/** Waits for the reserved client code, so a test does not race the fetch. */
async function codeReserved(): Promise<void> {
  await waitFor(() => expect(field(/^Client code/)).toHaveValue(NEXT_CODE));
}

describe("the new client form", () => {
  it("offers every field the guide promises", async () => {
    renderForm();

    expect(screen.getByRole("dialog", { name: "New client" })).toBeInTheDocument();
    expect(
      screen.getByText("Only the name is required — the rest can be filled in as you learn it."),
    ).toBeInTheDocument();

    for (const label of [
      /^Client type/,
      /^Full name/,
      /^Client code/,
      /^Mobile/,
      /^Email/,
      /^Alternate phone/,
      /^Date of birth/,
      /^Gender/,
      /^Address/,
      /^Area \/ locality/,
      /^City/,
      /^State/,
      /^Pincode/,
      /^Occupation/,
      /^PAN/,
      /^Notes/,
    ]) {
      expect(field(label)).toBeInTheDocument();
    }
    expect(screen.getByRole("checkbox", { name: /Do not send reminders/ })).toBeInTheDocument();
    await codeReserved();
  });

  it("marks the name as the only required field", async () => {
    renderForm();

    expect(screen.getByText("Full name").parentElement).toHaveTextContent("Full name *");
    expect(screen.getAllByText("*")).toHaveLength(1);
    await codeReserved();
  });

  it("reserves the next client code and fills it in", async () => {
    renderForm();

    await codeReserved();
    expect(backend().countOf("next_client_code")).toBe(1);
  });

  it("lets the agent keep their own numbering", async () => {
    const { user } = renderForm();
    await codeReserved();

    await user.clear(field(/^Client code/));
    await user.type(field(/^Client code/), "RS/2026/14");
    await user.type(field(/^Full name/), "Nikhil Rao");
    await user.click(addButton());

    await waitFor(() => expect(sentInput("create_client").clientCode).toBe("RS/2026/14"));
  });

  it("asks for nothing while it is closed", () => {
    renderWithProviders(<ClientForm open={false} onClose={vi.fn()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(backend().countOf("next_client_code")).toBe(0);
  });

  it("sends what was typed, and nothing else", async () => {
    const { user, onSaved } = renderForm();
    await codeReserved();

    await user.type(field(/^Full name/), "Nikhil Rao");
    await user.type(field(/^Mobile/), "9876500000");
    await user.type(field(/^Email/), "nikhil.rao@example.com");
    await user.type(field(/^City/), "Indore");
    await user.type(field(/^Notes/), "Met at the Diwali mela.");
    await user.selectOptions(field(/^Gender/), "male");
    await user.click(addButton());

    await waitFor(() => expect(backend().countOf("create_client")).toBe(1));
    expect(sentInput("create_client")).toMatchObject({
      fullName: "Nikhil Rao",
      clientCode: NEXT_CODE,
      phone: "9876500000",
      email: "nikhil.rao@example.com",
      city: "Indore",
      gender: "male",
      notes: "Met at the Diwali mela.",
      remindersOptedOut: false,
    });
    expect(onSaved).toHaveBeenCalledWith(expect.any(Number));
  });

  it("adds the client to the book and says so", async () => {
    const { user, onClose } = renderForm();
    await codeReserved();

    await user.type(field(/^Full name/), "Nikhil Rao");
    await user.click(addButton());

    expect(await screen.findByText("Client added")).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
    expect(backend().book.clients.map((row) => row.fullName)).toContain("Nikhil Rao");
  });

  it("keeps a date of birth and a pincode as typed", async () => {
    const { user } = renderForm();
    await codeReserved();

    await user.type(field(/^Full name/), "Nikhil Rao");
    await user.type(field(/^Date of birth/), "1991-03-04");
    await user.type(field(/^Pincode/), "452001");
    await user.click(addButton());

    await waitFor(() =>
      expect(sentInput("create_client")).toMatchObject({
        dateOfBirth: "1991-03-04",
        pincode: "452001",
      }),
    );
  });

  it("upper-cases a PAN as it is typed", async () => {
    const { user } = renderForm();
    await codeReserved();

    await user.type(field(/^PAN/), "abcpn1234f");

    expect(field(/^PAN/)).toHaveValue("ABCPN1234F");
  });

  it("respects a client who asked not to be emailed", async () => {
    const { user } = renderForm();
    await codeReserved();

    await user.type(field(/^Full name/), "Nikhil Rao");
    await user.click(screen.getByRole("checkbox", { name: /Do not send reminders/ }));
    await user.click(addButton());

    await waitFor(() => expect(sentInput("create_client").remindersOptedOut).toBe(true));
  });

  it("sends the fields left blank as null", async () => {
    const { user } = renderForm();
    await codeReserved();

    await user.type(field(/^Full name/), "Nikhil Rao");
    await user.click(addButton());

    await waitFor(() => expect(backend().countOf("create_client")).toBe(1));
    expect(sentInput("create_client")).toMatchObject({
      email: null,
      phone: null,
      altPhone: null,
      dateOfBirth: null,
      gender: null,
      city: null,
      notes: null,
    });
  });

  it("saves when Enter is pressed in a field", async () => {
    const { user } = renderForm();
    await codeReserved();

    await user.type(field(/^Full name/), "Nikhil Rao{Enter}");

    await waitFor(() => expect(backend().countOf("create_client")).toBe(1));
  });

  it("refuses an email address that is not one", async () => {
    const { user } = renderForm();
    await codeReserved();

    await user.type(field(/^Full name/), "Nikhil Rao");
    await user.type(field(/^Email/), "nikhil.rao at example.com");
    await user.click(addButton());

    expect(await screen.findByText(/email address/i)).toBeInTheDocument();
    expect(backend().countOf("create_client")).toBe(0);
  });
});

describe("editing a client", () => {
  it("fills every field from the client", async () => {
    renderForm({ client: client(1) });

    expect(screen.getByRole("dialog", { name: "Edit Rohit Sharma" })).toBeInTheDocument();
    expect(field(/^Full name/)).toHaveValue("Rohit Sharma");
    expect(field(/^Client code/)).toHaveValue("CL-00001");
    expect(field(/^Mobile/)).toHaveValue("98765 43210");
    expect(field(/^Email/)).toHaveValue("rohit.sharma@example.com");
    expect(field(/^Alternate phone/)).toHaveValue("");
    expect(field(/^Date of birth/)).toHaveValue("1986-04-12");
    expect(field(/^Gender/)).toHaveValue("male");
    expect(field(/^Address/)).toHaveValue("Flat 402, Green Meadows");
    expect(field(/^Area \/ locality/)).toHaveValue("Baner Road");
    expect(field(/^City/)).toHaveValue("Pune");
    expect(field(/^State/)).toHaveValue("Maharashtra");
    expect(field(/^Pincode/)).toHaveValue("411045");
    expect(field(/^Occupation/)).toHaveValue("Software engineer");
    expect(field(/^PAN/)).toHaveValue("ABCPS1234F");
    expect(field(/^Notes/)).toHaveValue("Prefers a call before renewal.");
    expect(screen.getByRole("checkbox", { name: /Do not send reminders/ })).not.toBeChecked();
  });

  it("does not reserve a code for a client who has one", () => {
    renderForm({ client: client(1) });

    expect(backend().countOf("next_client_code")).toBe(0);
  });

  it("shows an opted-out client as opted out", () => {
    renderForm({ client: client(8) });

    expect(screen.getByRole("checkbox", { name: /Do not send reminders/ })).toBeChecked();
  });

  it("saves the change against the same client", async () => {
    const { user, onClose, onSaved } = renderForm({ client: client(1) });

    await user.clear(field(/^Occupation/));
    await user.type(field(/^Occupation/), "Product manager");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(backend().countOf("update_client")).toBe(1));
    expect(backend().lastCall("update_client")?.id).toBe(1);
    expect(sentInput("update_client")).toMatchObject({
      fullName: "Rohit Sharma",
      clientCode: "CL-00001",
      occupation: "Product manager",
      email: "rohit.sharma@example.com",
      city: "Pune",
    });
    expect(backend().countOf("create_client")).toBe(0);
    expect(await screen.findByText("Client updated")).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(1);
  });

  it("lets an email be taken off a client who asked to stop", async () => {
    const { user } = renderForm({ client: client(1) });

    await user.clear(field(/^Email/));
    await user.click(screen.getByRole("checkbox", { name: /Do not send reminders/ }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(backend().countOf("update_client")).toBe(1));
    expect(sentInput("update_client").remindersOptedOut).toBe(true);
  });

  it("keeps the fields the form does not show", async () => {
    const row = client(1);
    row.gstin = "27ABCPS1234F1Z5";
    row.preferredLanguage = "hi";
    const { user } = renderForm({ client: row });

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(backend().countOf("update_client")).toBe(1));
    expect(sentInput("update_client")).toMatchObject({
      gstin: "27ABCPS1234F1Z5",
      preferredLanguage: "hi",
    });
  });
});

describe("when the form is refused", () => {
  it("says a client needs a name, and adds nobody", async () => {
    const { user, onClose } = renderForm();
    await codeReserved();

    await user.click(addButton());

    expect(await screen.findByText("Client name is required")).toBeInTheDocument();
    expect(backend().book.clients).toHaveLength(11);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("treats a name of spaces as no name at all", async () => {
    const { user } = renderForm();
    await codeReserved();

    await user.type(field(/^Full name/), "   ");
    await user.click(addButton());

    expect(await screen.findByText("Client name is required")).toBeInTheDocument();
  });

  it("shows a validation error from the core against the form", async () => {
    backend().fail("create_client", {
      kind: "validation",
      message: "That PAN is not in the right shape",
    });
    const { user, onClose } = renderForm();
    await codeReserved();

    await user.type(field(/^Full name/), "Nikhil Rao");
    await user.click(addButton());

    expect(await screen.findByText("That PAN is not in the right shape")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(field(/^Full name/)).toHaveValue("Nikhil Rao");
  });

  it("shows a clash from the core against the form", async () => {
    backend().fail("create_client", {
      kind: "conflict",
      message: "CL-00009 already belongs to someone",
    });
    const { user } = renderForm();
    await codeReserved();

    await user.type(field(/^Full name/), "Nikhil Rao");
    await user.click(addButton());

    expect(await screen.findByText("CL-00009 already belongs to someone")).toBeInTheDocument();
  });

  it("lets the save be tried again once the core is happy", async () => {
    backend().failOnce("create_client", { kind: "internal", message: "The book is busy" });
    const { user } = renderForm();
    await codeReserved();

    await user.type(field(/^Full name/), "Nikhil Rao");
    await user.click(addButton());
    await screen.findByText("The book is busy");
    await user.click(addButton());

    expect(await screen.findByText("Client added")).toBeInTheDocument();
    expect(backend().countOf("create_client")).toBe(2);
  });

  it("clears the last error when the form is opened again", async () => {
    backend().fail("create_client", { kind: "internal", message: "The book is busy" });
    const { user, rerender, onClose } = renderForm();
    await codeReserved();

    await user.type(field(/^Full name/), "Nikhil Rao");
    await user.click(addButton());
    await screen.findByText("The book is busy");

    rerender(<ClientForm open={false} onClose={onClose} />);
    rerender(<ClientForm open onClose={onClose} />);

    expect(screen.queryByText("The book is busy")).not.toBeInTheDocument();
  });
});

describe("leaving the form", () => {
  it("discards the entry on Cancel", async () => {
    const { user, onClose } = renderForm();
    await codeReserved();

    await user.type(field(/^Full name/), "Nikhil Rao");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(backend().countOf("create_client")).toBe(0);
  });

  it("opens blank again after a cancel", async () => {
    const { user, rerender, onClose } = renderForm();
    await codeReserved();

    await user.type(field(/^Full name/), "Nikhil Rao");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    rerender(<ClientForm open={false} onClose={onClose} />);
    rerender(<ClientForm open onClose={onClose} />);

    expect(field(/^Full name/)).toHaveValue("");
  });

  it("closes on the X and on Escape", async () => {
    const { user, onClose } = renderForm();
    await codeReserved();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("while the save is in flight", () => {
  it("holds the buttons and shows the save is running", async () => {
    const gate = backend().hold("create_client");
    const { user, onClose } = renderForm();
    await codeReserved();

    await user.type(field(/^Full name/), "Nikhil Rao");
    await user.click(addButton());

    await waitFor(() => expect(addButton()).toBeDisabled());
    expect(onClose).not.toHaveBeenCalled();

    gate.release();
    expect(await screen.findByText("Client added")).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it("adds one client on a double click", async () => {
    const gate = backend().hold("create_client");
    const { user } = renderForm();
    await codeReserved();

    await user.type(field(/^Full name/), "Nikhil Rao");
    await user.dblClick(addButton());

    gate.release();
    await waitFor(() => expect(screen.queryByText("Client added")).toBeInTheDocument());
    expect(backend().countOf("create_client")).toBe(1);
    expect(backend().book.clients.filter((row) => row.fullName === "Nikhil Rao")).toHaveLength(1);
  });
});

describe("entering a company", () => {
  it("asks a firm for a contact rather than a birthday", async () => {
    const { user } = renderForm();
    await codeReserved();

    await user.selectOptions(field(/^Client type/), "company");

    expect(screen.getByRole("dialog", { name: "New company" })).toBeInTheDocument();
    for (const label of [
      /^Company name/,
      /^Contact person/,
      /^Designation/,
      /^GSTIN/,
      /^Registration number/,
    ]) {
      expect(field(label)).toBeInTheDocument();
    }
    // A firm has neither, and a form that asked would be asking a question with
    // no answer.
    expect(screen.queryByLabelText(/^Date of birth/)).toBeNull();
    expect(screen.queryByLabelText(/^Gender/)).toBeNull();
    // What a person does for a living is what a firm does for a trade.
    expect(field(/^Industry/)).toBeInTheDocument();
  });

  it("sends the corporate columns and no date of birth", async () => {
    const { user } = renderForm();
    await codeReserved();

    await user.selectOptions(field(/^Client type/), "company");
    await user.type(field(/^Company name/), "Patel Weaves Pvt Ltd");
    await user.type(field(/^Contact person/), "Nishita Patel");
    await user.type(field(/^Designation/), "Finance Manager");
    await user.type(field(/^GSTIN/), "24aabcp1429b1zk");
    await user.type(field(/^Registration number/), "u17111gj2011ptc067421");
    await user.click(addButton());

    await waitFor(() => expect(backend().countOf("create_client")).toBe(1));
    expect(sentInput("create_client")).toMatchObject({
      kind: "company",
      fullName: "Patel Weaves Pvt Ltd",
      contactPerson: "Nishita Patel",
      contactDesignation: "Finance Manager",
      // Typed in either case and stored in one, as the core stores them.
      gstin: "24AABCP1429B1ZK",
      registrationNo: "U17111GJ2011PTC067421",
      dateOfBirth: null,
      gender: null,
    });
  });

  it("does not keep a birthday the operator can no longer see", async () => {
    const { user } = renderForm();
    await codeReserved();

    // Entered as a person, then corrected to a firm. The boxes go, and what
    // went with them must not be saved behind the operator's back.
    await user.type(field(/^Full name/), "Patel Weaves Pvt Ltd");
    await user.type(field(/^Date of birth/), "1986-04-12");
    await user.selectOptions(field(/^Client type/), "company");
    await user.click(addButton());

    await waitFor(() => expect(backend().countOf("create_client")).toBe(1));
    expect(sentInput("create_client").dateOfBirth).toBeNull();
  });

  it("drops the corporate columns when a firm turns out to be a person", async () => {
    const { user } = renderForm();
    await codeReserved();

    await user.selectOptions(field(/^Client type/), "company");
    await user.type(field(/^Company name/), "Nikhil Rao");
    await user.type(field(/^Contact person/), "Somebody Else");
    await user.selectOptions(field(/^Client type/), "individual");
    await user.click(addButton());

    await waitFor(() => expect(backend().countOf("create_client")).toBe(1));
    expect(sentInput("create_client")).toMatchObject({
      kind: "individual",
      contactPerson: null,
      contactDesignation: null,
      registrationNo: null,
    });
  });

  it("opens as a company when the screen asking for one opened it", async () => {
    renderWithProviders(
      <ClientForm open defaultKind="company" onClose={vi.fn()} />,
    );

    expect(screen.getByRole("dialog", { name: "New company" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Company name/)).toBeInTheDocument();
  });

  it("opens an existing company as one, and leaves its group alone on save", async () => {
    const book = withGroups(createBook());
    installBackend(book);
    const company = book.clients.find((row) => row.id === 12)!;
    const { user } = renderWithProviders(
      <ClientForm open client={company} onClose={vi.fn()} />,
    );

    expect(screen.getByLabelText(/^Client type/)).toHaveValue("company");
    expect(screen.getByLabelText(/^Contact person/)).toHaveValue("Nishita Patel");

    await user.clear(screen.getByLabelText(/^Mobile/));
    await user.type(screen.getByLabelText(/^Mobile/), "7926304412");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    // The form draws no group, so it sends none, and the core keeps the one the
    // client is in. Editing a phone number is not a way out of a group.
    await waitFor(() => expect(backend().countOf("update_client")).toBe(1));
    expect(sentInput("update_client").groupId).toBeUndefined();
    expect(backend().book.clients.find((row) => row.id === 12)?.groupId).toBe(1);
  });
});
