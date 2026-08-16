/**
 * Bringing a spreadsheet in, end to end: choosing the workbook, reading the
 * preview, matching the columns, checking without saving, and committing.
 *
 * This is the screen an operator meets on their first day with the app and
 * never touches again, so every wrong turn — a cancelled picker, a workbook
 * that will not open, a required field left unmapped — is covered here.
 */

import { describe, expect, it } from "vitest";

import { ImportPage } from "@/pages/Import";
import {
  backend,
  currentRoute,
  renderWithProviders,
  screen,
  tauriDialog,
  waitFor,
  within,
} from "@/test";

const FILE = "/Users/you/Desktop/book-2026.xlsx";

type User = ReturnType<typeof renderWithProviders>["user"];

/** Opens the screen and waits for the recognised fields to land. */
async function openImport() {
  const view = renderWithProviders(<ImportPage />);
  await screen.findByRole("heading", { name: "Import data" });
  await waitFor(() => {
    expect(view.queryClient.getQueryData(["importFields"])).toBeDefined();
  });
  return view;
}

/** Picks a workbook the way the operator does, and waits for the mapping. */
async function chooseFile(user: User, path = FILE) {
  tauriDialog.open.mockResolvedValue(path);
  await user.click(screen.getByRole("button", { name: "Choose a file" }));
  return screen.findByRole("heading", { name: "Match your columns to fields" });
}

/** Runs the dry run and waits for its report. */
async function runCheck(user: User) {
  await user.click(screen.getByRole("button", { name: "Check without saving" }));
  return screen.findByRole("heading", { name: /Check results/ });
}

/** Commits the import and waits for the final report. */
async function runForReal(user: User) {
  await user.click(screen.getByRole("button", { name: "Import for real" }));
  return screen.findByRole("heading", { name: "Import complete" });
}

/** The dropdown sitting beside one recognised field in the mapping editor. */
function mappingFor(label: string): HTMLSelectElement {
  const [row] = screen.getAllByText(
    (_text, element) =>
      element?.tagName === "LABEL" && element.textContent?.replace(/\s*\*$/, "").trim() === label,
  );
  const select = row?.parentElement?.querySelector("select");
  if (!select) throw new Error(`No mapping dropdown beside "${label}"`);
  return select;
}

/** Every label offered by a mapping dropdown, in the order they appear. */
function optionsOf(select: HTMLSelectElement): string[] {
  return Array.from(select.options).map((option) => option.textContent ?? "");
}

/** The card a report is drawn in, dry run or final. */
function reportCard(): HTMLElement {
  const heading = screen.getByRole("heading", { name: /Check results|Import complete/ });
  return heading.closest("section") as HTMLElement;
}

/** The number under one heading of the report. */
function stat(label: string): string {
  return within(reportCard()).getByText(label).nextElementSibling?.textContent?.trim() ?? "";
}

/** The options the last import — dry run or real — was sent with. */
function lastRun(): Record<string, unknown> {
  return (backend().lastCall("run_import")?.options ?? {}) as Record<string, unknown>;
}

/** The mapping the last import was sent with. */
function lastMapping(): Record<string, string> {
  return (lastRun().mapping ?? {}) as Record<string, string>;
}

