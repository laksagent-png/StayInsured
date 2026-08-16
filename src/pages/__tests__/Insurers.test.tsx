/**
 * The insurers and plans screen. Both lists feed every policy picker in the app,
 * so a stale row, a lost selection or a count that never refreshes is felt on
 * screens far away from this one.
 */

import { describe, expect, it, vi } from "vitest";

import { backend, renderWithProviders, screen, waitFor, within } from "@/test";
import type { Insurer, Product } from "@/lib/types";
import { InsurersPage } from "@/pages/Insurers";

// ---------------------------------------------------------------- landmarks

const insurerPanel = () =>
  screen.getByRole("heading", { name: "Insurers", level: 2 }).closest("section") as HTMLElement;

/** The plans card, whose title follows the selection. */
const planPanel = () =>
  screen
    .getByRole("heading", { name: /^(All plans|Plans)/, level: 2 })
    .closest("section") as HTMLElement;

const dialog = () => screen.getByRole("dialog");

// An insurer's name appears on its own row and again beside each of its plans,
// so every lookup is scoped to the panel it belongs to.
const findInsurer = (name: string) => within(insurerPanel()).findByText(name);
const findPlan = (name: string) => within(planPanel()).findByText(name);

const insurerRow = (name: string) =>
  within(insurerPanel()).getByText(name).closest("tr") as HTMLElement;
const planRow = (name: string) => within(planPanel()).getByText(name).closest("tr") as HTMLElement;

/** The trash button, which carries an icon and no name of its own. */
const deleteButton = (row: HTMLElement) => within(row).getAllByRole("button").at(-1) as HTMLElement;

/** An insurer and a plan nothing points at, so a delete can go through. */
function addSpareInsurer(): void {
  backend().book.insurers.push({
    id: 9,
    name: "Reliance General",
    shortCode: "RELG",
    website: null,
    claimHelpline: null,
    supportEmail: null,
    notes: null,
    isActive: true,
    policyCount: 0,
  } satisfies Insurer);
  backend().book.products.push({
    id: 9,
    insurerId: 9,
    insurerName: "Reliance General",
    name: "Two Wheeler Secure",
    category: "motor",
    code: null,
    notes: null,
    isActive: true,
    policyCount: 0,
  } satisfies Product);
}

const renderPage = () => renderWithProviders(<InsurersPage />);

// ---------------------------------------------------------------- the insurer list

