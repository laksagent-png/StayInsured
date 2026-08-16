/**
 * The rule form: what an agent fills in, what the core is asked to write, and
 * what happens when it refuses.
 */

import { describe, expect, it, vi } from "vitest";

import { backend, renderWithProviders, screen, waitFor, within } from "@/test";
import { RuleForm } from "@/components/RuleForm";
import type { ReminderRule } from "@/lib/types";

const ruleNamed = (name: string): ReminderRule =>
  backend().book.rules.find((rule) => rule.name === name)!;

function open(rule: ReminderRule | "new" = "new") {
  const onClose = vi.fn();
  const rendered = renderWithProviders(<RuleForm rule={rule} onClose={onClose} />);
  return { ...rendered, onClose };
}

const nameBox = () => screen.getByPlaceholderText("30 days before expiry");
const daysBox = () => screen.getByRole("spinbutton");
const countedBox = () => screen.getByLabelText(/^Counted/);
const appliesBox = () => screen.getByLabelText(/^Applies to/);
const goesToBox = () => screen.getByLabelText(/^Goes to/);
const howBox = () => screen.getByLabelText(/^How/);
const messageBox = () => screen.getByLabelText(/^Message/);
const activeBox = () => screen.getByRole("checkbox");
/** The hint under a field, which is where the timing is spelled out. */
const hintUnder = (box: HTMLElement) => box.closest("label")!;
const saveButton = () => screen.getByRole("button", { name: "Save rule" });

/** The message list arrives from the core, so wait for it before choosing one. */
const messagesLoaded = () => screen.findByRole("option", { name: "Final expiry notice" });