describe("the screen before a file is chosen", () => {
  it("offers the two ways in and nothing else", async () => {
    await openImport();

    expect(screen.getByRole("button", { name: "Choose a file" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download template" })).toBeEnabled();
    expect(
      screen.queryByRole("heading", { name: "Match your columns to fields" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check without saving" })).not.toBeInTheDocument();
    expect(backend().countOf("preview_import")).toBe(0);
  });

  it("explains what importing will do before anything is picked", async () => {
    await openImport();

    expect(screen.getByText(/Bring in an existing spreadsheet/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "How matching works" })).toBeInTheDocument();
    expect(screen.getByText(/Clients are matched on client code/)).toBeInTheDocument();
    expect(screen.getByText(/A policy is identified by insurer plus policy number/)).toBeInTheDocument();
    expect(screen.getByText(/Blank client fields get filled in/)).toBeInTheDocument();
    expect(screen.getByText(/Dates can be DD\/MM\/YYYY/)).toBeInTheDocument();
  });

  it("asks the core for the recognised fields as soon as it opens", async () => {
    await openImport();

    expect(backend().countOf("import_fields")).toBe(1);
  });
});

describe("choosing a file", () => {
  it("reads the workbook the operator picks", async () => {
    const { user } = await openImport();

    await chooseFile(user);

    expect(tauriDialog.open).toHaveBeenCalledWith(
      expect.objectContaining({
        multiple: false,
        filters: [
          expect.objectContaining({ extensions: ["xlsx", "xls", "xlsm", "ods", "csv", "tsv"] }),
        ],
      }),
    );
    expect(backend().lastCall("preview_import")).toEqual({ path: FILE, sheet: null });
    expect(screen.getByText("book-2026.xlsx")).toBeInTheDocument();
  });

  it("leaves the screen alone when the picker is cancelled", async () => {
    const { user } = await openImport();

    tauriDialog.open.mockResolvedValue(null);
    await user.click(screen.getByRole("button", { name: "Choose a file" }));

    await waitFor(() => expect(tauriDialog.open).toHaveBeenCalled());
    expect(backend().countOf("preview_import")).toBe(0);
    expect(
      screen.queryByRole("heading", { name: "Match your columns to fields" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the workbook already open when a second pick is cancelled", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    tauriDialog.open.mockResolvedValue(null);
    await user.click(screen.getByRole("button", { name: "Choose a file" }));

    await waitFor(() => expect(tauriDialog.open).toHaveBeenCalledTimes(2));
    expect(backend().countOf("preview_import")).toBe(1);
    expect(screen.getByText("book-2026.xlsx")).toBeInTheDocument();
  });

  it("explains a workbook it cannot read", async () => {
    const { user } = await openImport();
    backend().fail("preview_import", { kind: "validation", message: "That file is not a workbook" });

    tauriDialog.open.mockResolvedValue("/Users/you/Desktop/notes.txt");
    await user.click(screen.getByRole("button", { name: "Choose a file" }));

    expect(await screen.findByText("That file is not a workbook")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Match your columns to fields" }),
    ).not.toBeInTheDocument();
  });

  it("shows the button busy while the workbook is read", async () => {
    const { user } = await openImport();
    const gate = backend().hold("preview_import");

    tauriDialog.open.mockResolvedValue(FILE);
    await user.click(screen.getByRole("button", { name: "Choose a file" }));

    expect(screen.getByRole("button", { name: "Choose a file" })).toBeDisabled();
    gate.release();
    expect(
      await screen.findByRole("heading", { name: "Match your columns to fields" }),
    ).toBeInTheDocument();
  });
});

describe("the blank template", () => {
  it("writes the template where the operator asks", async () => {
    const { user } = await openImport();
    tauriDialog.save.mockResolvedValue("/Users/you/Desktop/template.xlsx");

    await user.click(screen.getByRole("button", { name: "Download template" }));

    expect(await screen.findByText("Template saved")).toBeInTheDocument();
    expect(tauriDialog.save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "stayinsured-import-template.xlsx" }),
    );
    expect(backend().lastCall("write_import_template")).toEqual({
      path: "/Users/you/Desktop/template.xlsx",
    });
  });

  it("writes nothing when the save is cancelled", async () => {
    const { user } = await openImport();
    tauriDialog.save.mockResolvedValue(null);

    await user.click(screen.getByRole("button", { name: "Download template" }));

    await waitFor(() => expect(tauriDialog.save).toHaveBeenCalled());
    expect(backend().countOf("write_import_template")).toBe(0);
    expect(screen.queryByText("Template saved")).not.toBeInTheDocument();
  });

  it("says so when the template cannot be written", async () => {
    const { user } = await openImport();
    backend().fail("write_import_template", { message: "That folder is read only" });
    tauriDialog.save.mockResolvedValue("/read-only/template.xlsx");

    await user.click(screen.getByRole("button", { name: "Download template" }));

    expect(await screen.findByText("That folder is read only")).toBeInTheDocument();
  });
});

describe("the preview", () => {
  it("names the file and counts the rows", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    expect(screen.getByText("book-2026.xlsx")).toBeInTheDocument();
    expect(screen.getByText("218 rows")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Preview of book-2026.xlsx" }),
    ).toBeInTheDocument();
  });

  it("shows the sample rows under the workbook's own headings", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Customer Name",
      "Mobile",
      "Email id",
      "Policy No",
      "Insurance Company",
      "Plan",
      "Type",
      "Start",
      "Valid Till",
      "Sum Assured",
      "Premium",
      "Remarks",
    ]);

    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(6);
    expect(within(rows[1]).getByText("Rohit Sharma")).toBeInTheDocument();
    expect(within(rows[1]).getByText("SH/2025/0091823")).toBeInTheDocument();
    expect(within(rows[1]).getByText("19/08/2026")).toBeInTheDocument();
    expect(within(rows[5]).getByText("Suresh Nair")).toBeInTheDocument();
  });

  it("marks a blank heading rather than dropping the column", async () => {
    backend().book.importPreview.headers[11] = "";
    delete backend().book.importPreview.suggestedMapping.notes;
    const { user } = await openImport();
    await chooseFile(user);

    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(12);
    expect(within(table).getByText("(blank)")).toBeInTheDocument();
    expect(optionsOf(mappingFor("Notes"))).toHaveLength(12);
  });
});

describe("sheets", () => {
  it("offers every sheet in the workbook and starts on the first", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    const sheet = screen.getByLabelText("Sheet") as HTMLSelectElement;
    expect(optionsOf(sheet)).toEqual(["Renewals", "Motor", "Notes"]);
    expect(sheet).toHaveValue("Renewals");
  });

  it("re-reads the workbook for the sheet that is chosen", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    await user.selectOptions(screen.getByLabelText("Sheet"), "Motor");

    await waitFor(() => {
      expect(backend().lastCall("preview_import")).toEqual({ path: FILE, sheet: "Motor" });
    });
    await waitFor(() => expect(screen.getByLabelText("Sheet")).toHaveValue("Motor"));
  });

  it("sends the chosen sheet on to the import", async () => {
    const { user } = await openImport();
    await chooseFile(user);
    await user.selectOptions(screen.getByLabelText("Sheet"), "Motor");
    await waitFor(() => expect(screen.getByLabelText("Sheet")).toHaveValue("Motor"));

    await runCheck(user);

    expect(lastRun()).toMatchObject({ path: FILE, sheet: "Motor" });
  });

  it("rebuilds the mapping from the new sheet's suggestion", async () => {
    const { user } = await openImport();
    await chooseFile(user);
    await user.selectOptions(mappingFor("Notes"), "Mobile");
    expect(mappingFor("Notes")).toHaveValue("Mobile");

    await user.selectOptions(screen.getByLabelText("Sheet"), "Motor");

    await waitFor(() => expect(mappingFor("Notes")).toHaveValue("Remarks"));
  });

  it("clears a report already on screen when the sheet changes", async () => {
    const { user } = await openImport();
    await chooseFile(user);
    await runCheck(user);

    await user.selectOptions(screen.getByLabelText("Sheet"), "Motor");

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /Check results/ })).not.toBeInTheDocument();
    });
  });

  it("hides the picker for a workbook with one sheet", async () => {
    backend().book.importPreview.sheetNames = ["Sheet1"];
    backend().book.importPreview.sheet = "Sheet1";
    const { user } = await openImport();
    await chooseFile(user);

    expect(screen.queryByLabelText("Sheet")).not.toBeInTheDocument();
  });
});

