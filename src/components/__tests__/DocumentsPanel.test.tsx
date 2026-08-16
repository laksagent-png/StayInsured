/**
 * The paperwork panel on a client: what each row tells the agent, and every way
 * a document gets into the book, back out of it, or onto the screen.
 */

import { describe, expect, it, vi } from "vitest";

import { DocumentsPanel } from "@/components/DocumentsPanel";
import {
  backend,
  renderWithProviders,
  screen,
  tauriDialog,
  waitFor,
  within,
  type Rendered,
} from "@/test";

const PICKED = "/Users/you/Downloads/renewal-notice.pdf";

/** Client 1 keeps four documents; client 5 keeps none. */
function openPanel(clientId = 1): Rendered {
  return renderWithProviders(<DocumentsPanel clientId={clientId} />);
}

/** Answers the confirmation the panel puts up, and reports what it asked. */
function confirms(answer: boolean) {
  return vi.spyOn(window, "confirm").mockReturnValue(answer);
}

/** The row a document occupies, found by its title. */
function documentRow(title: string): HTMLElement {
  return screen.getByText(title).closest("li") as HTMLElement;
}

/** The second line of a row: the policy, the size and when it arrived. */
function rowDetail(row: HTMLElement): string {
  return row.querySelectorAll("p")[1]?.textContent ?? "";
}

/** Everything clickable on a row: the title, then the two icons after it. */
function rowButtons(row: HTMLElement): HTMLElement[] {
  return within(row).getAllByRole("button");
}

/** The icons at the end of a row, each named after the document it acts on. */
function saveCopy(title: string): HTMLElement {
  return within(documentRow(title)).getByRole("button", { name: `Save a copy of ${title}` });
}

function removeDocument(title: string): HTMLElement {
  return within(documentRow(title)).getByRole("button", { name: `Remove ${title}` });
}