describe("the insurer list", () => {
  it("shows every insurer with its short code, helpline and policy count", async () => {
    renderPage();
    await findInsurer("Star Health");

    const row = insurerRow("Star Health");
    expect(within(row).getByText("STAR · claims 1800 425 2255")).toBeInTheDocument();
    expect(within(row).getByText("5")).toBeInTheDocument();
    expect(within(row).getByText("Active")).toBeInTheDocument();

    // Eight insurers and one header row.
    expect(within(insurerPanel()).getAllByRole("row")).toHaveLength(9);
  });

  it("shows the support email and website of an insurer", async () => {
    renderPage();
    await findInsurer("Star Health");

    const row = insurerRow("Star Health");
    expect(within(row).getByText(/support@starhealth\.in/)).toBeInTheDocument();
    expect(within(row).getByText(/www\.starhealth\.in/)).toBeInTheDocument();
  });

  it("counts the policies of an insurer that has no plans", async () => {
    renderPage();
    await findInsurer("New India Assurance");

    expect(within(insurerRow("New India Assurance")).getByText("1")).toBeInTheDocument();
  });

  it("asks the core for active insurers only", async () => {
    renderPage();
    await findInsurer("Star Health");

    expect(backend().lastCall("list_insurers")).toEqual({ includeInactive: false });
  });

  it("hides inactive insurers until they are asked for", async () => {
    backend().book.insurers[2].isActive = false;
    const { user } = renderPage();
    await findInsurer("Star Health");

    expect(within(insurerPanel()).queryByText("ICICI Lombard")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Show inactive" }));
    await findInsurer("ICICI Lombard");

    expect(within(insurerRow("ICICI Lombard")).getByText("Inactive")).toBeInTheDocument();
    expect(backend().lastCall("list_insurers")).toEqual({ includeInactive: true });
  });

  it("offers to add the first insurer when the book has none", async () => {
    backend().book.insurers = [];
    renderPage();

    expect(await screen.findByText("No insurers")).toBeInTheDocument();
    expect(screen.getByText("Add the companies you place business with.")).toBeInTheDocument();
  });

  it("waits with a spinner while the list loads", async () => {
    const gate = backend().hold("list_insurers");
    renderPage();

    expect(await within(insurerPanel()).findByText("Loading")).toBeInTheDocument();

    gate.release();
    expect(await findInsurer("Star Health")).toBeInTheDocument();
  });

  it("says so when the list cannot be read", async () => {
    backend().fail("list_insurers", { kind: "internal", message: "The book would not open" });
    renderPage();

    await waitFor(() => expect(backend().countOf("list_insurers")).toBe(1));
    // The call is counted when it is sent, which is a tick before the refusal
    // reaches the panel, so the failure is waited for rather than read at once.
    expect(await screen.findByText(/would not open/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- adding an insurer

describe("adding an insurer", () => {
  it("sends every field on the form to the core", async () => {
    const { user } = renderPage();
    await findInsurer("Star Health");

    await user.click(screen.getByRole("button", { name: /New insurer/ }));
    const form = dialog();
    await user.type(within(form).getByLabelText(/^Name/), "Acko General");
    await user.type(within(form).getByLabelText(/^Short code/), "ACKO");
    await user.type(within(form).getByLabelText(/^Claims helpline/), "1800 266 2256");
    await user.type(within(form).getByLabelText(/^Support email/), "hello@acko.com");
    await user.type(within(form).getByLabelText(/^Website/), "https://www.acko.com");
    await user.click(within(form).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Insurer added")).toBeInTheDocument();
    expect(backend().lastCall("create_insurer")?.input).toMatchObject({
      name: "Acko General",
      shortCode: "ACKO",
      claimHelpline: "1800 266 2256",
      supportEmail: "hello@acko.com",
      website: "https://www.acko.com",
      isActive: true,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await findInsurer("Acko General")).toBeInTheDocument();
  });

  it("asks the list again so the new insurer and its count appear", async () => {
    const { user } = renderPage();
    await findInsurer("Star Health");
    expect(backend().countOf("list_insurers")).toBe(1);

    await user.click(screen.getByRole("button", { name: /New insurer/ }));
    await user.type(within(dialog()).getByLabelText(/^Name/), "Acko General");
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));
    await screen.findByText("Insurer added");

    await waitFor(() => expect(backend().countOf("list_insurers")).toBe(2));
    await findInsurer("Acko General");
    expect(within(insurerRow("Acko General")).getByText("0")).toBeInTheDocument();
  });

  it("writes a dash where a new insurer has no short code", async () => {
    const { user } = renderPage();
    await findInsurer("Star Health");

    await user.click(screen.getByRole("button", { name: /New insurer/ }));
    await user.type(within(dialog()).getByLabelText(/^Name/), "Acko General");
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));
    await screen.findByText("Insurer added");
    await findInsurer("Acko General");

    expect(within(insurerRow("Acko General")).getByText("—")).toBeInTheDocument();
  });

  it("complains about a blank name and keeps the form open", async () => {
    const { user } = renderPage();
    await findInsurer("Star Health");

    await user.click(screen.getByRole("button", { name: /New insurer/ }));
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("An insurer needs a name")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(insurerPanel()).getAllByRole("row")).toHaveLength(9);
  });

  it("reports the conflict when the name is already in the book", async () => {
    const { user } = renderPage();
    await findInsurer("Star Health");

    await user.click(screen.getByRole("button", { name: /New insurer/ }));
    await user.type(within(dialog()).getByLabelText(/^Name/), "Star Health");
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("An insurer with that name already exists")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(insurerPanel()).getAllByRole("row")).toHaveLength(9);
  });

  it("adds an insurer that is retired from the start", async () => {
    const { user } = renderPage();
    await findInsurer("Star Health");

    await user.click(screen.getByRole("button", { name: /New insurer/ }));
    await user.type(within(dialog()).getByLabelText(/^Name/), "Acko General");
    await user.click(within(dialog()).getByLabelText(/^Active/));
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));
    await screen.findByText("Insurer added");

    expect(backend().lastCall("create_insurer")?.input).toMatchObject({ isActive: false });
    expect(within(insurerPanel()).queryByText("Acko General")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Show inactive" }));
    expect(await findInsurer("Acko General")).toBeInTheDocument();
  });

  it("writes nothing when the form is cancelled", async () => {
    const { user } = renderPage();
    await findInsurer("Star Health");

    await user.click(screen.getByRole("button", { name: /New insurer/ }));
    await user.type(within(dialog()).getByLabelText(/^Name/), "Acko General");
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(backend().countOf("create_insurer")).toBe(0);
  });

  it("starts from a blank form the second time it is opened", async () => {
    const { user } = renderPage();
    await findInsurer("Star Health");

    await user.click(screen.getByRole("button", { name: /New insurer/ }));
    await user.type(within(dialog()).getByLabelText(/^Name/), "Acko General");
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: /New insurer/ }));
    expect(within(dialog()).getByLabelText(/^Name/)).toHaveValue("");
  });
});