describe("the mapping editor", () => {
  it("lists every recognised field, grouped", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    const fields = backend().book.importFields;
    expect(fields).toHaveLength(32);
    for (const field of fields) expect(mappingFor(field.label)).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((node) => node.textContent)).toEqual([
      "Client",
      "Policy",
    ]);
  });

  it("keeps each field under its own group", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    const client = screen.getByRole("heading", { name: "Client", level: 3 })
      .parentElement as HTMLElement;
    const policy = screen.getByRole("heading", { name: "Policy", level: 3 })
      .parentElement as HTMLElement;

    expect(within(client).getByText("PAN", { selector: "label" })).toBeInTheDocument();
    expect(within(client).queryByText("Premium", { selector: "label" })).not.toBeInTheDocument();
    expect(within(policy).getByText("Premium", { selector: "label" })).toBeInTheDocument();
    expect(within(policy).queryByText("PAN", { selector: "label" })).not.toBeInTheDocument();
  });

  it("arrives with the core's suggestion already selected", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    expect(mappingFor("Client name")).toHaveValue("Customer Name");
    expect(mappingFor("Policy number")).toHaveValue("Policy No");
    expect(mappingFor("Insurer")).toHaveValue("Insurance Company");
    expect(mappingFor("Expiry date")).toHaveValue("Valid Till");
    expect(mappingFor("PAN")).toHaveValue("");

    const mapped = backend()
      .book.importFields.map((field) => field.label)
      .filter((label) => mappingFor(label).value !== "");
    expect(mapped).toHaveLength(12);
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("offers every column of the workbook, plus leaving the field out", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    expect(optionsOf(mappingFor("City"))).toEqual([
      "Not imported",
      "Customer Name",
      "Mobile",
      "Email id",
      "Policy No",
      "Insurance Company",
      "Plan",
      "Type",
      "Start",
      "Valid Till",
      "Sum Assured",
      "Premium",
      "Remarks",
    ]);
  });

  it("sends a corrected mapping to the import", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    await user.selectOptions(mappingFor("Vehicle number"), "Remarks");
    await runCheck(user);

    expect(lastMapping()).toMatchObject({ vehicleNumber: "Remarks", fullName: "Customer Name" });
  });

  it("drops a field from the import when its mapping is cleared", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    await user.selectOptions(mappingFor("Mobile"), "");
    expect(mappingFor("Mobile")).toHaveValue("");
    await runCheck(user);

    expect(lastMapping()).not.toHaveProperty("phone");
    expect(lastMapping()).toHaveProperty("email", "Email id");
  });

  it("allows one column to feed two fields", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    await user.selectOptions(mappingFor("Alternate phone"), "Mobile");
    await runCheck(user);

    expect(lastMapping()).toMatchObject({ phone: "Mobile", altPhone: "Mobile" });
  });

  it("blocks the run and names what is missing when a required field is unmapped", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    await user.selectOptions(mappingFor("Client name"), "");

    expect(screen.getByText("Needs Client name")).toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check without saving" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import for real" })).toBeDisabled();

    await user.selectOptions(mappingFor("Client name"), "Customer Name");
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check without saving" })).toBeEnabled();
  });

  it("names every missing required field at once", async () => {
    backend().book.importPreview.suggestedMapping = { fullName: "Customer Name" };
    const { user } = await openImport();
    await chooseFile(user);

    expect(
      screen.getByText("Needs Policy number, Insurer, Expiry date"),
    ).toBeInTheDocument();
  });

  it("names each mapping dropdown for the operator's screen reader", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    expect(screen.getByLabelText("Policy number")).toBe(mappingFor("Policy number"));
  });

  it("tells two columns with the same heading apart", async () => {
    const preview = backend().book.importPreview;
    preview.headers[11] = "Premium";
    delete preview.suggestedMapping.notes;
    const { user } = await openImport();
    await chooseFile(user);

    const values = Array.from(mappingFor("Premium").options).map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("sends only the mapping the operator can see", async () => {
    backend().book.importPreview.headers[11] = "";
    const { user } = await openImport();
    await chooseFile(user);
    expect(mappingFor("Notes")).toHaveValue("");

    await runCheck(user);

    expect(lastMapping()).not.toHaveProperty("notes");
  });

  it("says so when the recognised fields cannot be loaded", async () => {
    backend().fail("import_fields", { message: "The field list is unavailable" });
    const { user } = renderWithProviders(<ImportPage />);
    await waitFor(() => expect(backend().countOf("import_fields")).toBe(1));

    await chooseFile(user);

    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
  });
});