describe("a new rule", () => {
  it("opens on the defaults a rule usually wants", async () => {
    open();

    expect(screen.getByRole("heading", { name: "New rule" })).toBeInTheDocument();
    expect(nameBox()).toHaveValue("");
    expect(daysBox()).toHaveValue(30);
    expect(countedBox()).toHaveValue("before");
    expect(hintUnder(countedBox())).toHaveTextContent("30 days before expiry");
    expect(appliesBox()).toHaveValue("");
    expect(goesToBox()).toHaveValue("client");
    expect(howBox()).toHaveValue("email");
    expect(messageBox()).toHaveValue("");
    expect(activeBox()).toBeChecked();
  });

  it("offers every message in the book to choose from", async () => {
    open();
    await messagesLoaded();

    const options = within(messageBox()).getAllByRole("option").map((item) => item.textContent);
    expect(options).toEqual([
      "Choose a message",
      "Policy expiry reminder",
      "Final expiry notice",
      "Lapsed policy follow up",
      "Renewal confirmation",
      "Provider daily digest",
    ]);
  });

  it("sends what was filled in to create_rule", async () => {
    const { user, onClose } = open();
    await messagesLoaded();

    await user.type(nameBox(), "45 days before expiry");
    await user.type(daysBox(), "{Control>}a{/Control}45");
    await user.selectOptions(messageBox(), "2");
    await user.click(saveButton());

    await waitFor(() => {
      expect(backend().lastCall("create_rule")?.input).toMatchObject({
        name: "45 days before expiry",
        offsetDays: 45,
        category: null,
        audience: "client",
        channel: "email",
        templateId: 2,
        isActive: true,
      });
    });
    expect(await screen.findByText("Rule saved")).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it("counts days after expiry as a negative offset", async () => {
    const { user } = open();
    await messagesLoaded();

    await user.type(daysBox(), "{Control>}a{/Control}14");
    await user.selectOptions(countedBox(), "after");

    expect(hintUnder(countedBox())).toHaveTextContent("14 days after expiry");
    await user.type(nameBox(), "Chase a lapsed policy");
    await user.selectOptions(messageBox(), "3");
    await user.click(saveButton());

    await waitFor(() => {
      expect(backend().lastCall("create_rule")?.input).toMatchObject({ offsetDays: -14 });
    });
  });

  it("keeps the side of expiry when the days are changed again", async () => {
    const { user } = open();

    await user.selectOptions(countedBox(), "after");
    await user.type(daysBox(), "{Control>}a{/Control}3");

    expect(daysBox()).toHaveValue(3);
    expect(countedBox()).toHaveValue("after");
    expect(hintUnder(countedBox())).toHaveTextContent("3 days after expiry");
  });

  it("calls the day of expiry itself by name", async () => {
    const { user } = open();

    await user.type(daysBox(), "{Control>}a{/Control}0");

    expect(hintUnder(countedBox())).toHaveTextContent("On the expiry date");
  });

  it("narrows a rule to one kind of cover", async () => {
    const { user } = open();
    await messagesLoaded();

    await user.type(nameBox(), "Motor only");
    await user.selectOptions(appliesBox(), "motor");
    await user.selectOptions(messageBox(), "2");
    await user.click(saveButton());

    await waitFor(() => {
      expect(backend().lastCall("create_rule")?.input).toMatchObject({ category: "motor" });
    });
  });

  it("sends a rule to me on this computer instead of to the client", async () => {
    const { user } = open();

    await user.type(nameBox(), "Tell me first");
    await user.selectOptions(goesToBox(), "provider");
    await user.selectOptions(howBox(), "desktop");
    await user.click(saveButton());

    await waitFor(() => {
      expect(backend().lastCall("create_rule")?.input).toMatchObject({
        audience: "provider",
        channel: "desktop",
      });
    });
  });

  it("can be added switched off", async () => {
    const { user } = open();
    await messagesLoaded();

    await user.type(nameBox(), "Not yet");
    await user.selectOptions(messageBox(), "2");
    await user.click(activeBox());
    expect(activeBox()).not.toBeChecked();
    await user.click(saveButton());

    await waitFor(() => {
      expect(backend().lastCall("create_rule")?.input).toMatchObject({ isActive: false });
    });
  });

  it("gives a new rule a place at the end of the ladder", async () => {
    const { user } = open();
    await messagesLoaded();

    await user.type(nameBox(), "Somewhere sensible");
    await user.selectOptions(messageBox(), "2");
    await user.click(saveButton());

    await waitFor(() => expect(backend().countOf("create_rule")).toBe(1));
    // Leaving it out is fine too: the core appends when nothing is given.
    const input = backend().lastCall("create_rule")?.input as { sortOrder?: number };
    expect(input.sortOrder ?? Number.MAX_SAFE_INTEGER).toBeGreaterThan(
      Math.max(...backend().book.rules.map((rule) => rule.sortOrder)),
    );
  });

  it("holds the days inside the year the box allows", async () => {
    const { user } = open();
    await messagesLoaded();

    await user.type(nameBox(), "Too far ahead");
    await user.selectOptions(messageBox(), "2");
    await user.type(daysBox(), "{Control>}a{/Control}400");
    expect(daysBox()).toHaveValue(400);
    await user.click(saveButton());

    await waitFor(() => expect(backend().countOf("create_rule")).toBe(1));
    expect(backend().lastCall("create_rule")?.input).toMatchObject({ offsetDays: 365 });
  });

  it("repeats what the core says about a blank name", async () => {
    const { user, onClose } = open();
    await messagesLoaded();

    // The name is the only thing missing: the message is chosen, so the form
    // has nothing of its own to say and the core is the one refusing.
    await user.selectOptions(messageBox(), "2");
    await user.click(saveButton());

    expect(await screen.findByText("Rule name is required")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("will not save a client rule with no message chosen", async () => {
    const { user, onClose } = open();

    await user.type(nameBox(), "No message");
    await user.click(saveButton());

    expect(backend().countOf("create_rule")).toBe(0);
    expect(onClose).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Choose the message this rule sends to the client"),
    ).toBeInTheDocument();
  });

  it("stays open when the core refuses the rule", async () => {
    backend().fail("create_rule", { kind: "conflict", message: "A rule already covers that day" });
    const { user, onClose } = open();
    await messagesLoaded();

    await user.type(nameBox(), "Duplicate");
    await user.selectOptions(messageBox(), "2");
    await user.click(saveButton());

    expect(await screen.findByText("A rule already covers that day")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the save working while the core is writing", async () => {
    const gate = backend().hold("create_rule");
    const { user, onClose } = open();
    await messagesLoaded();

    await user.type(nameBox(), "Slow one");
    await user.selectOptions(messageBox(), "2");
    await user.click(saveButton());

    await waitFor(() => expect(saveButton()).toBeDisabled());
    gate.release();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("closes without writing anything when cancelled", async () => {
    const { user, onClose } = open();

    await user.type(nameBox(), "Never mind");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
    expect(backend().countOf("create_rule")).toBe(0);
  });

  it("closes on Escape", async () => {
    const { user, onClose } = open();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });
});

describe("an existing rule", () => {
  it("fills the form in from the rule", async () => {
    open(ruleNamed("7 days before expiry"));
    await messagesLoaded();

    expect(screen.getByRole("heading", { name: "7 days before expiry" })).toBeInTheDocument();
    expect(nameBox()).toHaveValue("7 days before expiry");
    expect(daysBox()).toHaveValue(7);
    expect(countedBox()).toHaveValue("before");
    expect(howBox()).toHaveValue("both");
    expect(messageBox()).toHaveValue("2");
    expect(activeBox()).toBeChecked();
  });

  it("reads a negative offset as days after expiry", async () => {
    open(ruleNamed("7 days after expiry"));

    expect(daysBox()).toHaveValue(7);
    expect(countedBox()).toHaveValue("after");
    expect(hintUnder(countedBox())).toHaveTextContent("7 days after expiry");
    expect(activeBox()).not.toBeChecked();
  });

  it("sends the whole rule to update_rule, not only what changed", async () => {
    const rule = ruleNamed("15 days before expiry");
    const { user, onClose } = open(rule);
    await messagesLoaded();

    await user.type(nameBox(), "{Control>}a{/Control}A fortnight before expiry");
    await user.click(saveButton());

    await waitFor(() => {
      expect(backend().lastCall("update_rule")).toEqual({
        id: rule.id,
        input: {
          name: "A fortnight before expiry",
          offsetDays: 15,
          category: null,
          audience: "client",
          channel: "email",
          templateId: 1,
          isActive: true,
          sortOrder: 3,
        },
      });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("switches a rule off from the form", async () => {
    const rule = ruleNamed("1 day before expiry");
    const { user } = open(rule);

    await user.click(activeBox());
    await user.click(saveButton());

    await waitFor(() => {
      expect(backend().lastCall("update_rule")?.input).toMatchObject({ isActive: false });
    });
    expect(backend().book.rules.find((row) => row.id === rule.id)?.isActive).toBe(false);
  });

  it("changes which message a rule sends", async () => {
    const rule = ruleNamed("60 days before expiry");
    const { user } = open(rule);
    await messagesLoaded();

    await user.selectOptions(messageBox(), "3");
    await user.click(saveButton());

    await waitFor(() => {
      expect(backend().lastCall("update_rule")?.input).toMatchObject({ templateId: 3 });
    });
  });

  it("says what went wrong when the rule has gone", async () => {
    backend().fail("update_rule", { kind: "not_found", message: "That rule was not found" });
    const { user, onClose } = open(ruleNamed("30 days before expiry"));

    await user.click(saveButton());

    expect(await screen.findByText("That rule was not found")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
