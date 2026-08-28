/**
 * The renew dialog. Renewing writes next year rather than editing this one, so
 * these tests watch both what the form offers and exactly what it sends.
 */

import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  backend,
  daysUntil,
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from "@/test";
import { RenewModal } from "@/components/RenewModal";
import type { Policy } from "@/lib/types";

function policyFrom(id: number): Policy {
  return backend().book.policies.find((row) => row.id === id)!;
}

/** A copy of a real policy, moved onto an awkward expiry date. */
function expiringOn(iso: string, id = 900): Policy {
  return {
    ...backend().book.policies[0],
    id,
    chainId: `chain-${id}`,
    policyYear: 1,
    previousPolicyId: null,
    expiryDate: iso,
    daysToExpiry: daysUntil(iso),
  };
}

/**
 * The policy in the book, with the whole proposal filled in: the health block,
 * the vehicle, and the risk periods and split premiums that belong to this year
 * alone.
 *
 * Both blocks at once on purpose. A renewal carries whatever the expiring year
 * held, whichever category it was written in, so one renewal can watch both.
 */
function fullyRecorded(): Policy {
  const detail: Partial<Policy> = {
    variant: "Gold",
    riders: ["safeguard", "future_ready"],
    planType: "individual",
    term: 1,
    policyType: "renewal",
    broker: "Deshmukh Insurance Services",
    inbuiltRider: "Road ambulance cover",
    vehicleType: "goods_carrying",
    grossVehicleWeight: 7500,
    // A lorry has no seats to record, so this is null on the row itself and
    // has to stay null rather than becoming undefined.
    passengerCapacity: null,
    vehicleManufacturer: "Tata Motors",
    vehicleModel: "Ace Gold",
    manufactureYear: 2021,
    engineNumber: "K12MN1234567",
    chassisNumber: "MA3EJKD1S00123456",
    coverType: "bundle_1_3",
    odStartDate: "2025-09-01",
    odEndDate: "2026-08-31",
    tpStartDate: "2025-09-01",
    tpEndDate: "2028-08-31",
    odPremium: 8000,
    tpPremium: 4800,
  };
  return Object.assign(policyFrom(2), detail);
}

/** How the desk drives the dialog: one row at a time, out of one piece of state. */
function RenewDesk({ policies }: { policies: Policy[] }) {
  const [selected, setSelected] = useState<Policy | undefined>();
  return (
    <>
      {policies.map((policy) => (
        <button key={policy.id} onClick={() => setSelected(policy)}>
          {`Open ${policy.policyNumber}`}
        </button>
      ))}
      <RenewModal policy={selected} onClose={() => setSelected(undefined)} />
    </>
  );
}

const field = (label: RegExp) => within(screen.getByRole("dialog")).getByLabelText(label);

