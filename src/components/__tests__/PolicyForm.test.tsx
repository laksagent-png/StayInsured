/**
 * The policy form: every field, the pickers that depend on each other, the
 * rules it holds an agent to, and the payload it sends.
 */

import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  backend,
  renderWithProviders,
  screen,
  waitFor,
  within,
  type Rendered,
} from "@/test";
import { PolicyForm } from "@/components/PolicyForm";
import type { Policy, PolicyInput } from "@/lib/types";

type User = Rendered["user"];

/** A policy straight from the book, the way the list hands one over. */
function fromBook(id: number): Policy {
  return backend().book.policies.find((row) => row.id === id)!;
}

/** The form, open, with a spy on the close. */
function openForm(props: Partial<Parameters<typeof PolicyForm>[0]> = {}) {
  const onClose = vi.fn();
  const rendered = renderWithProviders(<PolicyForm open onClose={onClose} {...props} />);
  return { ...rendered, onClose };
}

/** The form the way Policies mounts it: kept in place, opened and closed. */
function Host({ policy }: { policy?: Policy }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open the form</button>
      <PolicyForm open={open} policy={policy} onClose={() => setOpen(false)} />
    </>
  );
}

/** The client picker's box; it is the only control the Client label wraps. */
const clientBox = () => screen.getByPlaceholderText("Search by name, phone or code");

/*
 * A label carries a star when the field is required and its hint when it has
 * one, and health renames the dates to the risk period. So the boxes are reached
 * by what their labels start with, which holds for whichever category the form
 * is showing. Plan turns away Plan type, which reads as a longer Plan.
 */
const planBox = () => screen.getByLabelText(/^Plan(?! type)/);
const startBox = () => screen.getByLabelText(/^(Risk )?start date/i);
const expiryBox = () => screen.getByLabelText(/^(Expiry date|Risk end date)/i);
const sumInsuredBox = () => screen.getByLabelText(/^Sum insured/);
const premiumBox = () => screen.getByLabelText(/^Premium/);

/** Every label the form is showing, in the order it shows them. */
function fieldLabels(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("form .field-label")).map((node) =>
    node.textContent!.replace("*", "").trim(),
  );
}

/** The input the payload was built from. */
function savedInput(command: "create_policy" | "update_policy"): PolicyInput {
  return backend().lastCall(command)?.input as PolicyInput;
}

/** Picks a client out of the search list. */
async function chooseClient(user: User, name: string | RegExp) {
  await user.click(clientBox());
  await user.click(await screen.findByRole("button", { name }));
}

/** Picks an insurer once the book has answered with the list. */
async function chooseInsurer(user: User, id: number, name: string) {
  await screen.findByRole("option", { name });
  await user.selectOptions(screen.getByLabelText(/Insurer/), String(id));
}

/** Picks a plan once the insurer's plans have arrived. */
async function choosePlan(user: User, id: number, name: string) {
  await screen.findByRole("option", { name });
  await user.selectOptions(planBox(), String(id));
}

async function chooseCategory(user: User, category: string) {
  await user.selectOptions(screen.getByLabelText(/Category/), category);
}

/**
 * The least a new policy needs: a client, an insurer and a number. Health is
 * the exception and has a helper of its own, so this moves off it first.
 */
async function fillMinimum(user: User, policyNumber = "SH/2026/0001") {
  await chooseCategory(user, "other");
  await chooseClient(user, /Anita Desai/);
  await chooseInsurer(user, 2, "HDFC ERGO");
  await user.type(screen.getByLabelText(/Policy number/), policyNumber);
}

/**
 * The vehicle and the two covers, on a private car with a package policy. The
 * broker is left out: it is the one answer a policy keeps on its way between
 * health and motor, so the tests that care fill it in themselves.
 */
async function fillVehicle(user: User) {
  await user.selectOptions(screen.getByLabelText(/Vehicle type/), "pvt_car");
  await user.type(screen.getByLabelText(/Manufacturer/), "Maruti Suzuki");
  await user.type(screen.getByLabelText(/Make \/ model/), "Swift VXi");
  await user.type(screen.getByLabelText(/Year of manufacture/), "2021");
  await user.type(screen.getByLabelText(/Registration number/), "mh12ab1234");
  await user.type(screen.getByLabelText(/Engine number/), "k12mn1234567");
  await user.type(screen.getByLabelText(/Chassis number/), "ma3ejkd1s00123456");
  await user.selectOptions(screen.getByLabelText(/Policy type/), "package");
  await user.type(screen.getByLabelText(/Own damage start/), "2026-09-01");
  await user.type(screen.getByLabelText(/Own damage end/), "2027-08-31");
  await user.type(screen.getByLabelText(/Own damage premium/), "8000");
  await user.type(screen.getByLabelText(/Third party start/), "2026-09-01");
  await user.type(screen.getByLabelText(/Third party end/), "2027-08-31");
  await user.type(screen.getByLabelText(/Third party premium/), "4000");
}

/** Everything a motor proposal is required to answer, from an empty form. */
async function fillMotor(user: User, policyNumber = "IL/2026/0001") {
  await chooseCategory(user, "motor");
  await chooseClient(user, /Anita Desai/);
  await chooseInsurer(user, 3, "ICICI Lombard");
  await user.type(screen.getByLabelText(/Policy number/), policyNumber);
  await fillVehicle(user);
  await user.type(screen.getByLabelText(/Broker/), "Deshmukh Insurance Services");
}