describe("the import options", () => {
  it("defaults to Other and sends the category the operator picks", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    const category = screen.getByLabelText(/Category when not in the file/);
    expect(category).toHaveValue("other");
    await user.selectOptions(category, "health");
    await runCheck(user);

    expect(lastRun()).toMatchObject({ defaultCategory: "health" });
  });

  it("sends the update-existing choice on to the import", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    const updateExisting = screen.getByRole("checkbox", {
      name: /Update records that already exist/,
    });
    expect(updateExisting).toBeChecked();
    await user.click(updateExisting);
    await runCheck(user);

    expect(lastRun()).toMatchObject({ updateExisting: false });
  });
});

describe("checking without saving", () => {
  it("sends the whole mapping as a dry run", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    await runCheck(user);

    expect(lastRun()).toMatchObject({
      path: FILE,
      sheet: "Renewals",
      defaultCategory: "other",
      updateExisting: true,
      dryRun: true,
    });
    expect(lastMapping()).toMatchObject({
      fullName: "Customer Name",
      policyNumber: "Policy No",
      insurerName: "Insurance Company",
      expiryDate: "Valid Till",
    });
  });

  it("reports every count the core sent back", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    await runCheck(user);

    expect(stat("Rows read")).toBe("218");
    expect(stat("Policies added")).toBe("211");
    expect(stat("Policies updated")).toBe("4");
    expect(stat("Clients created")).toBe("96");
    expect(stat("Skipped")).toBe("1");
    expect(stat("Failed")).toBe("2");
  });

  it("says plainly that nothing has been saved", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    await runCheck(user);

    expect(
      screen.getByRole("heading", { name: "Check results — nothing has been saved" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View policies" })).not.toBeInTheDocument();
    expect(backend().book.policies).toHaveLength(17);
    expect(backend().calls.map((call) => call.command)).not.toContain("create_policy");
  });

  it("lists the rows needing attention", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    await runCheck(user);

    const issues = within(reportCard()).getAllByRole("listitem");
    expect(issues).toHaveLength(3);
    expect(within(issues[0]).getByText("row 47")).toBeInTheDocument();
    expect(within(issues[0]).getByText("Expiry date is not a real date")).toBeInTheDocument();
    expect(within(issues[1]).getByText("row 132")).toBeInTheDocument();
    expect(within(issues[2]).getByText("row 188")).toBeInTheDocument();
  });

  it("shows the column and the value behind each issue", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    await runCheck(user);

    const issues = within(reportCard()).getAllByRole("listitem");
    expect(within(issues[0]).getByText(/Valid Till/)).toBeInTheDocument();
    expect(within(issues[0]).getByText(/31\/02\/2026/)).toBeInTheDocument();
  });

  it("warns when rows would fail", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    await runCheck(user);

    expect(await screen.findByText(/2 rows would fail/)).toBeInTheDocument();
  });

  it("says everything checks out when nothing would fail", async () => {
    backend().book.importReport = { ...backend().book.importReport, failed: 0, issues: [] };
    const { user } = await openImport();
    await chooseFile(user);

    await runCheck(user);

    expect(await screen.findByText("Everything checks out")).toBeInTheDocument();
    expect(within(reportCard()).queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("can be run again after the mapping is corrected", async () => {
    const { user } = await openImport();
    await chooseFile(user);
    await runCheck(user);

    await user.selectOptions(mappingFor("Nominee"), "Remarks");
    await user.click(screen.getByRole("button", { name: "Check without saving" }));

    await waitFor(() => expect(backend().countOf("run_import")).toBe(2));
    expect(lastMapping()).toMatchObject({ nomineeName: "Remarks" });
  });
});

describe("importing for real", () => {
  it("stays out of reach until a check has run", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    expect(screen.getByRole("button", { name: "Import for real" })).toBeDisabled();
    expect(screen.getByText(/Run the check first/)).toBeInTheDocument();

    await runCheck(user);

    expect(screen.getByRole("button", { name: "Import for real" })).toBeEnabled();
    expect(screen.queryByText(/Run the check first/)).not.toBeInTheDocument();
  });

  it("commits without asking a second time", async () => {
    const { user } = await openImport();
    await chooseFile(user);
    await runCheck(user);

    await runForReal(user);

    expect(tauriDialog.ask).not.toHaveBeenCalled();
    expect(tauriDialog.confirm).not.toHaveBeenCalled();
    expect(lastRun()).toMatchObject({ dryRun: false, path: FILE });
  });

  it("holds the operator while the workbook is written", async () => {
    const { user } = await openImport();
    await chooseFile(user);
    await runCheck(user);
    const gate = backend().hold("run_import");

    await user.click(screen.getByRole("button", { name: "Import for real" }));
    expect(screen.getByRole("button", { name: "Import for real" })).toBeDisabled();

    gate.release();
    expect(await screen.findByRole("heading", { name: "Import complete" })).toBeInTheDocument();
  });

  it("locks the check while the real import is running", async () => {
    const { user } = await openImport();
    await chooseFile(user);
    await runCheck(user);
    const gate = backend().hold("run_import");

    await user.click(screen.getByRole("button", { name: "Import for real" }));
    try {
      expect(screen.getByRole("button", { name: "Check without saving" })).toBeDisabled();
    } finally {
      gate.release();
    }
  });

  it("reports what happened and points at the result", async () => {
    const { user } = await openImport();
    await chooseFile(user);
    await runCheck(user);

    await runForReal(user);

    expect(stat("Policies added")).toBe("211");
    expect(stat("Clients created")).toBe("96");
    expect(await screen.findByText("Imported 211 policies")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Check results/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "View policies" }));
    expect(currentRoute()).toBe("/policies");
  });

  it("celebrates a file that came in cleanly", async () => {
    backend().book.importReport = {
      ...backend().book.importReport,
      skipped: 0,
      failed: 0,
      issues: [],
    };
    const { user } = await openImport();
    await chooseFile(user);
    await runCheck(user);

    await runForReal(user);

    expect(screen.getByText("Every row imported cleanly.")).toBeInTheDocument();
  });

  it("explains an import that fails outright", async () => {
    const { user } = await openImport();
    await chooseFile(user);
    await runCheck(user);
    backend().fail("run_import", { message: "The workbook could not be read" });

    await user.click(screen.getByRole("button", { name: "Import for real" }));

    expect(await screen.findByText("The workbook could not be read")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Import complete" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Check results/ })).toBeInTheDocument();
  });

  it("makes the operator re-check after the mapping changes", async () => {
    const { user } = await openImport();
    await chooseFile(user);
    await runCheck(user);

    await user.selectOptions(mappingFor("Expiry date"), "Remarks");

    expect(screen.getByRole("button", { name: "Import for real" })).toBeDisabled();
  });

  it("does not call an empty workbook a clean import", async () => {
    const book = backend().book;
    book.importPreview.totalRows = 0;
    book.importPreview.sampleRows = [];
    book.importReport = {
      ...book.importReport,
      totalRows: 0,
      policiesInserted: 0,
      policiesUpdated: 0,
      clientsCreated: 0,
      clientsUpdated: 0,
      skipped: 0,
      failed: 0,
      issues: [],
    };
    const { user } = await openImport();
    await chooseFile(user);
    await runCheck(user);

    await runForReal(user);

    expect(stat("Rows read")).toBe("0");
    expect(screen.queryByText("Every row imported cleanly.")).not.toBeInTheDocument();
  });

  it("does not congratulate an import where every row failed", async () => {
    backend().book.importReport = {
      ...backend().book.importReport,
      policiesInserted: 0,
      policiesUpdated: 0,
      clientsCreated: 0,
      skipped: 0,
      failed: 218,
    };
    const { user } = await openImport();
    await chooseFile(user);
    await runCheck(user);

    await runForReal(user);

    expect(stat("Failed")).toBe("218");
    expect(screen.queryByText("Imported 0 policies")).not.toBeInTheDocument();
  });
});