describe("the documents list", () => {
  it("lists the paperwork newest first, with its policy, size and date", async () => {
    openPanel();
    await screen.findByText("Registration certificate");

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(4);

    expect(rows[0]).toHaveTextContent("Registration certificate");
    expect(rowDetail(rows[0])).toBe("IL/MOT/778211 · 719 KB · 01 Sep 2025");
    expect(rows[1]).toHaveTextContent("Policy schedule 2025-26");
    expect(rowDetail(rows[1])).toBe("SH/2025/0091823 · 403 KB · 21 Aug 2025");
    expect(rows[2]).toHaveTextContent("Proposal form, signed");
    expect(rowDetail(rows[2])).toBe("SH/2025/0091823 · 1.2 MB · 20 Aug 2025");
    expect(backend().lastCall("list_documents")).toMatchObject({ clientId: 1 });
  });

  it("names the document on every button of its row", async () => {
    openPanel();
    await screen.findByText("PAN card");
    const row = documentRow("PAN card");

    expect(rowButtons(row)).toHaveLength(3);
    expect(saveCopy("PAN card")).toHaveAttribute("title", "Save a copy of PAN card");
    expect(removeDocument("PAN card")).toHaveAttribute("title", "Remove PAN card");
    // The title itself opens the document, and reads out the whole row.
    expect(within(row).getByRole("button", { name: /^PAN card/ })).toBe(rowButtons(row)[0]);
  });

  it("names no policy for papers that belong to the client themself", async () => {
    openPanel();
    await screen.findByText("PAN card");

    expect(rowDetail(documentRow("PAN card"))).toBe("164 KB · 19 Aug 2024");
  });

  it("invites the first document when the client has none", async () => {
    openPanel(5);

    expect(
      await screen.findByText(/Keep the policy schedule, the proposal form and the ID proof here/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("holds a spinner while the paperwork is being read", async () => {
    const gate = backend().hold("list_documents");
    openPanel();

    expect(await screen.findByText("Loading")).toBeInTheDocument();

    gate.release();
    expect(await screen.findByText("PAN card")).toBeInTheDocument();
  });

  it("says when the paperwork could not be read", async () => {
    backend().fail("list_documents", { kind: "internal", message: "The book would not open" });
    openPanel();

    await waitFor(() => expect(screen.queryByText("Loading")).not.toBeInTheDocument());
    expect(backend().countOf("list_documents")).toBe(1);
    expect(
      screen.queryByText(/Keep the policy schedule, the proposal form and the ID proof here/),
    ).not.toBeInTheDocument();
  });
});

describe("attaching a document", () => {
  it("asks the picker only for the kinds of file the book takes", async () => {
    tauriDialog.open.mockResolvedValue(PICKED);
    const { user } = openPanel();

    await user.click(await screen.findByRole("button", { name: "Attach" }));

    expect(tauriDialog.open).toHaveBeenCalledWith({
      multiple: false,
      filters: [{ name: "Documents", extensions: ["pdf", "png", "jpg", "jpeg", "webp"] }],
    });
  });

  it("attaches the file that was picked, titled after it", async () => {
    tauriDialog.open.mockResolvedValue(PICKED);
    const { user } = openPanel();

    await user.click(await screen.findByRole("button", { name: "Attach" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Attach document" })).toBeInTheDocument();
    expect(within(dialog).getByText("renewal-notice.pdf")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Title")).toHaveValue("renewal-notice");

    await user.click(within(dialog).getByRole("button", { name: "Attach" }));

    expect(await screen.findByText("Document attached")).toBeInTheDocument();
    expect(backend().lastCall("attach_document")?.input).toMatchObject({
      clientId: 1,
      path: PICKED,
      title: "renewal-notice",
      policyId: null,
    });
    await waitFor(() => expect(backend().countOf("list_documents")).toBe(2));
    expect(await screen.findByText("renewal-notice")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("falls back to the file's own name when the title is emptied", async () => {
    tauriDialog.open.mockResolvedValue(PICKED);
    const { user } = openPanel();

    await user.click(await screen.findByRole("button", { name: "Attach" }));
    const dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Title"));
    await user.click(within(dialog).getByRole("button", { name: "Attach" }));

    await screen.findByText("Document attached");
    expect(backend().lastCall("attach_document")?.input).toMatchObject({ title: "" });
    // The core files it under the file name without its extension, so the row
    // reads "renewal-notice" while "renewal-notice.pdf" is the file beneath it.
    expect(await screen.findByText("renewal-notice")).toBeInTheDocument();
  });

  it("files the document against a policy when one is chosen", async () => {
    tauriDialog.open.mockResolvedValue(PICKED);
    const { user } = openPanel();

    await user.click(await screen.findByRole("button", { name: "Attach" }));
    const dialog = await screen.findByRole("dialog");
    const policies = within(dialog).getByRole("combobox");
    await waitFor(() => expect(within(policies).getAllByRole("option")).toHaveLength(4));

    expect(within(policies).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "No particular policy",
      "IL/MOT/778211 · ICICI Lombard",
      "SH/2025/0091823 · Star Health",
      "SH/2024/0091823 · Star Health",
    ]);

    await user.selectOptions(policies, "1");
    await user.click(within(dialog).getByRole("button", { name: "Attach" }));

    await screen.findByText("Document attached");
    expect(backend().lastCall("attach_document")?.input).toMatchObject({ policyId: 1 });
    await waitFor(() => {
      expect(rowDetail(documentRow("renewal-notice"))).toBe(
        "SH/2025/0091823 · 121 KB · 14 Aug 2026",
      );
    });
  });

  it("does nothing when the picker is cancelled", async () => {
    tauriDialog.open.mockResolvedValue(null);
    const { user } = openPanel();

    await user.click(await screen.findByRole("button", { name: "Attach" }));

    await waitFor(() => expect(tauriDialog.open).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(backend().countOf("list_policies")).toBe(0);
    expect(backend().countOf("attach_document")).toBe(0);
  });

  it("reports an attach the core refuses, keeping the form open", async () => {
    tauriDialog.open.mockResolvedValue(PICKED);
    backend().fail("attach_document", {
      kind: "validation",
      message: "That file is larger than 20 MB",
    });
    const { user } = openPanel();

    await user.click(await screen.findByRole("button", { name: "Attach" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Attach" }));

    expect(await screen.findByText("That file is larger than 20 MB")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(backend().countOf("list_documents")).toBe(1);
  });

  it("leaves the book alone when the attach form is cancelled", async () => {
    tauriDialog.open.mockResolvedValue(PICKED);
    const { user } = openPanel();

    await user.click(await screen.findByRole("button", { name: "Attach" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(backend().countOf("attach_document")).toBe(0);
  });

  it("seeds the title from the file every time the picker runs", async () => {
    tauriDialog.open.mockResolvedValue(PICKED);
    const { user } = openPanel();

    await user.click(await screen.findByRole("button", { name: "Attach" }));
    const first = await screen.findByRole("dialog");
    const title = within(first).getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Renewal notice 2026");
    await user.click(within(first).getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Attach" }));

    const second = await screen.findByRole("dialog");
    expect(within(second).getByLabelText("Title")).toHaveValue("renewal-notice");
  });
});

describe("opening a document", () => {
  it("shows a pdf in place, read out of the book", async () => {
    const { user } = openPanel();

    await user.click(await screen.findByRole("button", { name: /^Policy schedule 2025-26/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("star-health-schedule.pdf · 403 KB")).toBeInTheDocument();
    expect(backend().lastCall("document_content")).toMatchObject({ id: 2 });

    const frame = await within(dialog).findByTitle("Policy schedule 2025-26");
    expect(frame.getAttribute("src")).toMatch(/^blob:/);
  });

  it("shows a photograph in place", async () => {
    const { user } = openPanel();

    await user.click(await screen.findByRole("button", { name: /^PAN card/ }));

    const dialog = await screen.findByRole("dialog");
    const image = await within(dialog).findByRole("img", { name: "PAN card" });
    expect(image.getAttribute("src")).toMatch(/^blob:/);
    expect(within(dialog).getByText("pan-abcps1234f.png · 164 KB")).toBeInTheDocument();
  });

  it("closes again, leaving the list behind it", async () => {
    const { user } = openPanel();

    await user.click(await screen.findByRole("button", { name: /^PAN card/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("PAN card")).toBeInTheDocument();
  });

  it("reports a document the core cannot read", async () => {
    backend().fail("document_content", {
      kind: "internal",
      message: "That file could not be read",
    });
    const { user } = openPanel();

    await user.click(await screen.findByRole("button", { name: /^PAN card/ }));

    expect(await screen.findByText("That file could not be read")).toBeInTheDocument();
  });

  it("stops loading when the document cannot be read", async () => {
    backend().fail("document_content", {
      kind: "internal",
      message: "That file could not be read",
    });
    const { user } = openPanel();

    await user.click(await screen.findByRole("button", { name: /^PAN card/ }));
    await screen.findByText("That file could not be read");

    expect(within(screen.getByRole("dialog")).queryByText("Loading")).not.toBeInTheDocument();
  });
});

describe("saving a copy", () => {
  it("writes the copy where the agent asks for it", async () => {
    tauriDialog.save.mockResolvedValue("/Users/you/Desktop/schedule.pdf");
    const { user } = openPanel();
    await screen.findByText("Policy schedule 2025-26");

    await user.click(saveCopy("Policy schedule 2025-26"));

    await waitFor(() =>
      expect(tauriDialog.save).toHaveBeenCalledWith({
        title: "Save a copy",
        defaultPath: "star-health-schedule.pdf",
      }),
    );
    expect(await screen.findByText("Copy saved")).toBeInTheDocument();
    expect(backend().lastCall("save_document_copy")).toMatchObject({
      id: 2,
      path: "/Users/you/Desktop/schedule.pdf",
    });
  });

  it("writes nothing when the save is cancelled", async () => {
    tauriDialog.save.mockResolvedValue(null);
    const { user } = openPanel();
    await screen.findByText("Policy schedule 2025-26");

    await user.click(saveCopy("Policy schedule 2025-26"));

    await waitFor(() => expect(tauriDialog.save).toHaveBeenCalledTimes(1));
    expect(backend().countOf("save_document_copy")).toBe(0);
    expect(screen.queryByText("Copy saved")).not.toBeInTheDocument();
  });

  it("reports a copy the core could not write", async () => {
    tauriDialog.save.mockResolvedValue("/Users/you/Desktop/schedule.pdf");
    backend().fail("save_document_copy", {
      kind: "internal",
      message: "That folder cannot be written to",
    });
    const { user } = openPanel();
    await screen.findByText("Policy schedule 2025-26");

    await user.click(saveCopy("Policy schedule 2025-26"));

    expect(await screen.findByText("That folder cannot be written to")).toBeInTheDocument();
  });
});

describe("removing a document", () => {
  it("asks first, then takes it out of the book", async () => {
    const confirm = confirms(true);
    const { user } = openPanel();
    await screen.findByText("Policy schedule 2025-26");

    await user.click(removeDocument("Policy schedule 2025-26"));

    expect(confirm).toHaveBeenCalledWith("Remove Policy schedule 2025-26?");
    expect(await screen.findByText("Document removed")).toBeInTheDocument();
    expect(backend().lastCall("delete_document")).toMatchObject({ id: 2 });
    await waitFor(() => {
      expect(screen.queryByText("Policy schedule 2025-26")).not.toBeInTheDocument();
    });
    expect(backend().countOf("list_documents")).toBe(2);
  });

  it("keeps the document when the confirmation is declined", async () => {
    confirms(false);
    const { user } = openPanel();
    await screen.findByText("Policy schedule 2025-26");

    await user.click(removeDocument("Policy schedule 2025-26"));

    expect(backend().countOf("delete_document")).toBe(0);
    expect(screen.getByText("Policy schedule 2025-26")).toBeInTheDocument();
  });

  it("reports a removal the core refuses", async () => {
    confirms(true);
    backend().fail("delete_document", {
      kind: "internal",
      message: "The book is open elsewhere",
    });
    const { user } = openPanel();
    await screen.findByText("Policy schedule 2025-26");

    await user.click(removeDocument("Policy schedule 2025-26"));

    expect(await screen.findByText("The book is open elsewhere")).toBeInTheDocument();
    expect(screen.getByText("Policy schedule 2025-26")).toBeInTheDocument();
  });
});