/** Everything a health proposal is required to answer. */
async function fillHealth(user: User, policyNumber = "HE/2026/0001") {
  await chooseClient(user, /Anita Desai/);
  await user.type(screen.getByLabelText(/Policy number/), policyNumber);
  await chooseInsurer(user, 2, "HDFC ERGO");
  await choosePlan(user, 2, "Optima Restore");
  await user.type(screen.getByLabelText(/Variant/), "Platinum");
  await user.click(screen.getByRole("button", { name: "Safeguard +" }));
  await user.selectOptions(screen.getByLabelText(/Plan type/), "family_floater");
  await user.selectOptions(screen.getByLabelText(/Term/), "2");
  await user.selectOptions(screen.getByLabelText(/Policy type/), "portability");
  await user.type(sumInsuredBox(), "1500000");
  await user.type(premiumBox(), "30000");
  await user.type(screen.getByLabelText(/Broker/), "Deshmukh Insurance Services");
  await user.type(screen.getByLabelText(/Inbuilt rider/), "Restore benefit");
}

const addPolicy = () => screen.getByRole("button", { name: "Add policy" });
const saveChanges = () => screen.getByRole("button", { name: "Save changes" });

describe("the policy form for a new policy", () => {
  it("stays out of sight until it is opened", () => {
    renderWithProviders(<PolicyForm open={false} onClose={vi.fn()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers every field the guide lists", async () => {
    const { user } = openForm();
    await chooseCategory(user, "other");

    expect(screen.getByRole("heading", { name: "New policy" })).toBeInTheDocument();
    expect(clientBox()).toBeInTheDocument();
    for (const label of [
      /Policy number/,
      /Insurer/,
      /^Plan(?! type)/,
      /Category/,
      /Start date/,
      /Expiry date/,
      "Sum insured",
      "Premium",
      "GST",
      "Frequency",
      "Commission %",
      /Commission amount/,
      "Payment mode",
      "Nominee",
      "Nominee relation",
      "Notes",
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    // Vehicle number belongs to motor policies only, and the health details to
    // health.
    expect(screen.queryByLabelText("Vehicle number")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Variant/)).not.toBeInTheDocument();
  });

  it("starts today, with a year less a day of cover", () => {
    openForm();

    expect(startBox()).toHaveValue("2026-08-14");
    expect(expiryBox()).toHaveValue("2027-08-13");
  });

  it("cannot pick a plan until an insurer is chosen", () => {
    openForm();

    expect(planBox()).toBeDisabled();
    expect(screen.getByText("Pick an insurer first")).toBeInTheDocument();
  });

  it("takes the client from a client's page without asking again", async () => {
    openForm({ fixedClientId: 1 });

    expect(await screen.findByDisplayValue("Rohit Sharma")).toBeDisabled();
    expect(screen.queryByPlaceholderText("Search by name, phone or code")).not.toBeInTheDocument();
  });
});

describe("the order the policy form asks in", () => {
  it("takes a health proposal the way the insurer's form is laid out", () => {
    // Health opens the form, so no category has to be chosen to see this.
    openForm();

    expect(fieldLabels().slice(0, 16)).toEqual([
      "Category",
      "Client",
      "Policy number",
      "Insurer",
      "Plan",
      "Variant",
      "Riders",
      "Plan type",
      "Term",
      "Risk start date",
      "Risk end date",
      "Policy type",
      "Sum insured",
      "Premium",
      "Broker",
      "Inbuilt rider",
    ]);
  });

  it("keeps the book's own bookkeeping below the proposal", () => {
    openForm();

    expect(fieldLabels().slice(16)).toEqual([
      "GST",
      "Frequency",
      "Payment mode",
      "Commission %",
      "Commission amount",
      "Nominee",
      "Nominee relation",
      "Notes",
    ]);
  });

  it("leaves every other category on the general layout", async () => {
    const { user } = openForm();

    await chooseCategory(user, "travel");

    expect(fieldLabels()).toEqual([
      "Client",
      "Policy number",
      "Insurer",
      "Plan",
      "Category",
      "Start date",
      "Expiry date",
      "Sum insured",
      "Premium",
      "GST",
      "Frequency",
      "Commission %",
      "Commission amount",
      "Payment mode",
      "Nominee",
      "Nominee relation",
      "Notes",
    ]);
  });
});

describe("what a health policy asks for", () => {
  it("names the riders the plan is sold with", () => {
    openForm();

    for (const rider of [
      "Safeguard",
      "Safeguard +",
      "PA to main member",
      "Future Ready",
      "Fast Forwarded",
    ]) {
      expect(screen.getByRole("button", { name: rider })).toBeInTheDocument();
    }
  });

  it("takes riders on and off, and sends the set that is left", async () => {
    const { user } = openForm();
    await fillHealth(user);

    await user.click(screen.getByRole("button", { name: "Future Ready" }));
    await user.click(screen.getByRole("button", { name: "Safeguard" }));
    // Safeguard was ticked and untocked, so it goes nowhere near the payload.
    await user.click(screen.getByRole("button", { name: "Safeguard" }));

    await user.click(addPolicy());

    await waitFor(() =>
      expect(savedInput("create_policy").riders).toEqual(["safeguard_plus", "future_ready"]),
    );
  });

  it("works the risk end date out from the term", async () => {
    const { user } = openForm();

    await user.selectOptions(screen.getByLabelText(/Term/), "3");

    expect(expiryBox()).toHaveValue("2029-08-13");

    await user.selectOptions(screen.getByLabelText(/Term/), "1");

    expect(expiryBox()).toHaveValue("2027-08-13");
  });

  it("asks for each missing answer in the order the form reads", async () => {
    const { user } = openForm();
    await chooseClient(user, /Anita Desai/);
    await chooseInsurer(user, 2, "HDFC ERGO");
    await user.type(screen.getByLabelText(/Policy number/), "HE/2026/0009");

    for (const [complaint, put] of [
      ["Choose the plan this health policy is written on", () => choosePlan(user, 2, "Optima Restore")],
      ["Name the variant of the plan", () => user.type(screen.getByLabelText(/Variant/), "Platinum")],
      [
        "Choose the riders, or the plan cannot be priced",
        () => user.click(screen.getByRole("button", { name: "Safeguard" })),
      ],
      [
        "Say whether the cover is individual or a family floater",
        () => user.selectOptions(screen.getByLabelText(/Plan type/), "individual"),
      ],
      [
        "Choose how many years of cover were bought",
        () => user.selectOptions(screen.getByLabelText(/Term/), "1"),
      ],
      [
        "Say whether this is fresh, a portability or a renewal",
        () => user.selectOptions(screen.getByLabelText(/Policy type/), "fresh"),
      ],
      ["A health policy needs its sum insured", () => user.type(sumInsuredBox(), "500000")],
      ["A health policy needs its premium", () => user.type(premiumBox(), "18000")],
      ["Name the broker this was placed through", () => user.type(screen.getByLabelText(/Broker/), "Deshmukh")],
      [
        "Name the rider the plan comes with",
        () => user.type(screen.getByLabelText(/Inbuilt rider/), "Restore benefit"),
      ],
    ] as [string, () => Promise<void>][]) {
      await user.click(addPolicy());
      expect(await screen.findByText(complaint)).toBeInTheDocument();
      expect(backend().countOf("create_policy")).toBe(0);
      await put();
    }

    await user.click(addPolicy());

    await waitFor(() => expect(backend().countOf("create_policy")).toBe(1));
  });

  it("leaves the health answers behind when the policy stops being health", async () => {
    const { user } = openForm();
    await fillHealth(user);

    await chooseCategory(user, "travel");
    await user.click(addPolicy());

    await waitFor(() => expect(backend().countOf("create_policy")).toBe(1));
    expect(savedInput("create_policy")).toMatchObject({
      category: "travel",
      variant: "",
      riders: [],
      planType: null,
      term: null,
      policyType: null,
      broker: "",
      inbuiltRider: "",
    });
  });

  it("shows what an existing health policy already answered", async () => {
    openForm({ policy: fromBook(1) });

    await waitFor(() => expect(screen.getByLabelText(/Variant/)).toHaveValue("Gold"));
    expect(screen.getByLabelText(/Plan type/)).toHaveValue("family_floater");
    expect(screen.getByLabelText(/Policy type/)).toHaveValue("renewal");
    expect(screen.getByLabelText(/Broker/)).toHaveValue("Deshmukh Insurance Services");
    expect(screen.getByLabelText(/Inbuilt rider/)).toHaveValue("Road ambulance cover");
    expect(screen.getByRole("button", { name: "Safeguard" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Safeguard +" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("what a motor policy asks for", () => {
  it("asks a motor policy for the vehicle and the covers", async () => {
    const { user } = openForm();

    await chooseCategory(user, "motor");

    expect(fieldLabels()).toEqual([
      "Category",
      "Client",
      "Policy number",
      "Insurer",
      "Plan",
      "Vehicle type",
      "Manufacturer",
      "Make / model",
      "Year of manufacture",
      "Registration number",
      "Engine number",
      "Chassis number",
      "Policy type",
      "Broker",
      "Own damage start",
      "Own damage end",
      "Own damage premium",
      "Third party start",
      "Third party end",
      "Third party premium",
      "Premium",
      "Sum insured",
      "GST",
      "Frequency",
      "Commission %",
      "Commission amount",
      "Payment mode",
      "Nominee",
      "Nominee relation",
      "Notes",
    ]);

    await chooseClient(user, /Anita Desai/);
    await chooseInsurer(user, 3, "ICICI Lombard");
    await user.type(screen.getByLabelText(/Policy number/), "IL/2026/0001");
    await user.click(addPolicy());

    expect(await screen.findByText("Say what kind of vehicle this is")).toBeInTheDocument();
    expect(backend().countOf("create_policy")).toBe(0);
  });

  it("asks a goods carrying vehicle for its weight and a passenger vehicle for its seats", async () => {
    const { user } = openForm();
    await chooseCategory(user, "motor");
    const vehicleType = screen.getByLabelText(/Vehicle type/);

    expect(screen.queryByLabelText(/Gross vehicle weight/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Passengers/)).not.toBeInTheDocument();

    await user.selectOptions(vehicleType, "goods_carrying");
    await user.type(screen.getByLabelText(/Gross vehicle weight/), "7500");
    expect(screen.queryByLabelText(/Passengers/)).not.toBeInTheDocument();

    await user.selectOptions(vehicleType, "passenger");
    expect(screen.queryByLabelText(/Gross vehicle weight/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/Passengers/), "42");

    // The weight went with the lorry, so the lorry is asked for it again.
    await user.selectOptions(vehicleType, "goods_carrying");
    expect(screen.getByLabelText(/Gross vehicle weight/)).toHaveValue(null);
    expect(screen.queryByLabelText(/Passengers/)).not.toBeInTheDocument();
  });

  it("hides third party cover on a standalone own damage policy", async () => {
    const { user } = openForm();
    await fillMotor(user);

    // Both covers were filled in before the schedule narrowed them to one.
    await user.selectOptions(screen.getByLabelText(/Policy type/), "standalone_od");

    expect(screen.getByLabelText(/Own damage start/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Third party start/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Third party premium/)).not.toBeInTheDocument();

    await user.click(addPolicy());

    await waitFor(() => expect(backend().countOf("create_policy")).toBe(1));
    expect(savedInput("create_policy")).toMatchObject({
      coverType: "standalone_od",
      odStartDate: "2026-09-01",
      odEndDate: "2027-08-31",
      odPremium: 8000,
      tpStartDate: "",
      tpEndDate: "",
      tpPremium: null,
    });
  });

  it("adds the own damage and third party premiums into the total", async () => {
    const { user } = openForm();
    await fillMotor(user);
    const coverType = screen.getByLabelText(/Policy type/);

    expect(screen.getByText("₹12,000 from the covers")).toBeInTheDocument();
    expect(premiumBox()).toHaveValue(null);

    // Both rows stay on show until a cover type is chosen, but neither premium
    // would be stored yet, so there is no total to state either.
    await user.selectOptions(coverType, "");
    expect(screen.getByLabelText(/Own damage premium/)).toHaveValue(8000);
    expect(screen.getByLabelText(/Third party premium/)).toHaveValue(4000);
    expect(screen.queryByText(/from the covers/)).not.toBeInTheDocument();

    // A liability policy sold no own damage, so only the half that applies is
    // counted, whatever the other box is holding.
    await user.selectOptions(coverType, "liability");
    expect(screen.getByText("₹4,000 from the covers")).toBeInTheDocument();

    await user.selectOptions(coverType, "package");
    expect(screen.getByText("₹12,000 from the covers")).toBeInTheDocument();

    await user.click(addPolicy());

    await waitFor(() => expect(backend().countOf("create_policy")).toBe(1));
    expect(savedInput("create_policy").premiumAmount).toBe(12000);

    // A total typed by hand stands, whatever the two halves come to.
    await user.clear(screen.getByLabelText(/Policy number/));
    await user.type(screen.getByLabelText(/Policy number/), "IL/2026/0002");
    await user.type(premiumBox(), "11500");
    expect(screen.queryByText("₹12,000 from the covers")).not.toBeInTheDocument();

    await user.click(addPolicy());

    await waitFor(() => expect(backend().countOf("create_policy")).toBe(2));
    expect(savedInput("create_policy").premiumAmount).toBe(11500);
  });

  it("sends the earliest cover dates as the policy dates", async () => {
    const { user } = openForm();
    await fillMotor(user);

    // A 1+3 bundle: the own damage cover is bought again after a year, while
    // the third party cover runs three.
    await user.selectOptions(screen.getByLabelText(/Policy type/), "bundle_1_3");
    await user.clear(screen.getByLabelText(/Third party end/));
    await user.type(screen.getByLabelText(/Third party end/), "2029-08-31");

    expect(screen.queryByLabelText(/^Start date/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Expiry date/)).not.toBeInTheDocument();

    await user.click(addPolicy());

    await waitFor(() => expect(backend().countOf("create_policy")).toBe(1));
    expect(savedInput("create_policy")).toMatchObject({
      startDate: "2026-09-01",
      expiryDate: "2027-08-31",
      odEndDate: "2027-08-31",
      tpEndDate: "2029-08-31",
    });
  });

  it("keeps the broker when a policy moves between health and motor", async () => {
    const { user } = openForm();
    await fillHealth(user);

    await chooseCategory(user, "motor");
    await fillVehicle(user);
    await user.click(addPolicy());

    await waitFor(() => expect(backend().countOf("create_policy")).toBe(1));
    expect(savedInput("create_policy")).toMatchObject({
      category: "motor",
      broker: "Deshmukh Insurance Services",
      chassisNumber: "MA3EJKD1S00123456",
      riders: [],
      variant: "",
      inbuiltRider: "",
    });

    // And back the other way, where the vehicle is what is left behind.
    await user.clear(screen.getByLabelText(/Policy number/));
    await user.type(screen.getByLabelText(/Policy number/), "HE/2026/0002");
    await chooseCategory(user, "health");
    await user.click(addPolicy());

    await waitFor(() => expect(backend().countOf("create_policy")).toBe(2));
    expect(savedInput("create_policy")).toMatchObject({
      category: "health",
      broker: "Deshmukh Insurance Services",
      chassisNumber: "",
      vehicleType: null,
      vehicleNumber: "",
      riders: ["safeguard_plus"],
    });
  });
});

describe("the policy form's client picker", () => {
  it("searches the book, and takes the client that is clicked", async () => {
    const { user } = openForm();

    await user.click(clientBox());

    await waitFor(() =>
      expect(backend().lastCall("list_clients")?.filter).toMatchObject({
        search: "",
        pageSize: 8,
        sort: "name",
      }),
    );
    expect(await screen.findByRole("button", { name: /Rohit Sharma/ })).toBeInTheDocument();

    await user.type(clientBox(), "Anita");
    await waitFor(() =>
      expect(backend().lastCall("list_clients")?.filter).toMatchObject({ search: "Anita" }),
    );
    expect(screen.queryByRole("button", { name: /Rohit Sharma/ })).not.toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: /Anita Desai/ }));

    expect(await screen.findByDisplayValue("Anita Desai")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /CL-00002/ })).not.toBeInTheDocument();
  });

  it("shows the members of the chosen client as chips", async () => {
    const { user } = openForm();

    await chooseClient(user, /Rohit Sharma/);

    expect(await screen.findByText("Members covered")).toBeInTheDocument();
    for (const name of ["Rohit Sharma", "Sneha Sharma", "Aarav Sharma"]) {
      expect(screen.getByRole("button", { name: new RegExp(name) })).toBeInTheDocument();
    }
  });

  it("closes the client list once the work moves on", async () => {
    const { user } = openForm();

    await user.click(clientBox());
    await screen.findByRole("button", { name: /Rohit Sharma/ });

    await user.click(screen.getByLabelText(/Policy number/));

    expect(screen.queryByRole("button", { name: /Rohit Sharma/ })).not.toBeInTheDocument();
  });

  it("keeps showing the chosen client when the box is focused again", async () => {
    const { user } = openForm();

    await chooseClient(user, /Anita Desai/);
    await screen.findByDisplayValue("Anita Desai");

    await user.click(clientBox());

    expect(clientBox()).toHaveValue("Anita Desai");
  });

  /*
   * Pressing a row must not take the focus out of the search box. WebKit does
   * not focus a button that is clicked, so a row that let the focus go would
   * blur the box to nothing, close the list under the pointer, and lose the
   * click that was meant to choose the client.
   */
  it("keeps the search box focused while a row is chosen", async () => {
    const { user } = openForm();

    await chooseClient(user, /Anita Desai/);
    await screen.findByDisplayValue("Anita Desai");

    expect(clientBox()).toHaveFocus();
  });

  it("offers the list again when the box is pressed after a choice", async () => {
    const { user } = openForm();

    await chooseClient(user, /Anita Desai/);
    await screen.findByDisplayValue("Anita Desai");

    await user.click(clientBox());

    expect(await screen.findByRole("button", { name: /Rohit Sharma/ })).toBeInTheDocument();
  });
});

describe("the policy form's insurer and plan pickers", () => {
  it("narrows the plans to the chosen insurer", async () => {
    const { user } = openForm();

    await chooseInsurer(user, 1, "Star Health");

    await waitFor(() => expect(backend().lastCall("list_products")?.insurerId).toBe(1));
    const plan = planBox();
    expect(plan).toBeEnabled();
    await waitFor(() =>
      expect(within(plan).getAllByRole("option").map((option) => option.textContent)).toEqual([
        "Not recorded",
        "Family Health Optima",
      ]),
    );

    await chooseInsurer(user, 2, "HDFC ERGO");

    await waitFor(() =>
      expect(within(plan).getAllByRole("option").map((option) => option.textContent)).toEqual([
        "Not recorded",
        "Optima Restore",
        "Personal Accident Shield",
      ]),
    );
  });

  it("forgets the plan when the insurer changes", async () => {
    const { user } = openForm();
    await fillMinimum(user);

    await chooseInsurer(user, 1, "Star Health");
    await choosePlan(user, 1, "Family Health Optima");
    expect(planBox()).toHaveValue("1");

    await chooseInsurer(user, 2, "HDFC ERGO");

    expect(planBox()).toHaveValue("");
    await user.click(addPolicy());
    await waitFor(() => expect(savedInput("create_policy")).toMatchObject({ productId: null }));
  });

  it("keeps the plan an existing policy already has", async () => {
    openForm({ policy: fromBook(1) });

    await waitFor(() => expect(planBox()).toHaveValue("1"));
    expect(screen.getByLabelText(/Insurer/)).toHaveValue("1");
  });
});

describe("what the policy form insists on", () => {
  it("asks for the client first", async () => {
    const { user } = openForm();

    await user.click(addPolicy());

    expect(
      await screen.findByText("Choose the client this policy belongs to"),
    ).toBeInTheDocument();
    expect(backend().countOf("create_policy")).toBe(0);
  });

  it("asks for the insurer next", async () => {
    const { user } = openForm();
    await chooseClient(user, /Anita Desai/);

    await user.click(addPolicy());

    expect(await screen.findByText("Choose the insurer")).toBeInTheDocument();
    expect(backend().countOf("create_policy")).toBe(0);
  });

  it("asks for the policy number", async () => {
    const { user } = openForm();
    await chooseClient(user, /Anita Desai/);
    await chooseInsurer(user, 2, "HDFC ERGO");

    await user.click(addPolicy());

    expect(await screen.findByText("Policy number is required")).toBeInTheDocument();
    expect(backend().countOf("create_policy")).toBe(0);
  });

  it("refuses a number that is only spaces", async () => {
    const { user } = openForm();
    await fillMinimum(user, "   ");

    await user.click(addPolicy());

    expect(await screen.findByText("Policy number is required")).toBeInTheDocument();
    expect(backend().countOf("create_policy")).toBe(0);
  });

  it("asks for both dates", async () => {
    const { user } = openForm();
    await fillMinimum(user);
    await user.clear(startBox());

    await user.click(addPolicy());

    expect(await screen.findByText("Both start and expiry dates are needed")).toBeInTheDocument();
    expect(backend().countOf("create_policy")).toBe(0);
  });

  it("swaps one complaint for the next as the form is put right", async () => {
    const { user } = openForm();

    await user.click(addPolicy());
    await screen.findByText("Choose the client this policy belongs to");

    await chooseClient(user, /Anita Desai/);
    await user.click(addPolicy());

    expect(await screen.findByText("Choose the insurer")).toBeInTheDocument();
    expect(
      screen.queryByText("Choose the client this policy belongs to"),
    ).not.toBeInTheDocument();
  });
});

describe("the policy form's dates", () => {
  it("moves the expiry with the start date until it is set by hand", async () => {
    const { user } = openForm();

    const start = startBox();
    await user.clear(start);
    await user.type(start, "2026-09-01");
    expect(expiryBox()).toHaveValue("2027-08-31");

    const expiry = expiryBox();
    await user.clear(expiry);
    await user.type(expiry, "2027-12-31");

    await user.clear(start);
    await user.type(start, "2026-10-01");
    expect(expiryBox()).toHaveValue("2027-12-31");
  });

  it("passes on the core's complaint when the expiry equals the start", async () => {
    const { user } = openForm();
    await fillMinimum(user);
    const expiry = expiryBox();
    await user.clear(expiry);
    await user.type(expiry, "2026-08-14");

    await user.click(addPolicy());

    expect(
      await screen.findByText("Expiry date must be after the start date"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("catches an expiry before the start without asking the core", async () => {
    const { user } = openForm();
    await fillMinimum(user);
    const expiry = expiryBox();
    await user.clear(expiry);
    await user.type(expiry, "2026-01-01");

    await user.click(addPolicy());

    await waitFor(() =>
      expect(screen.getByText(/come after the start date/)).toBeInTheDocument(),
    );
    expect(backend().countOf("create_policy")).toBe(0);
  });
});

describe("the policy form's numbers", () => {
  it("ignores letters typed into an amount", async () => {
    const { user } = openForm();
    await fillMinimum(user);

    await user.type(premiumBox(), "abc");
    expect(premiumBox()).toHaveValue(null);

    await user.click(addPolicy());

    await waitFor(() => expect(savedInput("create_policy").premiumAmount).toBeNull());
  });

  it("sends nothing rather than zero when an amount is left blank", async () => {
    const { user } = openForm();
    await fillMinimum(user);

    await user.click(addPolicy());

    await waitFor(() => expect(backend().countOf("create_policy")).toBe(1));
    const input = savedInput("create_policy");
    expect(input.sumInsured).toBeNull();
    expect(input.premiumAmount).toBeNull();
    expect(input.gstAmount).toBeNull();
    expect(input.commissionRate).toBeNull();
    expect(input.commissionExpected).toBeNull();
  });

  it("keeps a nil amount that was typed on purpose", async () => {
    const { user } = openForm();
    await fillMinimum(user);

    await user.type(premiumBox(), "0");

    await user.click(addPolicy());

    await waitFor(() => expect(savedInput("create_policy").premiumAmount).toBe(0));
  });

  it("refuses a negative premium", async () => {
    const { user } = openForm();
    await fillMinimum(user);

    await user.type(premiumBox(), "-500");

    await user.click(addPolicy());

    expect(backend().countOf("create_policy")).toBe(0);
  });

  it("refuses a negative sum insured and an impossible commission rate", async () => {
    const { user } = openForm();
    await fillMinimum(user);

    await user.type(sumInsuredBox(), "-100000");
    await user.type(screen.getByLabelText("Commission %"), "500");

    await user.click(addPolicy());

    expect(backend().countOf("create_policy")).toBe(0);
  });

  it("works the commission out from the premium and the rate", async () => {
    const { user } = openForm();
    await fillMinimum(user);

    await user.type(premiumBox(), "24500");
    await user.type(screen.getByLabelText("Commission %"), "12.5");

    expect(await screen.findByText("₹3,063 from the rate")).toBeInTheDocument();
    expect(screen.getByLabelText(/Commission amount/)).toHaveValue(null);

    await user.click(addPolicy());

    await waitFor(() => expect(savedInput("create_policy").commissionExpected).toBe(3063));
  });

  it("lets a typed commission stand", async () => {
    const { user } = openForm();
    await fillMinimum(user);

    await user.type(premiumBox(), "24500");
    await user.type(screen.getByLabelText("Commission %"), "12.5");
    await user.type(screen.getByLabelText(/Commission amount/), "2000");

    expect(screen.queryByText("₹3,063 from the rate")).not.toBeInTheDocument();

    await user.click(addPolicy());

    await waitFor(() => expect(savedInput("create_policy").commissionExpected).toBe(2000));
  });

  it("works the commission out again when an existing premium changes", async () => {
    const { user } = openForm({ policy: fromBook(1) });
    await waitFor(() => expect(premiumBox()).toHaveValue(24500));

    await user.clear(premiumBox());
    await user.type(premiumBox(), "50000");

    await user.click(saveChanges());

    await waitFor(() => expect(savedInput("update_policy").commissionExpected).toBe(6250));
  });
});

describe("the policy form's covered members", () => {
  it("ticks the lives an existing policy covers", async () => {
    openForm({ policy: fromBook(1) });

    expect(await screen.findByText("Members covered")).toBeInTheDocument();
    expect(backend().lastCall("policy_insured_ids")).toEqual({ id: 1 });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Sneha Sharma/ })).toHaveClass("bg-brand-50"),
    );
  });

  it("offers the holder and the people related to them, and nobody else", async () => {
    openForm({ policy: fromBook(1) });
    await screen.findByText("Members covered");

    for (const name of [/Rohit Sharma, policyholder/, /Sneha Sharma, spouse/, /Aarav Sharma, son/]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    // Anita Desai is a client, but not this family's.
    expect(screen.queryByRole("button", { name: /Anita Desai, / })).not.toBeInTheDocument();
  });

  it("saves the lives that are ticked, by client", async () => {
    const { user } = openForm({ policy: fromBook(1) });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Sneha Sharma/ })).toHaveClass("bg-brand-50"),
    );

    await user.click(screen.getByRole("button", { name: /Sneha Sharma/ }));
    await user.click(saveChanges());

    await waitFor(() => expect(savedInput("update_policy").insuredClientIds).toEqual([1, 10]));
  });

  it("adds a life to a new policy", async () => {
    const { user } = openForm();
    await chooseCategory(user, "other");
    await chooseClient(user, /Rohit Sharma/);
    await chooseInsurer(user, 2, "HDFC ERGO");
    await user.type(screen.getByLabelText(/Policy number/), "SH/2026/0001");

    await user.click(await screen.findByRole("button", { name: /Aarav Sharma, son/ }));
    await user.click(addPolicy());

    await waitFor(() => expect(savedInput("create_policy").insuredClientIds).toEqual([10]));
  });

  it("says nothing about cover for a client with nobody linked to them", async () => {
    const { user } = openForm();
    await fillMinimum(user);

    // Anita Desai holds her own cover and has no family in the book, so naming
    // her on her own policy would say nothing.
    await waitFor(() => expect(backend().countOf("list_relatives")).toBeGreaterThan(0));
    expect(screen.queryByText("Members covered")).not.toBeInTheDocument();
  });

  it("forgets the lives when the client changes", async () => {
    const { user } = openForm();
    await chooseCategory(user, "other");
    await chooseClient(user, /Rohit Sharma/);
    await user.click(await screen.findByRole("button", { name: /Sneha Sharma/ }));

    await user.click(clientBox());
    await user.click(await screen.findByRole("button", { name: /Anita Desai/ }));
    await chooseInsurer(user, 2, "HDFC ERGO");
    await user.type(screen.getByLabelText(/Policy number/), "SH/2026/0002");
    await user.click(addPolicy());

    await waitFor(() => expect(savedInput("create_policy").insuredClientIds).toEqual([]));
  });
});