describe("starting over", () => {
  it("replaces the preview and the report when another file is chosen", async () => {
    const first = backend().book.importPreview;
    const second = {
      ...structuredClone(first),
      fileName: "motor-2026.csv",
      totalRows: 12,
      sheetNames: ["Sheet1"],
      sheet: "Sheet1",
    };
    backend().on("preview_import", (args) =>
      String(args.path).includes("motor") ? second : first,
    );
    const { user } = await openImport();
    await chooseFile(user);
    await runCheck(user);

    tauriDialog.open.mockResolvedValue("/Users/you/Desktop/motor-2026.csv");
    await user.click(screen.getByRole("button", { name: "Choose a file" }));

    expect(await screen.findByText("motor-2026.csv")).toBeInTheDocument();
    expect(screen.getByText("12 rows")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Check results/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Sheet")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import for real" })).toBeDisabled();
  });

  it("imports the second file, not the first", async () => {
    const { user } = await openImport();
    await chooseFile(user);

    await chooseFile(user, "/Users/you/Desktop/second.xlsx");
    await waitFor(() => {
      expect(backend().lastCall("preview_import")).toMatchObject({
        path: "/Users/you/Desktop/second.xlsx",
      });
    });
    await runCheck(user);

    expect(lastRun()).toMatchObject({ path: "/Users/you/Desktop/second.xlsx" });
  });
});
