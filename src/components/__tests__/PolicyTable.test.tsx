/**
 * The policy list every screen shares: how a policy reads, how urgent it looks,
 * and what the buttons beside it do.
 */

import { useState, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { PolicyTable } from "@/components/PolicyTable";
import type { Policy, PolicyFilter } from "@/lib/types";
import {
  backend,
  currentRoute,
  isoDaysFromToday,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from "@/test";

type TableProps = ComponentProps<typeof PolicyTable>;

/** Where each column lands in a row, with the client column shown. */
const CELL = { client: 0, policy: 1, type: 2, expiry: 3, premium: 4, status: 5, actions: 6 };

/** The tone a badge is wearing, read back from the class it carries. */
const TONES: Record<string, string> = {
  "bg-rose-50": "danger",
  "bg-amber-50": "warning",
  "bg-emerald-50": "ok",
  "bg-slate-100": "muted",
};

function toneOf(badge: HTMLElement): string {
  return Object.entries(TONES).find(([token]) => badge.classList.contains(token))?.[1] ?? "none";
}

/** The table holding its own filter, the way every page that uses it does. */
function Policies({ filter: initial = {}, onFilterChange, ...rest }: Partial<TableProps>) {
  const [filter, setFilter] = useState<PolicyFilter>(initial);
  return (
    <PolicyTable
      {...rest}
      filter={filter}
      onFilterChange={(next) => {
        setFilter(next);
        onFilterChange?.(next);
      }}
    />
  );
}

/** Renders the table and waits for the first load to land. */
async function showPolicies(props: Partial<TableProps> = {}) {
  const rendered = renderWithProviders(<Policies {...props} />);
  await waitFor(() => expect(screen.queryByText("Loading")).not.toBeInTheDocument());
  return rendered;
}

const rowFor = (policyNumber: string) =>
  screen.getByText(policyNumber).closest("tr") as HTMLElement;

const cellsOf = (policyNumber: string) => within(rowFor(policyNumber)).getAllByRole("cell");

const header = (name: string) => screen.getByRole("columnheader", { name });

/** Replaces the book's policies with ones shaped from the first policy in it. */
function putPolicies(...overrides: Array<Partial<Policy>>): void {
  const [first] = backend().book.policies;
  backend().book.policies = overrides.map((extra, index) => ({
    ...first,
    id: 900 + index,
    chainId: `chain-${900 + index}`,
    policyYear: 1,
    previousPolicyId: null,
    isRenewed: false,
    policyNumber: `TST/${index}`,
    ...extra,
  }));
}

describe("PolicyTable", () => {
  it("shows a spinner while the book is being read, then the rows", async () => {
    const gate = backend().hold("list_policies");
    renderWithProviders(<Policies />);

    expect(await screen.findByText("Loading")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    gate.release();

    expect(await screen.findByText("SH/2025/0091823")).toBeInTheDocument();
  });

  it("heads the list with the columns a policy is read by", async () => {
    await showPolicies();

    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Client",
      "Policy",
      "Type",
      "Expiry",
      "Premium",
      "Status",
      "",
    ]);
  });

  it("draws a row for every policy the book returns", async () => {
    await showPolicies();

    expect(within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row")).toHaveLength(17);
    expect(backend().lastCall("list_policies")?.filter).toEqual({});
  });

  it("drops the client column when the screen already names the client", async () => {
    await showPolicies({ showClient: false, filter: { clientId: 1 } });

    expect(screen.queryByRole("columnheader", { name: "Client" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Rohit Sharma" })).not.toBeInTheDocument();
    expect(screen.getByText("SH/2025/0091823")).toBeInTheDocument();
  });

  describe("what a row says", () => {
    it("links the client and shows the address underneath", async () => {
      await showPolicies();

      const cell = cellsOf("SH/2025/0091823")[CELL.client];
      expect(within(cell).getByRole("link", { name: "Rohit Sharma" })).toHaveAttribute(
        "href",
        "/clients/1",
      );
      expect(within(cell).getByText("rohit.sharma@example.com")).toBeInTheDocument();
    });

    it("falls back to the phone number when the client has no email", async () => {
      await showPolicies({ filter: { clientId: 3 } });

      const cell = cellsOf("NIA/MOT/330912")[CELL.client];
      expect(within(cell).getByText("99250 44556")).toBeInTheDocument();
    });

    it("falls back to the client code when there is no email or phone", async () => {
      backend().book.clients[0].email = null;
      backend().book.clients[0].phone = null;
      await showPolicies({ filter: { clientId: 1 } });

      const cell = cellsOf("SH/2025/0091823")[CELL.client];
      expect(within(cell).getByText("CL-00001")).toBeInTheDocument();
    });

    it("puts the insurer and the plan under the policy number", async () => {
      await showPolicies();

      const cell = cellsOf("SH/2025/0091823")[CELL.policy];
      expect(within(cell).getByText("Star Health · Family Health Optima")).toBeInTheDocument();
    });

    it("shows the insurer alone when the policy has no plan", async () => {
      await showPolicies();

      const cell = cellsOf("NIA/MOT/330912")[CELL.policy];
      expect(within(cell).getByText("New India Assurance")).toBeInTheDocument();
      expect(cell).not.toHaveTextContent("·");
    });

    it("names the category, and the year once a policy has been renewed", async () => {
      await showPolicies();

      expect(cellsOf("SH/2025/0091823")[CELL.type]).toHaveTextContent("Health");
      expect(cellsOf("SH/2025/0091823")[CELL.type]).toHaveTextContent("yr 2");
      expect(cellsOf("IL/MOT/778211")[CELL.type]).toHaveTextContent("Motor");
      expect(cellsOf("IL/MOT/778211")[CELL.type]).not.toHaveTextContent("yr");
    });

    it("writes the expiry date the way the app writes dates", async () => {
      await showPolicies();

      expect(within(cellsOf("SH/2025/0091823")[CELL.expiry]).getByText("21 Aug 2026")).toBeInTheDocument();
      expect(within(cellsOf("HE/OR/554120")[CELL.expiry]).getByText("17 Aug 2026")).toBeInTheDocument();
    });

    it("groups money the Indian way and marks the cover underneath", async () => {
      await showPolicies();

      const cell = cellsOf("SH/2025/0091823")[CELL.premium];
      expect(within(cell).getByText("₹24,500")).toBeInTheDocument();
      expect(within(cell).getByText("₹10,00,000 cover")).toBeInTheDocument();
      expect(
        within(cellsOf("LIC/915/220481")[CELL.premium]).getByText("₹50,00,000 cover"),
      ).toBeInTheDocument();
    });

    it("writes a dash where the premium and the cover are missing", async () => {
      putPolicies({ premiumAmount: null, sumInsured: null, commissionRate: null });
      await showPolicies();

      const cell = cellsOf("TST/0")[CELL.premium];
      expect(within(cell).getByText("—")).toBeInTheDocument();
      expect(within(cell).getByText("— cover")).toBeInTheDocument();
    });

    it("reads a policy with no plan, no premium and no vehicle without complaint", async () => {
      putPolicies({
        productId: null,
        productName: null,
        premiumAmount: null,
        sumInsured: null,
        vehicleNumber: null,
        category: "motor",
      });
      await showPolicies();

      const cells = cellsOf("TST/0");
      expect(cells[CELL.policy]).toHaveTextContent("Star Health");
      expect(cells[CELL.type]).toHaveTextContent("Motor");
      expect(cells[CELL.premium]).toHaveTextContent("—");
      expect(cells[CELL.status]).toHaveTextContent("Active");
    });
  });

  describe("how urgent a policy looks", () => {
    const cases: Array<{ days: number; text: string; tone: string }> = [
      { days: -40, text: "40 days ago", tone: "danger" },
      { days: -1, text: "Yesterday", tone: "danger" },
      { days: 0, text: "Today", tone: "danger" },
      { days: 1, text: "Tomorrow", tone: "danger" },
      { days: 7, text: "in 7 days", tone: "danger" },
      { days: 15, text: "in 15 days", tone: "danger" },
      { days: 16, text: "in 16 days", tone: "warning" },
      { days: 45, text: "in 45 days", tone: "warning" },
      { days: 46, text: "in 46 days", tone: "ok" },
    ];

    it.each(cases)("says $text in $tone when expiry is $days days away", async ({ days, text, tone }) => {
      putPolicies({ expiryDate: isoDaysFromToday(days), status: "active" });
      await showPolicies();

      const badge = within(cellsOf("TST/0")[CELL.expiry]).getByText(text);
      expect(toneOf(badge)).toBe(tone);
    });

    it("counts the days since an expired policy lapsed", async () => {
      await showPolicies();

      const badge = within(cellsOf("NIA/MOT/330912")[CELL.expiry]).getByText("5 days ago");
      expect(toneOf(badge)).toBe("danger");
      expect(
        toneOf(within(cellsOf("SH/2024/0088410")[CELL.expiry]).getByText("16 days ago")),
      ).toBe("danger");
    });

    it("says Renewed instead of counting down once a policy has been renewed", async () => {
      await showPolicies();

      const badge = within(cellsOf("SH/2024/0091823")[CELL.expiry]).getByText("Renewed");
      expect(toneOf(badge)).toBe("muted");
    });

    it("keeps a cancelled policy quiet however close its expiry is", async () => {
      putPolicies({ status: "cancelled", expiryDate: isoDaysFromToday(3) });
      await showPolicies();

      const badge = within(cellsOf("TST/0")[CELL.expiry]).getByText("in 3 days");
      expect(toneOf(badge)).toBe("muted");
    });
  });

  describe("the status column", () => {
    it("labels and tones each status the way the book means it", async () => {
      putPolicies(
        { status: "active" },
        { status: "expired", expiryDate: isoDaysFromToday(-20) },
        { status: "renewed", isRenewed: true },
        { status: "cancelled" },
        { status: "lapsed", expiryDate: isoDaysFromToday(-90) },
      );
      await showPolicies();

      const statusOf = (policyNumber: string) => {
        const cell = cellsOf(policyNumber)[CELL.status];
        const badge = within(cell).getByText(/Active|Expired|Renewed|Cancelled|Lapsed/);
        return { label: badge.textContent, tone: toneOf(badge) };
      };

      expect(statusOf("TST/0")).toEqual({ label: "Active", tone: "ok" });
      expect(statusOf("TST/1")).toEqual({ label: "Expired", tone: "danger" });
      expect(statusOf("TST/2")).toEqual({ label: "Renewed", tone: "muted" });
      expect(statusOf("TST/3")).toEqual({ label: "Cancelled", tone: "muted" });
      expect(statusOf("TST/4")).toEqual({ label: "Lapsed", tone: "danger" });
    });

    it("is not offered as a sort, because the book cannot sort by it", async () => {
      const { user } = await showPolicies();
      const before = backend().countOf("list_policies");

      await user.click(header("Status"));

      expect(backend().countOf("list_policies")).toBe(before);
    });
  });

  describe("sorting", () => {
    it("asks the book for the column that was clicked", async () => {
      const { user } = await showPolicies();

      await user.click(header("Policy"));

      await waitFor(() => {
        expect(backend().lastCall("list_policies")?.filter).toMatchObject({
          sort: "policyNumber",
          descending: false,
        });
      });
    });

    it("reverses the same column on a second click", async () => {
      const { user } = await showPolicies();

      await user.click(header("Premium"));
      await waitFor(() => {
        expect(backend().lastCall("list_policies")?.filter).toMatchObject({
          sort: "premium",
          descending: false,
        });
      });

      await user.click(header("Premium"));
      await waitFor(() => {
        expect(backend().lastCall("list_policies")?.filter).toMatchObject({
          sort: "premium",
          descending: true,
        });
      });
      expect(header("Premium").querySelector(".lucide-chevron-down")).toBeInTheDocument();
    });

    it("starts a different column ascending again", async () => {
      const { user } = await showPolicies();

      await user.click(header("Client"));
      await user.click(header("Client"));
      await user.click(header("Expiry"));

      await waitFor(() => {
        expect(backend().lastCall("list_policies")?.filter).toMatchObject({
          sort: "expiry",
          descending: false,
        });
      });
      expect(header("Expiry").querySelector(".lucide-chevron-up")).toBeInTheDocument();
      expect(header("Client").querySelector("svg")).not.toBeInTheDocument();
    });

    it("reorders the rows the book sends back", async () => {
      const { user } = await showPolicies();

      await user.click(header("Client"));

      await waitFor(() => {
        const first = within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row")[0];
        expect(within(first).getByRole("link")).toHaveTextContent("Anita Desai");
      });
    });
  });

  describe("paging", () => {
    it("counts the whole book under a part of it", async () => {
      await showPolicies({ filter: { pageSize: 5 } });

      expect(screen.getByText("1–5 of 17")).toBeInTheDocument();
      expect(screen.getByText("Page 1 of 4")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    });

    it("asks for the next page", async () => {
      const onFilterChange = vi.fn();
      const { user } = await showPolicies({ filter: { pageSize: 5 }, onFilterChange });

      await user.click(screen.getByRole("button", { name: "Next" }));

      expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
      expect(await screen.findByText("6–10 of 17")).toBeInTheDocument();
    });

    it("hides the pager when the book has nothing to page through", async () => {
      backend().book.policies = [];
      await showPolicies();

      expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    });

    it("returns to the first page when the order changes", async () => {
      const { user } = await showPolicies({ filter: { pageSize: 5 } });

      await user.click(screen.getByRole("button", { name: "Next" }));
      await screen.findByText("6–10 of 17");
      await user.click(header("Premium"));

      await waitFor(() => {
        expect(backend().lastCall("list_policies")?.filter).toMatchObject({ page: 1 });
      });
    });
  });

  describe("the buttons beside a policy", () => {
    it("renews the policy the button belongs to", async () => {
      const onRenew = vi.fn();
      const { user } = await showPolicies({ onRenew });

      await user.click(within(rowFor("NIA/MOT/330912")).getByRole("button", { name: /Renew/ }));

      expect(onRenew).toHaveBeenCalledTimes(1);
      expect(onRenew.mock.calls[0][0]).toMatchObject({ id: 5, policyNumber: "NIA/MOT/330912" });
    });

    it("offers no renewal on a policy that has already been renewed", async () => {
      await showPolicies({ onRenew: vi.fn() });

      expect(
        within(rowFor("SH/2024/0091823")).queryByRole("button", { name: /Renew/ }),
      ).not.toBeInTheDocument();
      expect(within(rowFor("SH/2025/0091823")).getByRole("button", { name: /Renew/ })).toBeInTheDocument();
    });

    it("leaves the renew button out when the screen cannot renew", async () => {
      await showPolicies();

      expect(screen.queryByRole("button", { name: /Renew/ })).not.toBeInTheDocument();
    });

    it("opens the history of a policy that has run more than a year", async () => {
      const onHistory = vi.fn();
      const { user } = await showPolicies({ onHistory });

      await user.click(within(rowFor("SH/2025/0091823")).getByRole("button", { name: "History" }));

      expect(onHistory.mock.calls[0][0]).toMatchObject({ id: 1, policyYear: 2 });
      expect(
        within(rowFor("IL/MOT/778211")).queryByRole("button", { name: "History" }),
      ).not.toBeInTheDocument();
    });

    it("deletes a policy once the warning is accepted", async () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      const { user } = await showPolicies();

      await user.click(within(rowFor("NIA/MOT/330912")).getByRole("button", { name: "Delete" }));

      expect(confirm).toHaveBeenCalledWith(
        "Delete policy NIA/MOT/330912? This removes this policy year permanently.",
      );
      await waitFor(() => expect(backend().lastCall("delete_policy")).toEqual({ id: 5 }));
      expect(await screen.findByText("Policy deleted")).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.queryByText("NIA/MOT/330912")).not.toBeInTheDocument();
      });
    });

    it("keeps the policy when the warning is dismissed", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      const { user } = await showPolicies();

      await user.click(within(rowFor("NIA/MOT/330912")).getByRole("button", { name: "Delete" }));

      expect(backend().countOf("delete_policy")).toBe(0);
      expect(screen.getByText("NIA/MOT/330912")).toBeInTheDocument();
    });

    it("says why a delete was refused", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      backend().fail("delete_policy", { kind: "conflict", message: "This policy has a renewal" });
      const { user } = await showPolicies();

      await user.click(within(rowFor("NIA/MOT/330912")).getByRole("button", { name: "Delete" }));

      expect(await screen.findByText("This policy has a renewal")).toBeInTheDocument();
      expect(screen.getByText("NIA/MOT/330912")).toBeInTheDocument();
    });
  });

  describe("opening a policy", () => {
    it("opens the editor for the row that was clicked", async () => {
      const onEdit = vi.fn();
      const { user } = await showPolicies({ onEdit });

      await user.click(screen.getByText("IL/MOT/778211"));

      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(onEdit.mock.calls[0][0]).toMatchObject({ id: 2, policyNumber: "IL/MOT/778211" });
    });

    it("leaves the row alone when the screen has no editor", async () => {
      const { user } = await showPolicies();

      await user.click(screen.getByText("IL/MOT/778211"));

      expect(rowFor("IL/MOT/778211")).not.toHaveClass("cursor-pointer");
    });

    it("does not open the editor behind the row's own buttons", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);
      const onEdit = vi.fn();
      const onRenew = vi.fn();
      const onHistory = vi.fn();
      const { user } = await showPolicies({ onEdit, onRenew, onHistory });

      const row = rowFor("SH/2025/0091823");
      await user.click(within(row).getByRole("button", { name: /Renew/ }));
      await user.click(within(row).getByRole("button", { name: "History" }));
      await user.click(within(row).getByRole("button", { name: "Delete" }));

      expect(onRenew).toHaveBeenCalledTimes(1);
      expect(onHistory).toHaveBeenCalledTimes(1);
      expect(onEdit).not.toHaveBeenCalled();
    });

    it("only follows the client link when the client name is clicked", async () => {
      const onEdit = vi.fn();
      const { user } = await showPolicies({ onEdit });

      const row = rowFor("SH/2025/0091823");
      await user.click(within(row).getByRole("link", { name: "Rohit Sharma" }));

      expect(currentRoute()).toBe("/clients/1");
      expect(onEdit).not.toHaveBeenCalled();
    });
  });

  describe("a long chain of renewals", () => {
    it("shows every year of the chain with its own history and status", async () => {
      const onHistory = vi.fn();
      const onRenew = vi.fn();
      await showPolicies({ filter: { clientId: 2 }, onHistory, onRenew });

      expect(cellsOf("HE/OR/331885")[CELL.type]).not.toHaveTextContent("yr");
      expect(cellsOf("HE/OR/442903")[CELL.type]).toHaveTextContent("yr 2");
      expect(cellsOf("HE/OR/554120")[CELL.type]).toHaveTextContent("yr 3");

      expect(cellsOf("HE/OR/442903")[CELL.status]).toHaveTextContent("Renewed");
      expect(cellsOf("HE/OR/554120")[CELL.status]).toHaveTextContent("Active");

      expect(screen.getAllByRole("button", { name: "History" })).toHaveLength(2);
      expect(
        within(rowFor("HE/OR/442903")).queryByRole("button", { name: /Renew/ }),
      ).not.toBeInTheDocument();
      expect(within(rowFor("HE/OR/554120")).getByRole("button", { name: /Renew/ })).toBeInTheDocument();
    });
  });

  describe("when there is nothing to show", () => {
    it("explains the empty list instead of drawing an empty table", async () => {
      backend().book.policies = [];
      await showPolicies();

      expect(screen.getByText("No policies match")).toBeInTheDocument();
      expect(screen.getByText("Adjust the filters, or add a policy.")).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("lets the screen word the empty list itself", async () => {
      await showPolicies({
        filter: { search: "nothing like this" },
        emptyTitle: "No renewals due",
        emptyDescription: "Nothing expires in this window.",
      });

      expect(screen.getByText("No renewals due")).toBeInTheDocument();
      expect(screen.getByText("Nothing expires in this window.")).toBeInTheDocument();
    });

    it("says the load failed rather than that the book is empty", async () => {
      backend().fail("list_policies", { kind: "internal", message: "The book would not open" });
      renderWithProviders(<Policies />);

      await waitFor(() => expect(screen.queryByText("Loading")).not.toBeInTheDocument());

      expect(backend().countOf("list_policies")).toBe(1);
      expect(screen.queryByText("No policies match")).not.toBeInTheDocument();
    });
  });

  // The table offers no checkboxes at all, so there is no way to renew, export
  // or delete a batch of policies in one go.
  it("offers no way to pick out several policies at once", async () => {
    await showPolicies({ onRenew: vi.fn(), onEdit: vi.fn(), onHistory: vi.fn() });

    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /select all/i })).not.toBeInTheDocument();
  });
});