describe("the policy form's registration number", () => {
  it("appears for a motor policy, in capitals", async () => {
    const { user } = openForm();
    await fillMotor(user);

    expect(screen.getByLabelText(/Registration number/)).toHaveValue("MH12AB1234");

    await user.click(addPolicy());

    await waitFor(() =>
      expect(savedInput("create_policy")).toMatchObject({
        category: "motor",
        vehicleNumber: "MH12AB1234",
      }),
    );
  });

  it("shows the vehicle an existing motor policy carries", async () => {
    openForm({ policy: fromBook(2) });

    expect(await screen.findByLabelText(/Registration number/)).toHaveValue("MH12AB1234");
  });

  it("drops the vehicle number when the policy stops being motor", async () => {
    const { user } = openForm();
    await fillMinimum(user);

    await user.selectOptions(screen.getByLabelText(/Category/), "motor");
    await user.type(screen.getByLabelText(/Registration number/), "mh12ab1234");
    await user.selectOptions(screen.getByLabelText(/Category/), "travel");
    expect(screen.queryByLabelText(/Registration number/)).not.toBeInTheDocument();

    await user.click(addPolicy());

    await waitFor(() => expect(savedInput("create_policy").vehicleNumber).toBeFalsy());
  });
});

describe("saving from the policy form", () => {
  it("sends exactly what was filled in", async () => {
    const { user, onClose } = openForm();

    await fillHealth(user);
    const start = startBox();
    await user.clear(start);
    await user.type(start, "2026-09-01");
    await user.type(screen.getByLabelText("GST"), "5400");
    await user.selectOptions(screen.getByLabelText("Frequency"), "half_yearly");
    await user.type(screen.getByLabelText("Commission %"), "15");
    await user.type(screen.getByLabelText("Payment mode"), "UPI");
    await user.type(screen.getByLabelText("Nominee"), "Rahul Desai");
    await user.type(screen.getByLabelText("Nominee relation"), "Son");
    await user.type(screen.getByLabelText("Notes"), "Ported from last year");

    await user.click(addPolicy());

    await waitFor(() => expect(backend().countOf("create_policy")).toBe(1));
    expect(savedInput("create_policy")).toEqual({
      policyNumber: "HE/2026/0001",
      clientId: 2,
      insurerId: 2,
      productId: 2,
      category: "health",
      startDate: "2026-09-01",
      // Two years were bought, so the risk runs to the day before the second
      // anniversary rather than the first.
      expiryDate: "2028-08-31",
      sumInsured: 1500000,
      premiumAmount: 30000,
      gstAmount: 5400,
      premiumFrequency: "half_yearly",
      paymentMode: "UPI",
      commissionRate: 15,
      commissionExpected: 4500,
      nomineeName: "Rahul Desai",
      nomineeRelation: "Son",
      variant: "Platinum",
      riders: ["safeguard_plus"],
      planType: "family_floater",
      term: 2,
      policyType: "portability",
      broker: "Deshmukh Insurance Services",
      inbuiltRider: "Restore benefit",
      // A new policy takes its status from the calendar, so none is sent. Text
      // fields that were never touched go as empty strings.
      vehicleNumber: "",
      // The vehicle belongs to motor cover, so a health policy carries none of
      // it.
      vehicleType: null,
      grossVehicleWeight: null,
      passengerCapacity: null,
      vehicleManufacturer: "",
      vehicleModel: "",
      manufactureYear: null,
      engineNumber: "",
      chassisNumber: "",
      coverType: null,
      odStartDate: "",
      odEndDate: "",
      tpStartDate: "",
      tpEndDate: "",
      odPremium: null,
      tpPremium: null,
      notes: "Ported from last year",
      // Anita has nobody linked to her, so the policy names no other life.
      insuredClientIds: [],
    });
    expect(await screen.findByText("Policy added")).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it("updates the policy year that was opened, and no other", async () => {
    const { user, onClose } = openForm({ policy: fromBook(1) });
    await waitFor(() => expect(premiumBox()).toHaveValue(24500));

    await user.clear(premiumBox());
    await user.type(premiumBox(), "26000");
    await user.type(screen.getByLabelText("Notes"), " Premium revised.");

    await user.click(saveChanges());

    await waitFor(() => expect(backend().countOf("update_policy")).toBe(1));
    expect(backend().lastCall("update_policy")?.id).toBe(1);
    expect(savedInput("update_policy")).toMatchObject({
      policyNumber: "SH/2025/0091823",
      clientId: 1,
      insurerId: 1,
      productId: 1,
      category: "health",
      status: "active",
      startDate: "2025-08-20",
      expiryDate: "2026-08-21",
      premiumAmount: 26000,
      commissionRate: 12.5,
      notes: "Floater covering three members. Premium revised.",
    });
    expect(await screen.findByText("Policy updated")).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
    expect(backend().countOf("create_policy")).toBe(0);
  });

  it("shows a duplicate policy number on the form and stays open", async () => {
    backend().fail("create_policy", {
      kind: "conflict",
      message: "That policy number is already in the book",
    });
    const { user, onClose } = openForm();
    await fillMinimum(user, "SH/2025/0091823");

    await user.click(addPolicy());

    expect(
      await screen.findByText("That policy number is already in the book"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Policy number/)).toHaveValue("SH/2025/0091823");
  });

  it("lets a refused save be tried again", async () => {
    backend().failOnce("create_policy", { kind: "conflict", message: "Already in the book" });
    const { user, onClose } = openForm();
    await fillMinimum(user);

    await user.click(addPolicy());
    await screen.findByText("Already in the book");

    await user.click(addPolicy());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(backend().countOf("create_policy")).toBe(2);
  });

  it("saves when Enter is pressed in a field", async () => {
    const { user, onClose } = openForm();
    await chooseCategory(user, "other");
    await chooseClient(user, /Anita Desai/);
    await chooseInsurer(user, 2, "HDFC ERGO");

    await user.type(screen.getByLabelText(/Policy number/), "SH/2026/0001{Enter}");

    await waitFor(() => expect(backend().countOf("create_policy")).toBe(1));
    expect(savedInput("create_policy")).toMatchObject({ policyNumber: "SH/2026/0001" });
    expect(onClose).toHaveBeenCalled();
  });

  it("takes the closest client on Enter in the search box, without saving", async () => {
    const { user } = openForm();

    await user.type(clientBox(), "Anita");
    await screen.findByRole("button", { name: /Anita Desai/ });
    await user.keyboard("{Enter}");

    expect(await screen.findByDisplayValue("Anita Desai")).toBeInTheDocument();
    // A policy with no insurer and no number was never sent, and never
    // complained about either.
    expect(screen.queryByText(/^Choose the/)).not.toBeInTheDocument();
    expect(backend().countOf("create_policy")).toBe(0);
  });

  it("sends one policy when Enter is pressed again while the core writes", async () => {
    const gate = backend().hold("create_policy");
    const { user, onClose } = openForm();
    await fillMinimum(user);

    await user.type(screen.getByLabelText("Nominee"), "{Enter}");
    await waitFor(() => expect(backend().countOf("create_policy")).toBe(1));
    await user.type(screen.getByLabelText("Nominee"), "{Enter}");

    expect(backend().countOf("create_policy")).toBe(1);
    gate.release();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("waits with the button held while the core writes", async () => {
    const gate = backend().hold("create_policy");
    const { user, onClose } = openForm();
    await fillMinimum(user);

    await user.click(addPolicy());

    await waitFor(() => expect(addPolicy()).toBeDisabled());
    await user.click(addPolicy());
    expect(backend().countOf("create_policy")).toBe(1);

    gate.release();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(backend().countOf("create_policy")).toBe(1);
  });
});

describe("leaving the policy form", () => {
  it("closes on Cancel without writing anything", async () => {
    const { user, onClose } = openForm();
    await fillMinimum(user);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(backend().countOf("create_policy")).toBe(0);
  });

  it("closes on Escape and on the corner cross", async () => {
    const { user, onClose } = openForm();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("forgets what was typed when it is opened again", async () => {
    const { user } = renderWithProviders(<Host />);

    await user.click(screen.getByRole("button", { name: "Open the form" }));
    await user.type(screen.getByLabelText(/Policy number/), "SH/2026/0001");
    await user.type(premiumBox(), "12345");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Open the form" }));

    expect(screen.getByLabelText(/Policy number/)).toHaveValue("");
    expect(premiumBox()).toHaveValue(null);
    expect(startBox()).toHaveValue("2026-08-14");
  });

  it("loads the policy again when an edit is reopened", async () => {
    const { user } = renderWithProviders(<Host policy={fromBook(2)} />);

    await user.click(screen.getByRole("button", { name: "Open the form" }));
    await user.clear(premiumBox());
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Open the form" }));

    expect(premiumBox()).toHaveValue(12800);
    expect(screen.getByLabelText(/Policy number/)).toHaveValue("IL/MOT/778211");
  });
});

describe("what the policy form says about an existing policy", () => {
  it("names the year and the day it was recorded", async () => {
    openForm({ policy: fromBook(1) });

    expect(
      await screen.findByText("Policy year 2 · created 20 Aug 2025"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Editing changes this policy year only. Use Renew to add the next year."),
    ).toBeInTheDocument();
  });

  it("can set the status by hand", async () => {
    openForm({ policy: fromBook(1) });

    expect(await screen.findByLabelText(/Status/)).toBeInTheDocument();
  });
});