// ---------------------------------------------------------------- editing an insurer

describe("editing an insurer", () => {
  it("opens with the insurer's details in the fields", async () => {
    const { user } = renderPage();
    await findInsurer("Star Health");

    await user.click(within(insurerRow("Star Health")).getByRole("button", { name: "Edit" }));

    const form = dialog();
    expect(within(form).getByRole("heading", { name: "Edit Star Health" })).toBeInTheDocument();
    expect(within(form).getByLabelText(/^Name/)).toHaveValue("Star Health");
    expect(within(form).getByLabelText(/^Short code/)).toHaveValue("STAR");
    expect(within(form).getByLabelText(/^Claims helpline/)).toHaveValue("1800 425 2255");
    expect(within(form).getByLabelText(/^Support email/)).toHaveValue("support@starhealth.in");
    expect(within(form).getByLabelText(/^Website/)).toHaveValue("https://www.starhealth.in");
    expect(within(form).getByLabelText(/^Active/)).toBeChecked();
  });

  it("saves the changes and shows them in the list", async () => {
    const { user } = renderPage();
    await findInsurer("Star Health");

    await user.click(within(insurerRow("Star Health")).getByRole("button", { name: "Edit" }));
    const helpline = within(dialog()).getByLabelText(/^Claims helpline/);
    await user.clear(helpline);
    await user.type(helpline, "1800 000 1111");
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Insurer updated")).toBeInTheDocument();
    expect(backend().lastCall("update_insurer")).toMatchObject({
      id: 1,
      input: { name: "Star Health", claimHelpline: "1800 000 1111", isActive: true },
    });
    expect(await findInsurer("STAR · claims 1800 000 1111")).toBeInTheDocument();
  });

  it("retires an insurer, which drops it out of the list", async () => {
    const { user } = renderPage();
    await findInsurer("HDFC ERGO");

    await user.click(within(insurerRow("HDFC ERGO")).getByRole("button", { name: "Edit" }));
    await user.click(within(dialog()).getByLabelText(/^Active/));
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));
    await screen.findByText("Insurer updated");

    expect(backend().lastCall("update_insurer")).toMatchObject({ id: 2, input: { isActive: false } });
    await waitFor(() => {
      expect(within(insurerPanel()).queryByText("HDFC ERGO")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("checkbox", { name: "Show inactive" }));
    await findInsurer("HDFC ERGO");
    expect(within(insurerRow("HDFC ERGO")).getByText("Inactive")).toBeInTheDocument();
  });

  it("shows the stored details again after an edit is abandoned", async () => {
    const { user } = renderPage();
    await findInsurer("Star Health");

    const openEdit = () =>
      user.click(within(insurerRow("Star Health")).getByRole("button", { name: "Edit" }));

    await openEdit();
    await user.type(within(dialog()).getByLabelText(/^Name/), " typo");
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));

    await openEdit();
    expect(within(dialog()).getByLabelText(/^Name/)).toHaveValue("Star Health");
  });

  it("renames the insurer on its plans too", async () => {
    const { user } = renderPage();
    await findPlan("Family Health Optima");

    await user.click(within(insurerRow("Star Health")).getByRole("button", { name: "Edit" }));
    const name = within(dialog()).getByLabelText(/^Name/);
    await user.clear(name);
    await user.type(name, "Star Health Insurance");
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));
    await screen.findByText("Insurer updated");

    expect(
      within(planRow("Family Health Optima")).getByText("Star Health Insurance"),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- deleting an insurer

describe("deleting an insurer", () => {
  it("asks before removing anything", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user } = renderPage();
    await findInsurer("Star Health");

    await user.click(deleteButton(insurerRow("Star Health")));

    expect(confirm).toHaveBeenCalledWith("Remove Star Health?");
    expect(backend().countOf("delete_insurer")).toBe(0);
    expect(within(insurerPanel()).getByText("Star Health")).toBeInTheDocument();
  });

  it("refuses while policies still point at the insurer", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = renderPage();
    await findInsurer("Star Health");

    await user.click(deleteButton(insurerRow("Star Health")));

    expect(
      await screen.findByText("This insurer is on policies, so it cannot be deleted"),
    ).toBeInTheDocument();
    expect(within(insurerPanel()).getByText("Star Health")).toBeInTheDocument();
  });

  it("removes an insurer nothing points at", async () => {
    addSpareInsurer();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = renderPage();
    await findInsurer("Reliance General");

    await user.click(deleteButton(insurerRow("Reliance General")));

    expect(await screen.findByText("Insurer removed")).toBeInTheDocument();
    await waitFor(() => expect(backend().countOf("list_insurers")).toBe(2));
    expect(within(insurerPanel()).queryByText("Reliance General")).not.toBeInTheDocument();
  });

  it("takes the insurer's plans off the plans panel", async () => {
    addSpareInsurer();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = renderPage();
    await findPlan("Two Wheeler Secure");

    await user.click(deleteButton(insurerRow("Reliance General")));
    await screen.findByText("Insurer removed");

    await waitFor(() => {
      expect(within(planPanel()).queryByText("Two Wheeler Secure")).not.toBeInTheDocument();
    });
  });

  it("lets the plans panel go when the selected insurer is deleted", async () => {
    addSpareInsurer();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = renderPage();
    await findInsurer("Reliance General");

    await user.click(within(insurerRow("Reliance General")).getByRole("button", { name: "Plans" }));
    await screen.findByRole("heading", { name: "Plans — Reliance General", level: 2 });

    await user.click(deleteButton(insurerRow("Reliance General")));
    await screen.findByText("Insurer removed");

    expect(await screen.findByRole("heading", { name: "All plans", level: 2 })).toBeInTheDocument();
  });

  it("gives the delete button a name a reader can find", async () => {
    renderPage();
    await findInsurer("Star Health");

    expect(
      within(insurerRow("Star Health")).getByRole("button", { name: /remove|delete/i }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- choosing an insurer

describe("choosing an insurer", () => {
  it("lists every plan until one insurer is chosen", async () => {
    renderPage();
    await findPlan("Family Health Optima");

    expect(within(planPanel()).getAllByRole("row")).toHaveLength(8);
    expect(screen.getByRole("heading", { name: "All plans", level: 2 })).toBeInTheDocument();
    expect(backend().lastCall("list_products")).toEqual({ insurerId: null, includeInactive: false });
  });

  it("narrows the plans to the insurer that was chosen", async () => {
    const { user } = renderPage();
    await findInsurer("Star Health");

    await user.click(within(insurerRow("Star Health")).getByRole("button", { name: "Plans" }));

    expect(
      await screen.findByRole("heading", { name: "Plans — Star Health", level: 2 }),
    ).toBeInTheDocument();
    expect(await findPlan("Family Health Optima")).toBeInTheDocument();
    expect(within(planPanel()).getAllByRole("row")).toHaveLength(2);
    expect(backend().lastCall("list_products")).toEqual({ insurerId: 1, includeInactive: false });
  });

  it("reloads the panel for the next insurer instead of keeping the last one's plans", async () => {
    const { user } = renderPage();
    await findInsurer("Star Health");

    await user.click(within(insurerRow("Star Health")).getByRole("button", { name: "Plans" }));
    await findPlan("Family Health Optima");

    await user.click(within(insurerRow("HDFC ERGO")).getByRole("button", { name: "Plans" }));

    expect(await findPlan("Optima Restore")).toBeInTheDocument();
    expect(within(planPanel()).getByText("Personal Accident Shield")).toBeInTheDocument();
    expect(within(planPanel()).queryByText("Family Health Optima")).not.toBeInTheDocument();
    expect(backend().lastCall("list_products")).toEqual({ insurerId: 2, includeInactive: false });
  });

  it("says so when the chosen insurer sells nothing", async () => {
    const { user } = renderPage();
    await findInsurer("New India Assurance");

    await user.click(
      within(insurerRow("New India Assurance")).getByRole("button", { name: "Plans" }),
    );

    expect(await findPlan("No plans recorded")).toBeInTheDocument();
  });

  it("goes back to every plan with Show all", async () => {
    const { user } = renderPage();
    await findInsurer("Star Health");

    await user.click(within(insurerRow("Star Health")).getByRole("button", { name: "Plans" }));
    await findPlan("Family Health Optima");

    await user.click(within(planPanel()).getByRole("button", { name: "Show all" }));

    expect(await screen.findByRole("heading", { name: "All plans", level: 2 })).toBeInTheDocument();
    expect(await findPlan("Jeevan Anand")).toBeInTheDocument();
    expect(within(planPanel()).getAllByRole("row")).toHaveLength(8);
  });

  it("keeps naming the insurer after it is retired", async () => {
    const { user } = renderPage();
    await findInsurer("HDFC ERGO");

    await user.click(within(insurerRow("HDFC ERGO")).getByRole("button", { name: "Plans" }));
    await findPlan("Optima Restore");

    await user.click(within(insurerRow("HDFC ERGO")).getByRole("button", { name: "Edit" }));
    await user.click(within(dialog()).getByLabelText(/^Active/));
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));
    await screen.findByText("Insurer updated");

    expect(
      await screen.findByRole("heading", { name: "Plans — HDFC ERGO", level: 2 }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- the plan list

describe("the plan list", () => {
  it("shows a plan with its insurer, category and policy count", async () => {
    renderPage();
    await findPlan("Family Health Optima");

    const row = planRow("Family Health Optima");
    expect(within(row).getByText("Star Health")).toBeInTheDocument();
    expect(within(row).getByText("Health")).toBeInTheDocument();
    expect(within(row).getByText("5")).toBeInTheDocument();
  });

  it("writes the long category labels out in full", async () => {
    renderPage();
    await findPlan("Travel Guard");

    expect(within(planRow("Travel Guard")).getByText("Travel / International")).toBeInTheDocument();
  });

  it("waits with a spinner while the plans load", async () => {
    const gate = backend().hold("list_products");
    renderPage();

    expect(await within(planPanel()).findByText("Loading")).toBeInTheDocument();

    gate.release();
    expect(await findPlan("Family Health Optima")).toBeInTheDocument();
  });

  it("explains that plans are optional when there are none", async () => {
    backend().book.products = [];
    renderPage();

    expect(await screen.findByText("No plans recorded")).toBeInTheDocument();
  });

  it("says so when the plans cannot be read", async () => {
    backend().fail("list_products", { kind: "internal", message: "The plans would not load" });
    renderPage();

    await waitFor(() => expect(backend().countOf("list_products")).toBe(1));
    // Counted when sent, answered a tick later, so the failure is waited for.
    expect(await screen.findByText(/would not load/i)).toBeInTheDocument();
  });

  it("marks a retired plan as inactive", async () => {
    backend().book.products[1].isActive = false;
    const { user } = renderPage();
    await findPlan("Family Health Optima");

    await user.click(screen.getByRole("checkbox", { name: "Show inactive" }));
    await findPlan("Optima Restore");

    expect(within(planRow("Optima Restore")).getByText("Inactive")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- adding a plan

describe("adding a plan", () => {
  it("sends the fields on the form to the core", async () => {
    const { user } = renderPage();
    await findPlan("Family Health Optima");

    await user.click(within(planPanel()).getByRole("button", { name: /Add/ }));
    const form = dialog();
    expect(within(form).getByRole("heading", { name: "New plan" })).toBeInTheDocument();
    await user.selectOptions(within(form).getByLabelText(/^Insurer/), "6");
    await user.type(within(form).getByLabelText(/^Plan name/), "Travel Guard Plus");
    await user.selectOptions(within(form).getByLabelText(/^Category/), "travel");
    await user.type(within(form).getByLabelText(/^Plan code/), "TA-TGP");
    await user.click(within(form).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Plan added")).toBeInTheDocument();
    expect(backend().lastCall("create_product")?.input).toMatchObject({
      insurerId: 6,
      name: "Travel Guard Plus",
      category: "travel",
      code: "TA-TGP",
      isActive: true,
    });
    expect(await findPlan("Travel Guard Plus")).toBeInTheDocument();
  });

  it("offers every category the app knows", async () => {
    const { user } = renderPage();
    await findPlan("Family Health Optima");

    await user.click(within(planPanel()).getByRole("button", { name: /Add/ }));
    const category = within(dialog()).getByLabelText(/^Category/);

    expect(within(category).getAllByRole("option")).toHaveLength(8);
    expect(within(category).getByRole("option", { name: "Health" })).toBeInTheDocument();
    expect(within(category).getByRole("option", { name: "Personal Accident" })).toBeInTheDocument();
    expect(category).toHaveValue("health");
  });

  it("lists the insurers to hang the plan on", async () => {
    const { user } = renderPage();
    await findPlan("Family Health Optima");

    await user.click(within(planPanel()).getByRole("button", { name: /Add/ }));
    const insurer = within(dialog()).getByLabelText(/^Insurer/);

    // The eight insurers, plus the prompt to choose one.
    expect(within(insurer).getAllByRole("option")).toHaveLength(9);
    expect(within(insurer).getByRole("option", { name: "Choose an insurer" })).toBeInTheDocument();
  });

  it("complains about a blank plan name and keeps the form open", async () => {
    const { user } = renderPage();
    await findPlan("Family Health Optima");

    await user.click(within(planPanel()).getByRole("button", { name: /Add/ }));
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("A plan needs a name")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("refuses to save a plan with no insurer on it", async () => {
    const { user } = renderPage();
    await findPlan("Family Health Optima");

    await user.click(within(planPanel()).getByRole("button", { name: /Add/ }));
    await user.selectOptions(within(dialog()).getByLabelText(/^Insurer/), "");
    await user.type(within(dialog()).getByLabelText(/^Plan name/), "Orphan Plan");
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(backend().lastCall("create_product")?.input).not.toMatchObject({ insurerId: 0 });
    });
  });

  it("hangs the new plan on the insurer the panel is filtered to", async () => {
    const { user } = renderPage();
    await findInsurer("HDFC ERGO");

    await user.click(within(insurerRow("HDFC ERGO")).getByRole("button", { name: "Plans" }));
    await findPlan("Optima Restore");

    await user.click(within(planPanel()).getByRole("button", { name: /Add/ }));
    expect(within(dialog()).getByLabelText(/^Insurer/)).toHaveValue("2");
  });

  it("follows the insurer chosen after the form was last opened", async () => {
    const { user } = renderPage();
    await findInsurer("HDFC ERGO");

    await user.click(within(planPanel()).getByRole("button", { name: /Add/ }));
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));

    await user.click(within(insurerRow("HDFC ERGO")).getByRole("button", { name: "Plans" }));
    await findPlan("Optima Restore");
    await user.click(within(planPanel()).getByRole("button", { name: /Add/ }));

    expect(within(dialog()).getByLabelText(/^Insurer/)).toHaveValue("2");
  });

  it("asks the plans again and keeps the insurer filter after a write", async () => {
    const { user } = renderPage();
    await findInsurer("Star Health");

    await user.click(within(insurerRow("Star Health")).getByRole("button", { name: "Plans" }));
    await findPlan("Family Health Optima");
    const before = backend().countOf("list_products");

    await user.click(within(planPanel()).getByRole("button", { name: /Add/ }));
    await user.type(within(dialog()).getByLabelText(/^Plan name/), "Senior Citizens Red Carpet");
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));
    await screen.findByText("Plan added");

    await waitFor(() => expect(backend().countOf("list_products")).toBe(before + 1));
    expect(backend().lastCall("list_products")).toEqual({ insurerId: 1, includeInactive: false });
    expect(
      screen.getByRole("heading", { name: "Plans — Star Health", level: 2 }),
    ).toBeInTheDocument();
    expect(await findPlan("Senior Citizens Red Carpet")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- editing a plan

describe("editing a plan", () => {
  it("opens with the plan's details in the fields", async () => {
    const { user } = renderPage();
    await findPlan("Optima Restore");

    await user.click(within(planRow("Optima Restore")).getByRole("button", { name: "Edit" }));

    const form = dialog();
    expect(within(form).getByRole("heading", { name: "Edit Optima Restore" })).toBeInTheDocument();
    expect(within(form).getByLabelText(/^Insurer/)).toHaveValue("2");
    expect(within(form).getByLabelText(/^Plan name/)).toHaveValue("Optima Restore");
    expect(within(form).getByLabelText(/^Category/)).toHaveValue("health");
    expect(within(form).getByLabelText(/^Plan code/)).toHaveValue("HE-OR");
    expect(within(form).getByLabelText(/^Active/)).toBeChecked();
  });

  it("saves the changes and shows them in the list", async () => {
    const { user } = renderPage();
    await findPlan("Optima Restore");

    await user.click(within(planRow("Optima Restore")).getByRole("button", { name: "Edit" }));
    const name = within(dialog()).getByLabelText(/^Plan name/);
    await user.clear(name);
    await user.type(name, "Optima Restore Family");
    await user.selectOptions(within(dialog()).getByLabelText(/^Category/), "critical_illness");
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Plan updated")).toBeInTheDocument();
    expect(backend().lastCall("update_product")).toMatchObject({
      id: 2,
      input: { insurerId: 2, name: "Optima Restore Family", category: "critical_illness" },
    });
    await findPlan("Optima Restore Family");
    expect(within(planRow("Optima Restore Family")).getByText("Critical Illness")).toBeInTheDocument();
  });

  it("retires a plan, which drops it out of the list", async () => {
    const { user } = renderPage();
    await findPlan("Optima Restore");

    await user.click(within(planRow("Optima Restore")).getByRole("button", { name: "Edit" }));
    await user.click(within(dialog()).getByLabelText(/^Active/));
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));
    await screen.findByText("Plan updated");

    await waitFor(() => {
      expect(within(planPanel()).queryByText("Optima Restore")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("checkbox", { name: "Show inactive" }));
    expect(await findPlan("Optima Restore")).toBeInTheDocument();
  });

  it("names the insurer of a plan whose company is retired", async () => {
    backend().book.insurers[1].isActive = false;
    const { user } = renderPage();
    await findPlan("Optima Restore");

    await user.click(within(planRow("Optima Restore")).getByRole("button", { name: "Edit" }));

    expect(within(dialog()).getByLabelText(/^Insurer/)).toHaveValue("2");
  });
});

// ---------------------------------------------------------------- deleting a plan

describe("deleting a plan", () => {
  it("asks before removing anything", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user } = renderPage();
    await findPlan("Family Health Optima");

    await user.click(deleteButton(planRow("Family Health Optima")));

    expect(confirm).toHaveBeenCalledWith("Remove Family Health Optima?");
    expect(backend().countOf("delete_product")).toBe(0);
  });

  it("lets a plan go and leaves the policies that used it standing", async () => {
    // Unlike an insurer, a plan in use is not held back: `policies.product_id`
    // is ON DELETE SET NULL, so the policies stay and simply name no plan.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = renderPage();
    await findPlan("Family Health Optima");
    const covered = backend().book.policies.filter((row) => row.productName === "Family Health Optima");
    expect(covered.length).toBeGreaterThan(0);

    await user.click(deleteButton(planRow("Family Health Optima")));

    expect(await screen.findByText("Plan removed")).toBeInTheDocument();
    await waitFor(() => {
      expect(within(planPanel()).queryByText("Family Health Optima")).not.toBeInTheDocument();
    });
    for (const policy of covered) {
      expect(policy.productId).toBeNull();
      expect(policy.productName).toBeNull();
    }
  });

  it("removes a plan no policy uses and asks the list again", async () => {
    addSpareInsurer();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = renderPage();
    await findPlan("Two Wheeler Secure");
    const before = backend().countOf("list_products");

    await user.click(deleteButton(planRow("Two Wheeler Secure")));

    expect(await screen.findByText("Plan removed")).toBeInTheDocument();
    await waitFor(() => expect(backend().countOf("list_products")).toBe(before + 1));
    expect(within(planPanel()).queryByText("Two Wheeler Secure")).not.toBeInTheDocument();
  });

  it("keeps the insurer filter after a plan is removed", async () => {
    addSpareInsurer();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = renderPage();
    await findInsurer("Reliance General");

    await user.click(within(insurerRow("Reliance General")).getByRole("button", { name: "Plans" }));
    await findPlan("Two Wheeler Secure");

    await user.click(deleteButton(planRow("Two Wheeler Secure")));
    await screen.findByText("Plan removed");

    expect(
      await screen.findByRole("heading", { name: "Plans — Reliance General", level: 2 }),
    ).toBeInTheDocument();
    expect(backend().lastCall("list_products")).toEqual({ insurerId: 9, includeInactive: false });
    expect(await findPlan("No plans recorded")).toBeInTheDocument();
  });
});
