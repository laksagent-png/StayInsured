/**
 * The shared interface primitives.
 *
 * Every screen is built out of these, so a fault here is a fault everywhere:
 * a button that fires while it is saving, a field that hides its error, a
 * modal that keeps swallowing Escape after it has gone.
 */

import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders, screen, waitFor, within } from "@/test";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Modal,
  Pagination,
  Select,
  Spinner,
  Textarea,
  useToast,
} from "@/components/ui";

/** The spinner is the only thing on a loading button with a moving part. */
const spinnerIn = (element: HTMLElement) => element.querySelector(".animate-spin");

describe("Button", () => {
  it("wears the colour of its variant", () => {
    renderWithProviders(
      <>
        <Button variant="primary">Save</Button>
        <Button variant="secondary">Cancel</Button>
        <Button variant="ghost">Dismiss</Button>
        <Button variant="danger">Delete</Button>
        <Button variant="subtle">Renew</Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("bg-brand-600");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("border-slate-300");
    expect(screen.getByRole("button", { name: "Dismiss" })).toHaveClass("text-slate-600");
    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass("bg-rose-600");
    expect(screen.getByRole("button", { name: "Renew" })).toHaveClass("bg-brand-50");
  });

  it("falls back to the secondary variant", () => {
    renderWithProviders(<Button>Cancel</Button>);

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("bg-white");
  });

  it("sizes itself small or medium", () => {
    renderWithProviders(
      <>
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button>Default</Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Small" })).toHaveClass("text-xs");
    expect(screen.getByRole("button", { name: "Medium" })).toHaveClass("text-sm");
    expect(screen.getByRole("button", { name: "Default" })).toHaveClass("text-sm");
  });

  it("keeps its label and icon when it is idle", () => {
    renderWithProviders(
      <Button icon={<span data-testid="button-icon" />}>Add client</Button>,
    );

    const button = screen.getByRole("button", { name: "Add client" });
    expect(within(button).getByTestId("button-icon")).toBeInTheDocument();
    expect(spinnerIn(button)).toBeNull();
  });

  it("swaps the icon for a spinner while it works", () => {
    renderWithProviders(
      <Button icon={<span data-testid="button-icon" />} loading>
        Add client
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Add client" });
    expect(within(button).queryByTestId("button-icon")).not.toBeInTheDocument();
    expect(spinnerIn(button)).not.toBeNull();
  });

  it("stops taking clicks while it works", async () => {
    const onClick = vi.fn();
    const { user } = renderWithProviders(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("stops taking clicks when it is disabled", async () => {
    const onClick = vi.fn();
    const { user } = renderWithProviders(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("fires when it is neither disabled nor working", async () => {
    const onClick = vi.fn();
    const { user } = renderWithProviders(<Button onClick={onClick}>Save</Button>);

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("Field", () => {
  it("names the control and marks it required", () => {
    renderWithProviders(
      <Field label="Full name" required>
        <Input />
      </Field>,
    );

    expect(screen.getByText("Full name")).toBeInTheDocument();
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("leaves the required marker off an optional field", () => {
    renderWithProviders(
      <Field label="Full name">
        <Input />
      </Field>,
    );

    expect(screen.queryByText("*")).not.toBeInTheDocument();
  });

  it("hands typing to the control it labels", async () => {
    const { user } = renderWithProviders(
      <Field label="Full name">
        <Input />
      </Field>,
    );

    const input = screen.getByLabelText(/Full name/);
    await user.type(input, "Rohit");
    expect(input).toHaveValue("Rohit");
  });

  it("puts the cursor in the control when its label is clicked", async () => {
    const { user } = renderWithProviders(
      <Field label="Full name">
        <Input />
      </Field>,
    );

    await user.click(screen.getByText("Full name"));
    expect(screen.getByLabelText(/Full name/)).toHaveFocus();
  });

  it("shows the hint under the control", () => {
    renderWithProviders(
      <Field label="Email" hint="Reminders go here">
        <Input />
      </Field>,
    );

    expect(screen.getByText("Reminders go here")).toBeInTheDocument();
  });

  it("puts the error in the hint's place", () => {
    renderWithProviders(
      <Field label="Email" hint="Reminders go here" error="That is not an email address">
        <Input />
      </Field>,
    );

    expect(screen.getByText("That is not an email address")).toBeInTheDocument();
    expect(screen.queryByText("Reminders go here")).not.toBeInTheDocument();
  });
});

describe("form controls", () => {
  it("types into an input and reports every keystroke", async () => {
    function Bench() {
      const [value, setValue] = useState("");
      return (
        <>
          <Input aria-label="Policy number" value={value} onChange={(e) => setValue(e.target.value)} />
          <span data-testid="echo">{value}</span>
        </>
      );
    }
    const { user } = renderWithProviders(<Bench />);

    await user.type(screen.getByLabelText("Policy number"), "SH/2025");
    expect(screen.getByLabelText("Policy number")).toHaveValue("SH/2025");
    expect(screen.getByTestId("echo")).toHaveTextContent("SH/2025");
  });

  it("hands its input element back through a ref", () => {
    const ref = createRef<HTMLInputElement>();
    renderWithProviders(<Input ref={ref} aria-label="Search" />);

    expect(ref.current).toBe(screen.getByLabelText("Search"));
    ref.current?.focus();
    expect(screen.getByLabelText("Search")).toHaveFocus();
  });

  it("picks an option from a select", async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <Select aria-label="Category" defaultValue="health" onChange={onChange}>
        <option value="health">Health</option>
        <option value="motor">Motor</option>
      </Select>,
    );

    const select = screen.getByLabelText("Category");
    expect(select).toHaveValue("health");
    await user.selectOptions(select, "motor");
    expect(select).toHaveValue("motor");
    expect(onChange).toHaveBeenCalled();
  });

  it("types into a textarea", async () => {
    const { user } = renderWithProviders(<Textarea aria-label="Notes" />);

    await user.type(screen.getByLabelText("Notes"), "Called the client");
    expect(screen.getByLabelText("Notes")).toHaveValue("Called the client");
  });

  it("ticks a checkbox and reports the new state", async () => {
    const onChange = vi.fn();
    function Bench() {
      const [checked, setChecked] = useState(false);
      return (
        <Checkbox
          label="Opt out of reminders"
          hint="Nothing goes out to this client"
          checked={checked}
          onChange={(value) => {
            setChecked(value);
            onChange(value);
          }}
        />
      );
    }
    const { user } = renderWithProviders(<Bench />);

    const checkbox = screen.getByRole("checkbox", { name: /Opt out of reminders/ });
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText("Nothing goes out to this client")).toBeInTheDocument();

    await user.click(checkbox);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(checkbox).not.toBeChecked();

    await user.click(screen.getByText("Opt out of reminders"));
    expect(checkbox).toBeChecked();
  });
});

describe("Card", () => {
  it("heads the card with its title and action", () => {
    renderWithProviders(
      <Card title="Renewals" action={<Button size="sm">Export</Button>}>
        <p>Seventeen policies</p>
      </Card>,
    );

    expect(screen.getByRole("heading", { name: "Renewals" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByText("Seventeen policies")).toBeInTheDocument();
  });

  it("drops the header when there is nothing to put in it", () => {
    renderWithProviders(<Card>Just the body</Card>);

    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByText("Just the body")).toBeInTheDocument();
  });
});

describe("Badge", () => {
  it("wears the colour of its tone", () => {
    renderWithProviders(
      <>
        <Badge tone="danger">Expired</Badge>
        <Badge tone="ok">Active</Badge>
        <Badge tone="warning">Due soon</Badge>
        <Badge tone="brand">Renewed</Badge>
        <Badge tone="info">Queued</Badge>
        <Badge>Plain</Badge>
      </>,
    );

    expect(screen.getByText("Expired")).toHaveClass("bg-rose-50");
    expect(screen.getByText("Active")).toHaveClass("bg-emerald-50");
    expect(screen.getByText("Due soon")).toHaveClass("bg-amber-50");
    expect(screen.getByText("Renewed")).toHaveClass("bg-brand-50");
    expect(screen.getByText("Queued")).toHaveClass("bg-sky-50");
    expect(screen.getByText("Plain")).toHaveClass("bg-slate-100");
  });
});

describe("EmptyState", () => {
  it("says what is missing and what to do about it", () => {
    renderWithProviders(
      <EmptyState
        title="No clients yet"
        description="Import your book or add the first one by hand."
        icon={<span data-testid="empty-icon" />}
        action={<Button>Add client</Button>}
      />,
    );

    expect(screen.getByText("No clients yet")).toBeInTheDocument();
    expect(screen.getByText("Import your book or add the first one by hand.")).toBeInTheDocument();
    expect(screen.getByTestId("empty-icon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add client" })).toBeInTheDocument();
  });

  it("makes do with a title alone", () => {
    const { container } = renderWithProviders(<EmptyState title="No clients yet" />);

    expect(screen.getByText("No clients yet")).toBeInTheDocument();
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });
});

describe("Spinner", () => {
  it("says it is loading unless told otherwise", () => {
    const { container } = renderWithProviders(<Spinner />);

    expect(screen.getByText("Loading")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("carries the label it is given", () => {
    renderWithProviders(<Spinner label="Reading your book" />);

    expect(screen.getByText("Reading your book")).toBeInTheDocument();
  });
});

describe("Modal", () => {
  it("stays out of the page while it is closed", () => {
    renderWithProviders(
      <Modal open={false} onClose={() => {}} title="Renew policy">
        <p>Renewal details</p>
      </Modal>,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Renewal details")).not.toBeInTheDocument();
  });

  it("opens as a modal dialog named by its title", () => {
    renderWithProviders(
      <Modal open onClose={() => {}} title="Renew policy" description="Year 4 of this cover">
        <p>Renewal details</p>
      </Modal>,
    );

    const dialog = screen.getByRole("dialog", { name: "Renew policy" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByText("Year 4 of this cover")).toBeInTheDocument();
    expect(within(dialog).getByText("Renewal details")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <Modal open onClose={onClose} title="Renew policy">
        <p>Renewal details</p>
      </Modal>,
    );

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on the close button", async () => {
    const onClose = vi.fn();
    const { user } = renderWithProviders(
      <Modal open onClose={onClose} title="Renew policy">
        <p>Renewal details</p>
      </Modal>,
    );

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stops listening for Escape once it is closed", async () => {
    const onClose = vi.fn();
    const { user, rerender } = renderWithProviders(
      <Modal open onClose={onClose} title="Renew policy">
        <p>Renewal details</p>
      </Modal>,
    );

    rerender(
      <Modal open={false} onClose={onClose} title="Renew policy">
        <p>Renewal details</p>
      </Modal>,
    );
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stops listening for Escape once it is gone", async () => {
    const onClose = vi.fn();
    const { user, unmount } = renderWithProviders(
      <Modal open onClose={onClose} title="Renew policy">
        <p>Renewal details</p>
      </Modal>,
    );

    unmount();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("widens to the size it is asked for", () => {
    const { rerender } = renderWithProviders(
      <Modal open onClose={() => {}} title="Renew policy" width="sm">
        <p>Renewal details</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toHaveClass("max-w-md");

    for (const [width, expected] of [
      ["md", "max-w-xl"],
      ["lg", "max-w-3xl"],
      ["xl", "max-w-5xl"],
    ] as const) {
      rerender(
        <Modal open onClose={() => {}} title="Renew policy" width={width}>
          <p>Renewal details</p>
        </Modal>,
      );
      expect(screen.getByRole("dialog")).toHaveClass(expected);
    }
  });

  it("puts the footer under the body", () => {
    renderWithProviders(
      <Modal
        open
        onClose={() => {}}
        title="Renew policy"
        footer={<Button variant="primary">Renew</Button>}
      >
        <p>Renewal details</p>
      </Modal>,
    );

    expect(screen.getByRole("button", { name: "Renew" })).toBeInTheDocument();
  });
});

describe("Pagination", () => {
  it("reads out the rows on show", () => {
    renderWithProviders(<Pagination page={1} pageSize={25} total={218} onPage={() => {}} />);

    expect(screen.getByText("1–25 of 218")).toBeInTheDocument();
  });

  it("counts pages by rounding up", () => {
    renderWithProviders(<Pagination page={1} pageSize={25} total={218} onPage={() => {}} />);

    expect(screen.getByText("Page 1 of 9")).toBeInTheDocument();
  });

  it("keeps a single page for an empty list", () => {
    renderWithProviders(<Pagination page={1} pageSize={25} total={0} onPage={() => {}} />);

    expect(screen.getByText("0–0 of 0")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("has nowhere to go back to on the first page", async () => {
    const onPage = vi.fn();
    const { user } = renderWithProviders(
      <Pagination page={1} pageSize={25} total={218} onPage={onPage} />,
    );

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it("has nowhere to go on from the last page", async () => {
    const onPage = vi.fn();
    const { user } = renderWithProviders(
      <Pagination page={9} pageSize={25} total={218} onPage={onPage} />,
    );

    expect(screen.getByText("201–218 of 218")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(onPage).toHaveBeenCalledWith(8);
  });

  it("writes a large total the way the rest of the app does", () => {
    renderWithProviders(<Pagination page={1} pageSize={25} total={100_000} onPage={() => {}} />);

    expect(screen.getByText("1–25 of 1,00,000")).toBeInTheDocument();
  });

  it("keeps the range inside the book when the page is past the end", () => {
    renderWithProviders(<Pagination page={10} pageSize={25} total={218} onPage={() => {}} />);

    const [from] = (screen.getByText(/of 218$/).textContent ?? "").split("–").map(Number);
    expect(from).toBeLessThanOrEqual(218);
  });
});

describe("toasts", () => {
  function ToastBench() {
    const toast = useToast();
    return (
      <>
        <Button onClick={() => toast.success("Client saved")}>Succeed</Button>
        <Button onClick={() => toast.error("The book would not open")}>Fail</Button>
        <Button onClick={() => toast.info("Nothing was due today")}>Inform</Button>
      </>
    );
  }

  it("shows a note for each tone", async () => {
    const { user } = renderWithProviders(<ToastBench />);

    await user.click(screen.getByRole("button", { name: "Succeed" }));
    expect(await screen.findByText("Client saved")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Fail" }));
    expect(await screen.findByText("The book would not open")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Inform" }));
    expect(await screen.findByText("Nothing was due today")).toBeInTheDocument();
  });

  it("stacks several notes at once", async () => {
    const { user } = renderWithProviders(<ToastBench />);

    await user.click(screen.getByRole("button", { name: "Succeed" }));
    await user.click(screen.getByRole("button", { name: "Fail" }));
    await user.click(screen.getByRole("button", { name: "Inform" }));

    expect(await screen.findAllByRole("button", { name: "Dismiss" })).toHaveLength(3);
    expect(screen.getByText("Client saved")).toBeInTheDocument();
    expect(screen.getByText("The book would not open")).toBeInTheDocument();
    expect(screen.getByText("Nothing was due today")).toBeInTheDocument();
  });

  it("dismisses the note that was dismissed, and only that one", async () => {
    const { user } = renderWithProviders(<ToastBench />);

    await user.click(screen.getByRole("button", { name: "Succeed" }));
    await user.click(screen.getByRole("button", { name: "Fail" }));
    const dismissals = await screen.findAllByRole("button", { name: "Dismiss" });

    await user.click(dismissals[0]);

    await waitFor(() => {
      expect(screen.queryByText("Client saved")).not.toBeInTheDocument();
    });
    expect(screen.getByText("The book would not open")).toBeInTheDocument();
  });

  // The clock is frozen and the timeouts are real, so the lifetimes are read off
  // the timer rather than waited out.
  it("leaves an error up longer than good news", async () => {
    const timer = vi.spyOn(window, "setTimeout");
    const { user } = renderWithProviders(<ToastBench />);

    await user.click(screen.getByRole("button", { name: "Succeed" }));
    await screen.findByText("Client saved");
    const afterSuccess = timer.mock.calls.map((call) => call[1]);

    await user.click(screen.getByRole("button", { name: "Fail" }));
    await screen.findByText("The book would not open");
    const afterError = timer.mock.calls.map((call) => call[1]);

    expect(afterSuccess).toContain(4000);
    expect(afterSuccess).not.toContain(7000);
    expect(afterError).toContain(7000);
  });

  it("gives an informational note the shorter life", async () => {
    const timer = vi.spyOn(window, "setTimeout");
    const { user } = renderWithProviders(<ToastBench />);

    await user.click(screen.getByRole("button", { name: "Inform" }));
    await screen.findByText("Nothing was due today");

    expect(timer.mock.calls.map((call) => call[1])).toContain(4000);
  });
});