describe("the renew dialog", () => {
  it("stays out of the way until a policy is chosen", async () => {
    renderWithProviders(<RenewModal onClose={vi.fn()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(backend().countOf("policy_chain")).toBe(0));
  });

  it("opens on last year's figures", async () => {
    const policy = policyFrom(1);
    renderWithProviders(<RenewModal policy={policy} onClose={vi.fn()} />);

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Renew Rohit Sharma's Health policy" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Expiring year")).toBeInTheDocument();
    expect(within(dialog).getByText(`${policy.policyNumber} · ${policy.insurerName}`)).toBeInTheDocument();
    expect(within(dialog).getByText("20 Aug 2025 → 21 Aug 2026 · ₹24,500")).toBeInTheDocument();
    expect(within(dialog).getByText(`Year ${policy.policyYear + 1}`)).toBeInTheDocument();

    expect(field(/New policy number/)).toHaveValue(policy.policyNumber);
    expect(field(/Sum insured/)).toHaveValue(policy.sumInsured);
    expect(field(/^Premium/)).toHaveValue(policy.premiumAmount);
    expect(field(/GST/)).toHaveValue(policy.gstAmount);
    expect(field(/Notes for this renewal/)).toHaveValue("");
  });

  it("runs the new year on from the old one", async () => {
    // Policy 1 stops on 21 Aug 2026, so cover picks up the next morning and
    // runs a year less a day.
    renderWithProviders(<RenewModal policy={policyFrom(1)} onClose={vi.fn()} />);

    await screen.findByRole("dialog");
    expect(field(/Start date/)).toHaveValue("2026-08-22");
    expect(field(/Expiry date/)).toHaveValue("2027-08-21");
    expect(screen.getByText("22 Aug 2026 → 21 Aug 2027")).toBeInTheDocument();
  });

  it("runs the new year on across a leap year", async () => {
    const { rerender } = renderWithProviders(
      <RenewModal policy={expiringOn("2027-02-28")} onClose={vi.fn()} />,
    );

    await screen.findByRole("dialog");
    expect(field(/Start date/)).toHaveValue("2027-03-01");
    expect(field(/Expiry date/)).toHaveValue("2028-02-29");

    rerender(<RenewModal policy={expiringOn("2028-02-28", 901)} onClose={vi.fn()} />);

    await waitFor(() => expect(field(/Start date/)).toHaveValue("2028-02-29"));
    expect(field(/Expiry date/)).toHaveValue("2029-02-28");
  });

  it("shows a new policy number in the year ahead as it is typed", async () => {
    const { user } = renderWithProviders(<RenewModal policy={policyFrom(1)} onClose={vi.fn()} />);
    await screen.findByRole("dialog");

    await user.clear(field(/New policy number/));
    await user.type(field(/New policy number/), "SH/2026/0091823");

    expect(field(/New policy number/)).toHaveValue("SH/2026/0091823");
    expect(screen.getByText("SH/2026/0091823")).toBeInTheDocument();
  });

  it("measures the new premium against last year", async () => {
    const policy = policyFrom(1);
    const { user } = renderWithProviders(<RenewModal policy={policy} onClose={vi.fn()} />);
    await screen.findByRole("dialog");

    await user.clear(field(/^Premium/));
    await user.type(field(/^Premium/), String(policy.premiumAmount! * 1.2));
    expect(await screen.findByText("+20% versus last year")).toBeInTheDocument();

    await user.clear(field(/^Premium/));
    await user.type(field(/^Premium/), String(policy.premiumAmount! * 0.9));
    expect(await screen.findByText("-10% versus last year")).toBeInTheDocument();
  });

  it("sends the year on screen, and nothing else", async () => {
    const policy = policyFrom(1);
    const onClose = vi.fn();
    const { user } = renderWithProviders(<RenewModal policy={policy} onClose={onClose} />);
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: "Record renewal" }));

    await waitFor(() => expect(backend().countOf("renew_policy")).toBe(1));
    expect(backend().lastCall("renew_policy")?.input).toEqual({
      policyId: policy.id,
      policyNumber: policy.policyNumber,
      startDate: "2026-08-22",
      expiryDate: "2027-08-21",
      sumInsured: policy.sumInsured,
      premiumAmount: policy.premiumAmount,
      gstAmount: policy.gstAmount,
      commissionRate: policy.commissionRate,
      // The dialog shows the commission the rate comes to, and sends it.
      commissionExpected: 3063,
      notes: "",
    });
    expect(await screen.findByText("Renewal recorded")).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it("sends what the desk changed", async () => {
    const policy = policyFrom(1);
    const { user } = renderWithProviders(<RenewModal policy={policy} onClose={vi.fn()} />);
    await screen.findByRole("dialog");

    await user.clear(field(/New policy number/));
    await user.type(field(/New policy number/), "SH/2026/0091823");
    await user.clear(field(/Sum insured/));
    await user.type(field(/Sum insured/), "1500000");
    await user.clear(field(/^Premium/));
    await user.type(field(/^Premium/), "26900");
    await user.clear(field(/GST/));
    await user.type(field(/GST/), "4842");
    await user.type(field(/Notes for this renewal/), "Sum insured raised to 15L.");
    fireEvent.change(field(/Start date/), { target: { value: "2026-09-01" } });
    fireEvent.change(field(/Expiry date/), { target: { value: "2027-08-31" } });

    await user.click(screen.getByRole("button", { name: "Record renewal" }));

    await waitFor(() => expect(backend().countOf("renew_policy")).toBe(1));
    expect(backend().lastCall("renew_policy")?.input).toMatchObject({
      policyId: policy.id,
      policyNumber: "SH/2026/0091823",
      startDate: "2026-09-01",
      expiryDate: "2027-08-31",
      sumInsured: 1_500_000,
      premiumAmount: 26_900,
      gstAmount: 4_842,
      notes: "Sum insured raised to 15L.",
    });
  });

  it("expects a commission that follows the new premium", async () => {
    const policy = policyFrom(1);
    const { user } = renderWithProviders(<RenewModal policy={policy} onClose={vi.fn()} />);
    await screen.findByRole("dialog");

    await user.clear(field(/^Premium/));
    await user.type(field(/^Premium/), "29400");
    await user.click(screen.getByRole("button", { name: "Record renewal" }));

    await waitFor(() => expect(backend().countOf("renew_policy")).toBe(1));
    expect(backend().lastCall("renew_policy")?.input).toMatchObject({
      commissionRate: policy.commissionRate,
      commissionExpected: Math.round((29_400 * policy.commissionRate!) / 100),
    });
  });

  it("refuses a year that expires before it starts", async () => {
    const { user } = renderWithProviders(<RenewModal policy={policyFrom(1)} onClose={vi.fn()} />);
    await screen.findByRole("dialog");

    fireEvent.change(field(/Expiry date/), { target: { value: "2026-08-01" } });
    await user.click(screen.getByRole("button", { name: "Record renewal" }));

    expect(backend().countOf("renew_policy")).toBe(0);
  });

  it("keeps letters out of the money fields", async () => {
    const { user } = renderWithProviders(<RenewModal policy={policyFrom(1)} onClose={vi.fn()} />);
    await screen.findByRole("dialog");

    await user.clear(field(/^Premium/));
    await user.type(field(/^Premium/), "twelve thousand");

    expect(field(/^Premium/)).toHaveValue(null);

    await user.click(screen.getByRole("button", { name: "Record renewal" }));

    await waitFor(() => expect(backend().countOf("renew_policy")).toBe(1));
    expect(backend().lastCall("renew_policy")?.input).toMatchObject({ premiumAmount: null });
  });

  it("records a year with no GST when the field is emptied", async () => {
    const { user } = renderWithProviders(<RenewModal policy={policyFrom(1)} onClose={vi.fn()} />);
    await screen.findByRole("dialog");

    await user.clear(field(/GST/));
    await user.click(screen.getByRole("button", { name: "Record renewal" }));

    await waitFor(() => expect(backend().countOf("renew_policy")).toBe(1));
    expect(backend().book.policies.at(-1)?.gstAmount).toBeNull();
  });

  it("keeps the vehicle and the health detail when a figure is cleared on renewal", async () => {
    const expiring = fullyRecorded();
    const { user } = renderWithProviders(<RenewModal policy={expiring} onClose={vi.fn()} />);
    await screen.findByRole("dialog");

    // Taking a figure off the new year is what makes the dialog correct it,
    // because the core reads an absent figure as "carry last year's forward".
    await user.clear(field(/GST/));
    await user.click(screen.getByRole("button", { name: "Record renewal" }));

    await waitFor(() => expect(backend().countOf("update_policy")).toBe(1));
    expect(backend().lastCall("update_policy")?.input).toMatchObject({
      gstAmount: null,
      // The proposal renewing carried forward, named again so the correction
      // does not write it away.
      variant: "Gold",
      riders: ["safeguard", "future_ready"],
      planType: "individual",
      term: 1,
      policyType: "renewal",
      broker: "Deshmukh Insurance Services",
      inbuiltRider: "Road ambulance cover",
      vehicleType: "goods_carrying",
      grossVehicleWeight: 7500,
      passengerCapacity: null,
      vehicleManufacturer: "Tata Motors",
      vehicleModel: "Ace Gold",
      manufactureYear: 2021,
      engineNumber: "K12MN1234567",
      chassisNumber: "MA3EJKD1S00123456",
      coverType: "bundle_1_3",
      // The risk the expiring year ran, and what it cost, are not the new
      // year's: they are left empty for the agent to fill in.
      odStartDate: null,
      odEndDate: null,
      tpStartDate: null,
      tpEndDate: null,
      odPremium: null,
      tpPremium: null,
    });

    const newYear = backend().book.policies.at(-1)!;
    expect(newYear.policyYear).toBe(expiring.policyYear + 1);
    expect(newYear.chassisNumber).toBe("MA3EJKD1S00123456");
    expect(newYear.broker).toBe("Deshmukh Insurance Services");
    expect(newYear.gstAmount).toBeNull();
    expect(newYear.odStartDate).toBeNull();
    expect(newYear.tpEndDate).toBeNull();
    // The dates the desk agreed stand: with no risk period on the new year
    // there is nothing for the core to read them off.
    expect(newYear.startDate).toBe("2026-09-01");
    expect(newYear.expiryDate).toBe("2027-08-31");
  });

  it("records the renewal when Enter is pressed in a field", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(<RenewModal policy={policyFrom(1)} onClose={onClose} />);
    await screen.findByRole("dialog");

    await user.clear(field(/New policy number/));
    await user.type(field(/New policy number/), "SH/2026/0091823{Enter}");

    await waitFor(() => expect(backend().countOf("renew_policy")).toBe(1));
    expect(backend().lastCall("renew_policy")?.input).toMatchObject({
      policyNumber: "SH/2026/0091823",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("records one year when Enter is pressed again while the core writes", async () => {
    const gate = backend().hold("renew_policy");
    const onClose = vi.fn();
    const { user } = renderWithProviders(<RenewModal policy={policyFrom(1)} onClose={onClose} />);
    await screen.findByRole("dialog");

    await user.type(field(/New policy number/), "{Enter}");
    await waitFor(() => expect(backend().countOf("renew_policy")).toBe(1));
    await user.type(field(/New policy number/), "{Enter}");

    expect(backend().countOf("renew_policy")).toBe(1);
    gate.release();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("holds the button while the core writes the renewal", async () => {
    const gate = backend().hold("renew_policy");
    const onClose = vi.fn();
    const { user } = renderWithProviders(<RenewModal policy={policyFrom(1)} onClose={onClose} />);
    await screen.findByRole("dialog");

    const record = screen.getByRole("button", { name: "Record renewal" });
    await user.click(record);

    await waitFor(() => expect(record).toBeDisabled());
    expect(onClose).not.toHaveBeenCalled();

    gate.release();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("shows an error from the core without closing", async () => {
    backend().fail("renew_policy", {
      kind: "validation",
      message: "Expiry date must be after the start date",
    });
    const onClose = vi.fn();
    const { user } = renderWithProviders(<RenewModal policy={policyFrom(1)} onClose={onClose} />);
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: "Record renewal" }));

    expect(
      await screen.findByText("Expiry date must be after the start date"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cancels without writing anything", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(<RenewModal policy={policyFrom(1)} onClose={onClose} />);
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(backend().countOf("renew_policy")).toBe(0);
  });

  it("closes on Escape without writing anything", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(<RenewModal policy={policyFrom(1)} onClose={onClose} />);
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(backend().countOf("renew_policy")).toBe(0);
  });

  it("closes on the corner cross without writing anything", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(<RenewModal policy={policyFrom(1)} onClose={onClose} />);
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(backend().countOf("renew_policy")).toBe(0);
  });

  it("reads out the years behind a policy", async () => {
    const chain = backend().book.policies.filter((row) => row.chainId === "chain-c");
    const current = chain.find((row) => row.status === "active")!;
    renderWithProviders(<RenewModal policy={current} onClose={vi.fn()} />);

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("History")).toBeInTheDocument();
    expect(backend().lastCall("policy_chain")).toEqual({ id: current.id });
    const years = within(dialog).getAllByRole("listitem");
    expect(years).toHaveLength(chain.length);
    expect(years[0]).toHaveTextContent("Year 1 · 18 Aug 2023 → 17 Aug 2024");
    expect(years[0]).toHaveTextContent("₹26,400");
  });

  it("leaves the history out for a policy in its first year", async () => {
    const first = backend().book.policies.find((row) => row.policyYear === 1)!;
    renderWithProviders(<RenewModal policy={first} onClose={vi.fn()} />);

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(backend().countOf("policy_chain")).toBe(1));
    expect(within(dialog).queryByText("History")).not.toBeInTheDocument();
  });

  it("shows the second policy's figures when the desk moves on to it", async () => {
    const first = policyFrom(1);
    const second = policyFrom(3);
    const { user } = renderWithProviders(<RenewDesk policies={[first, second]} />);

    await user.click(screen.getByRole("button", { name: `Open ${first.policyNumber}` }));
    await screen.findByRole("dialog");
    await user.clear(field(/^Premium/));
    await user.type(field(/^Premium/), "99999");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: `Open ${second.policyNumber}` }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: `Renew ${second.clientName}'s Health policy` }),
    ).toBeInTheDocument();
    expect(field(/New policy number/)).toHaveValue(second.policyNumber);
    expect(field(/^Premium/)).toHaveValue(second.premiumAmount);
    expect(field(/Sum insured/)).toHaveValue(second.sumInsured);
    expect(field(/Start date/)).toHaveValue("2026-08-18");
  });

  it("comes back to the first policy on its own figures", async () => {
    const first = policyFrom(1);
    const second = policyFrom(3);
    const { user } = renderWithProviders(<RenewDesk policies={[first, second]} />);

    await user.click(screen.getByRole("button", { name: `Open ${first.policyNumber}` }));
    await screen.findByRole("dialog");
    await user.clear(field(/GST/));
    await user.type(field(/GST/), "1");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: `Open ${second.policyNumber}` }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: `Open ${first.policyNumber}` }));

    await screen.findByRole("dialog");
    expect(field(/GST/)).toHaveValue(first.gstAmount);
    expect(field(/^Premium/)).toHaveValue(first.premiumAmount);
  });
});
