/**
 * The reminders desk: the day's figures, the setup warnings, running a sweep,
 * the ladder of rules, the messages they send and the log of what went out.
 */

import { describe, expect, it, vi } from "vitest";

import {
  backend,
  emitTauriEvent,
  isoDaysFromToday,
  listenerCount,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from "@/test";
import { RemindersPage } from "@/pages/Reminders";
import type { Notification, ReminderOverview, ReminderRun } from "@/lib/types";

function show() {
  return renderWithProviders(<RemindersPage />);
}

/** Waits for the screen to have read the day's figures. */
const loaded = () => screen.findByRole("heading", { name: "Reminders" });

/** One of the four tiles above the tabs, found by its label. */
function figure(label: string): HTMLElement {
  const tile = screen
    .getAllByText(label)
    .map((node) => node.closest<HTMLElement>("div.card"))
    .find((node): node is HTMLElement => node != null);
  if (!tile) throw new Error(`No figure labelled "${label}"`);
  return tile;
}

const tab = (name: string) => screen.getByRole("button", { name });

/** The row of a table that carries a piece of text. A rule names its timing
 * twice, so the first match is the one that matters. */
const rowWith = (text: string) => screen.getAllByText(text)[0].closest("tr")!;

const rows = () => screen.getAllByRole("row").slice(1);

/** A rule that writes to a client is refused without a message, so the form
 * waits for the list to arrive and picks one. */
async function chooseMessage(user: ReturnType<typeof show>["user"]) {
  await screen.findByRole("option", { name: "Final expiry notice" });
  await user.selectOptions(screen.getByLabelText(/^Message/), "2");
}

/** The overview the book would give, with a detail or two changed. */
async function overviewWith(patch: Partial<ReminderOverview>) {
  const base = await backend().invoke<ReminderOverview>("reminder_overview");
  backend().clearCalls();
  backend().on("reminder_overview", () => ({ ...base, ...patch }));
}

/** A run that reports exactly what a test wants to see reported. */
const runResult = (patch: Partial<ReminderRun>): ReminderRun => ({
  dryRun: false,
  queued: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
  heldByCap: 0,
  desktopAlerts: 0,
  digestSent: false,
  issues: [],
  ...patch,
});

/** Turns the lapsed policy of the client with no email into a live one. */
function policyWithNoEmailComingUp() {
  const policy = backend().book.policies.find((row) => row.id === 12)!;
  policy.status = "active";
  policy.expiryDate = isoDaysFromToday(30);
}

describe("the day at a glance", () => {
  it("counts what is due, waiting, sent and failed", async () => {
    show();
    await loaded();

    expect(within(figure("Due today")).getByText("2")).toBeInTheDocument();
    expect(within(figure("Waiting to send")).getByText("1")).toBeInTheDocument();
    expect(within(figure("Sent today")).getByText("3")).toBeInTheDocument();
    expect(within(figure("Failed")).getByText("1")).toBeInTheDocument();
    expect(figure("Sent today")).toHaveTextContent("Cap of 400 a day");
  });

  it("says when the daily run goes out and when it last ran", async () => {
    show();

    const summary = (await loaded()).parentElement!;
    expect(summary).toHaveTextContent("Sending automatically at 09:00 each day.");
    expect(summary).toHaveTextContent("Last run 14 Aug 2026.");
  });

  it("says so when automatic sending is switched off", async () => {
    backend().book.settings.reminders_enabled = "false";
    show();

    const summary = (await loaded()).parentElement!;
    expect(summary).toHaveTextContent(
      "Automatic sending is off. You can still send today's batch by hand.",
    );
  });

  it("shows a fresh cap and send time from the settings", async () => {
    backend().book.settings.reminder_send_time = "18:45";
    backend().book.settings.daily_send_cap = "1200";
    show();

    const summary = (await loaded()).parentElement!;
    expect(summary).toHaveTextContent("Sending automatically at 18:45 each day.");
    expect(figure("Sent today")).toHaveTextContent("Cap of 1,200 a day");
  });

  it("says whether the daily digest and desktop alerts are on", async () => {
    show();
    await loaded();

    expect(screen.getByText(/digest/i)).toBeInTheDocument();
    expect(screen.getByText(/desktop/i)).toBeInTheDocument();
  });
});

describe("the setup warnings", () => {
  it("warns that nothing can be sent without a mail server, and refuses to send", async () => {
    backend().book.settings.smtp_host = "";
    show();
    await loaded();

    expect(
      screen.getByText("No mail server is set up yet, so nothing can be sent. Add it under Settings."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send now" })).toBeDisabled();
  });

  it("warns when the mail password has not been saved", async () => {
    await overviewWith({ smtpPasswordSet: false });
    show();
    await loaded();

    expect(
      screen.getByText(
        "The mail password is not saved, so sending will be refused. Add it under Settings.",
      ),
    ).toBeInTheDocument();
  });

  it("explains practice mode while it is on", async () => {
    backend().book.settings.dry_run = "true";
    show();
    await loaded();

    expect(screen.getByText(/Practice mode is on/)).toBeInTheDocument();
  });

  it("counts the clients who will never be written to", async () => {
    show();
    await loaded();

    expect(
      screen.getByText("One client has opted out and will never be written to."),
    ).toBeInTheDocument();
  });

  it("counts them in the plural when there are more", async () => {
    backend().book.clients[0].remindersOptedOut = true;
    show();
    await loaded();

    expect(
      screen.getByText("2 clients have opted out and will never be written to."),
    ).toBeInTheDocument();
  });

  it("warns about cover expiring for a client with no email", async () => {
    policyWithNoEmailComingUp();
    show();
    await loaded();

    expect(
      screen.getByText(
        "One policy expiring soon belongs to a client with no email address, so it will be listed as skipped.",
      ),
    ).toBeInTheDocument();
  });

  it("sends every warning to the settings screen", async () => {
    show();
    await loaded();

    expect(screen.getAllByRole("link", { name: "Settings" })[0]).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it("says nothing at all when there is nothing to warn about", async () => {
    for (const client of backend().book.clients) client.remindersOptedOut = false;
    show();
    await loaded();

    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
  });
});

describe("running a sweep", () => {
  it("tries the run without sending anything", async () => {
    backend().on("run_reminders", (args) =>
      runResult({ dryRun: args.dryRun === true, queued: 9, skipped: 2 }),
    );
    const { user } = show();
    await loaded();

    await user.click(screen.getByRole("button", { name: "Try without sending" }));

    await waitFor(() => expect(backend().lastCall("run_reminders")).toEqual({ dryRun: true }));
    expect(
      await screen.findByText("9 would go out, 2 would be skipped. Nothing was sent."),
    ).toBeInTheDocument();
  });

  it("asks before sending for real, and sends what the ladder found", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    backend().on("run_reminders", (args) =>
      runResult({ dryRun: args.dryRun === true, sent: 4, queued: 1, failed: 2 }),
    );
    const { user } = show();
    await loaded();

    await user.click(screen.getByRole("button", { name: "Send now" }));

    expect(confirm).toHaveBeenCalledWith("Send today's reminders to 2 clients now?");
    await waitFor(() => expect(backend().lastCall("run_reminders")).toEqual({ dryRun: false }));
    expect(await screen.findByText("4 sent, 1 queued, 2 failed.")).toBeInTheDocument();
  });

  it("sends nothing when the question is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user } = show();
    await loaded();

    await user.click(screen.getByRole("button", { name: "Send now" }));

    expect(backend().countOf("run_reminders")).toBe(0);
  });

  it("reads the figures and the day's list again after a run", async () => {
    const { user } = show();
    await loaded();
    await screen.findByText("Rohit Sharma");
    backend().clearCalls();

    await user.click(screen.getByRole("button", { name: "Try without sending" }));

    await waitFor(() => expect(backend().countOf("reminder_overview")).toBe(1));
    await waitFor(() => expect(backend().countOf("plan_reminders")).toBe(1));
  });

  it("passes on the first thing the run tripped over", async () => {
    backend().on("run_reminders", () =>
      runResult({ dryRun: true, issues: ["Star Health refused two addresses"] }),
    );
    const { user } = show();
    await loaded();

    await user.click(screen.getByRole("button", { name: "Try without sending" }));

    expect(await screen.findByText("Star Health refused two addresses")).toBeInTheDocument();
  });

  it("says what went wrong when the run itself fails", async () => {
    backend().fail("run_reminders", { kind: "mail", message: "The mail server would not answer" });
    const { user } = show();
    await loaded();

    await user.click(screen.getByRole("button", { name: "Try without sending" }));

    expect(await screen.findByText("The mail server would not answer")).toBeInTheDocument();
  });

  it("shows the run working while it is going", async () => {
    const gate = backend().hold("run_reminders");
    const { user } = show();
    await loaded();

    await user.click(screen.getByRole("button", { name: "Try without sending" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Try without sending" })).toBeDisabled(),
    );
    gate.release();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Try without sending" })).toBeEnabled(),
    );
  });
});

describe("what is due today", () => {
  it("lists every reminder the ladder has found for today", async () => {
    show();
    await loaded();
    await screen.findByText("Rohit Sharma");

    const rohit = rowWith("Rohit Sharma");
    expect(rohit).toHaveTextContent("rohit.sharma@example.com");
    expect(rohit).toHaveTextContent("SH/2025/0091823");
    expect(rohit).toHaveTextContent("Expires 21 Aug 2026 · in 7 days");
    expect(rohit).toHaveTextContent("7 days before expiry");
    expect(rohit).toHaveTextContent("Your Health policy expires on 21 Aug 2026");
    expect(within(rohit).getByText("Ready")).toBeInTheDocument();

    expect(rowWith("Meera Iyer")).toHaveTextContent("15 days before expiry");
    expect(rows()).toHaveLength(2);
  });

  it("says why a reminder cannot go out", async () => {
    policyWithNoEmailComingUp();
    show();
    await loaded();
    await screen.findByText("Vikram Patel");

    const blocked = rowWith("Vikram Patel");
    expect(blocked).toHaveTextContent("No email");
    expect(within(blocked).getByText("No email address on the client")).toBeInTheDocument();
    expect(within(blocked).queryByText("Ready")).not.toBeInTheDocument();
  });

  it("links a planned reminder to the client it is for", async () => {
    show();
    await loaded();

    expect(await screen.findByRole("link", { name: "Rohit Sharma" })).toHaveAttribute("href", "/clients/1");
  });

  it("says nothing is due when no rule matches today", async () => {
    for (const rule of backend().book.rules) rule.isActive = false;
    show();
    await loaded();

    expect(await screen.findByText("Nothing is due today")).toBeInTheDocument();
    expect(within(figure("Due today")).getByText("0")).toBeInTheDocument();
  });

  it("says it is working the plan out while it waits", async () => {
    const gate = backend().hold("plan_reminders");
    show();
    await loaded();

    expect(await screen.findByText("Working out what is due")).toBeInTheDocument();
    gate.release();
    expect(await screen.findByText("Rohit Sharma")).toBeInTheDocument();
  });

  it("says so when the day's plan cannot be worked out", async () => {
    backend().fail("plan_reminders", { kind: "internal", message: "The book would not open" });
    show();
    await loaded();

    expect(await screen.findByText("The book would not open")).toBeInTheDocument();
    expect(screen.queryByText("Nothing is due today")).not.toBeInTheDocument();
  });
});

describe("the ladder of rules", () => {
  const openRules = async (user: ReturnType<typeof show>["user"]) => {
    await loaded();
    await user.click(tab("Rules"));
    await screen.findByText("When reminders go out");
  };

  it("lists the rules in the order they fire", async () => {
    const { user } = show();
    await openRules(user);

    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining("60 days before expiry"),
      expect.stringContaining("30 days before expiry"),
      expect.stringContaining("15 days before expiry"),
      expect.stringContaining("7 days before expiry"),
      expect.stringContaining("1 day before expiry"),
      expect.stringContaining("7 days after expiry"),
    ]);
  });

  it("describes what each rule does", async () => {
    const { user } = show();
    await openRules(user);

    const rule = rowWith("7 days before expiry");
    expect(rule).toHaveTextContent("All policy types");
    expect(rule).toHaveTextContent("Final expiry notice");
    expect(rule).toHaveTextContent("Client · email and desktop");
    expect(within(rule).getByText("On")).toBeInTheDocument();
    expect(within(rowWith("7 days after expiry")).getByText("Off")).toBeInTheDocument();
  });

  it("switches a rule off from the ladder", async () => {
    const { user } = show();
    await openRules(user);

    await user.click(within(rowWith("1 day before expiry")).getByTitle("Turn this rule on or off"));

    await waitFor(() => {
      expect(backend().lastCall("update_rule")).toEqual({
        id: 5,
        input: {
          name: "1 day before expiry",
          offsetDays: 1,
          category: null,
          audience: "client",
          channel: "both",
          templateId: 2,
          isActive: false,
          sortOrder: 5,
        },
      });
    });
    expect(await within(rowWith("1 day before expiry")).findByText("Off")).toBeInTheDocument();
  });

  it("switches a rule back on", async () => {
    const { user } = show();
    await openRules(user);

    await user.click(within(rowWith("7 days after expiry")).getByTitle("Turn this rule on or off"));

    expect(await within(rowWith("7 days after expiry")).findByText("On")).toBeInTheDocument();
    await waitFor(() => expect(within(figure("Due today")).getByText("2")).toBeInTheDocument());
  });

  it("says what went wrong when a rule will not turn off", async () => {
    backend().fail("update_rule", { kind: "internal", message: "The rule would not save" });
    const { user } = show();
    await openRules(user);

    await user.click(within(rowWith("60 days before expiry")).getByTitle("Turn this rule on or off"));

    expect(await screen.findByText("The rule would not save")).toBeInTheDocument();
    expect(within(rowWith("60 days before expiry")).getByText("On")).toBeInTheDocument();
  });

  it("removes a rule after asking first", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = show();
    await openRules(user);

    await user.click(within(rowWith("60 days before expiry")).getByRole("button", { name: "Remove" }));

    expect(confirm).toHaveBeenCalledWith(
      'Remove "60 days before expiry"? History of what it sent is kept.',
    );
    await waitFor(() => expect(backend().lastCall("delete_rule")).toEqual({ id: 1 }));
    expect(await screen.findByText("Rule removed")).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(5));
  });

  it("keeps the rule when the question is dismissed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { user } = show();
    await openRules(user);

    await user.click(within(rowWith("60 days before expiry")).getByRole("button", { name: "Remove" }));

    expect(backend().countOf("delete_rule")).toBe(0);
    expect(rows()).toHaveLength(6);
  });

  it("says what went wrong when a rule cannot be removed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    backend().fail("delete_rule", { kind: "conflict", message: "That rule is still in use" });
    const { user } = show();
    await openRules(user);

    await user.click(within(rowWith("30 days before expiry")).getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("That rule is still in use")).toBeInTheDocument();
    expect(rows()).toHaveLength(6);
  });

  it("adds a rule through the form and lists it", async () => {
    const { user } = show();
    await openRules(user);

    await user.click(screen.getByRole("button", { name: "Add rule" }));
    await user.type(screen.getByPlaceholderText("30 days before expiry"), "90 days before expiry");
    await chooseMessage(user);
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    expect(await screen.findByText("Rule saved")).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(7));
    expect(rowWith("90 days before expiry")).toBeInTheDocument();
  });

  it("adds a new rule at the bottom of the ladder", async () => {
    const { user } = show();
    await openRules(user);

    // The ladder reads by timing, so a rule that fires last has to be written
    // last as well for this to mean anything: it is later than every seeded
    // rule, and the form leaves its place to the core.
    await user.click(screen.getByRole("button", { name: "Add rule" }));
    await user.type(screen.getByPlaceholderText("30 days before expiry"), "10 days after expiry");
    await user.type(screen.getByRole("spinbutton"), "{Control>}a{/Control}10");
    await user.selectOptions(screen.getByLabelText(/^Counted/), "after");
    await chooseMessage(user);
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(rows()).toHaveLength(7));
    expect(rows().at(-1)).toHaveTextContent("10 days after expiry");
  });

  it("opens a rule for editing with its details filled in", async () => {
    const { user } = show();
    await openRules(user);

    await user.click(within(rowWith("7 days before expiry")).getByRole("button", { name: "Edit" }));

    const form = await screen.findByRole("dialog");
    expect(within(form).getByRole("heading", { name: "7 days before expiry" })).toBeInTheDocument();
    expect(within(form).getByRole("spinbutton")).toHaveValue(7);

    await user.type(
      screen.getByPlaceholderText("30 days before expiry"),
      "{Control>}a{/Control}A week before expiry",
    );
    await user.click(screen.getByRole("button", { name: "Save rule" }));

    await waitFor(() => expect(backend().lastCall("update_rule")?.id).toBe(4));
    expect(await screen.findByText("A week before expiry")).toBeInTheDocument();
  });

  it("says it is reading the rules while it waits", async () => {
    const gate = backend().hold("list_rules");
    const { user } = show();
    await loaded();
    await user.click(tab("Rules"));

    expect(await screen.findByText("Loading")).toBeInTheDocument();
    gate.release();
    expect(await screen.findAllByText("60 days before expiry")).not.toHaveLength(0);
  });

  it("says so when the rules cannot be read", async () => {
    backend().fail("list_rules", { kind: "internal", message: "The book would not open" });
    const { user } = show();
    await loaded();
    await user.click(tab("Rules"));

    expect(await screen.findByText("The book would not open")).toBeInTheDocument();
    expect(
      screen.queryByText("No rules yet. Add one to start reminding clients."),
    ).not.toBeInTheDocument();
  });

  it("stops offering today's reminder once its rule is switched off", async () => {
    const { user } = show();
    await loaded();
    await screen.findByText("Rohit Sharma");

    await user.click(tab("Rules"));
    await screen.findByText("When reminders go out");
    await user.click(within(rowWith("7 days before expiry")).getByTitle("Turn this rule on or off"));
    await within(rowWith("7 days before expiry")).findByText("Off");

    await user.click(tab("Due today"));
    await waitFor(() => expect(screen.queryByText("Rohit Sharma")).not.toBeInTheDocument());
  });

  it("counts the day again once a rule is removed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = show();
    await openRules(user);

    await user.click(within(rowWith("7 days before expiry")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(rows()).toHaveLength(5));

    await waitFor(() => expect(within(figure("Due today")).getByText("1")).toBeInTheDocument());
  });
});

describe("the messages the rules send", () => {
  const openMessages = async (user: ReturnType<typeof show>["user"]) => {
    await loaded();
    await user.click(tab("Messages"));
    await screen.findByText("What the messages say");
  };

  it("lists every message with its subject line", async () => {
    const { user } = show();
    await openMessages(user);

    const template = rowWith("Policy expiry reminder");
    expect(template).toHaveTextContent("Your {{category_label}} policy expires on {{expiry_date}}");
    expect(template).toHaveTextContent("3 rules");
    expect(rowWith("Renewal confirmation")).toHaveTextContent("—");
    expect(rows()).toHaveLength(5);
  });

  it("counts a single rule in the singular", async () => {
    const { user } = show();
    await openMessages(user);

    expect(rowWith("Lapsed policy follow up")).toHaveTextContent("1 rule");
    expect(rowWith("Lapsed policy follow up")).not.toHaveTextContent("1 rules");
  });

  it("removes a message nothing is using, after asking", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = show();
    await openMessages(user);

    await user.click(within(rowWith("Renewal confirmation")).getByRole("button", { name: "Remove" }));

    expect(confirm).toHaveBeenCalledWith('Remove "Renewal confirmation"?');
    await waitFor(() => expect(backend().lastCall("delete_template")).toEqual({ id: 4 }));
    expect(await screen.findByText("Message removed")).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(4));
  });

  it("refuses to remove a message a rule is still using", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user } = show();
    await openMessages(user);

    await user.click(
      within(rowWith("Policy expiry reminder")).getByRole("button", { name: "Remove" }),
    );

    expect(
      await screen.findByText("This template is used by a rule, so it cannot be deleted"),
    ).toBeInTheDocument();
    expect(rows()).toHaveLength(5);
  });

  it("opens a message for editing and saves the wording", async () => {
    const { user } = show();
    await openMessages(user);

    await user.click(within(rowWith("Final expiry notice")).getByRole("button", { name: "Edit" }));
    const editor = await screen.findByRole("dialog");
    expect(within(editor).getByLabelText(/^Name/)).toHaveValue("Final expiry notice");

    await user.type(within(editor).getByLabelText(/^Name/), "{Control>}a{/Control}Last call");
    await user.click(screen.getByRole("button", { name: "Save message" }));

    await waitFor(() => expect(backend().lastCall("update_template")?.id).toBe(2));
    expect(await screen.findByText("Last call")).toBeInTheDocument();
  });

  it("writes a new message from the tab", async () => {
    const { user } = show();
    await openMessages(user);

    await user.click(screen.getByRole("button", { name: "New message" }));
    const editor = await screen.findByRole("dialog");
    await user.type(within(editor).getByLabelText(/^Name/), "Welcome aboard");
    await user.type(within(editor).getByLabelText(/^Subject/), "Welcome to the book");
    await user.click(screen.getByRole("button", { name: "Save message" }));

    await waitFor(() => expect(rows()).toHaveLength(6));
    expect(rowWith("Welcome aboard")).toBeInTheDocument();
  });
});

describe("the log of what has gone out", () => {
  const openLog = async (user: ReturnType<typeof show>["user"]) => {
    await loaded();
    await user.click(tab("History"));
    await screen.findByText("Everything that has gone out");
  };

  it("lists the messages newest first", async () => {
    const { user } = show();
    await openLog(user);

    const text = rows().map((row) => row.textContent ?? "");
    expect(text.slice(0, 2).join(" ")).toContain("SH/2025/0112947");
    expect(text.slice(0, 2).join(" ")).toContain("BA/MOT/641203");
    expect(text[2]).toContain("IL/MOT/815540");
    expect(text[3]).toContain("HE/PAS/700318");
    expect(text[4]).toContain("NIA/MOT/330912");
    expect(text[5]).toContain("SH/2024/0088410");
  });

  it("shows who each message went to, and how it ended", async () => {
    const { user } = show();
    await openLog(user);

    const failed = rowWith("3 tries");
    expect(failed).toHaveTextContent("Vikram Patel");
    expect(failed).toHaveTextContent("Your Health policy expires on 29 Jul 2026");
    expect(failed).toHaveTextContent("30 days before expiry · SH/2024/0088410");
    expect(within(failed).getByText("failed")).toBeInTheDocument();
  });

  it("filters the log by status", async () => {
    const { user } = show();
    await openLog(user);

    await user.selectOptions(screen.getByRole("combobox"), "sent");

    await waitFor(() =>
      expect(backend().lastCall("list_notifications")?.filter).toEqual({
        statuses: ["sent"],
        page: 1,
        pageSize: 25,
      }),
    );
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(screen.queryByText("failed")).not.toBeInTheDocument();
  });

  it("pages through a long log", async () => {
    const first = backend().book.notifications[0];
    for (let index = 0; index < 30; index += 1) {
      backend().book.notifications.push({
        ...first,
        id: 200 + index,
        status: "sent",
        scheduledFor: `2026-05-${String((index % 28) + 1).padStart(2, "0")}`,
      } as Notification);
    }
    const { user } = show();
    await openLog(user);

    expect(screen.getByText("1–25 of 36")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() =>
      expect(backend().lastCall("list_notifications")?.filter).toMatchObject({ page: 2 }),
    );
    expect(await screen.findByText("26–36 of 36")).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(11));
  });

  it("goes back to the first page when the filter changes", async () => {
    const first = backend().book.notifications[0];
    for (let index = 0; index < 30; index += 1) {
      backend().book.notifications.push({ ...first, id: 300 + index, status: "sent" } as Notification);
    }
    const { user } = show();
    await openLog(user);

    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 2");
    await user.selectOptions(screen.getByRole("combobox"), "queued");

    await waitFor(() =>
      expect(backend().lastCall("list_notifications")?.filter).toEqual({
        statuses: ["queued"],
        page: 1,
        pageSize: 25,
      }),
    );
    expect(await screen.findByText("Page 1 of 1")).toBeInTheDocument();
  });

  it("puts a failed message back in the queue", async () => {
    const { user } = show();
    await openLog(user);

    await user.click(within(rowWith("3 tries")).getByRole("button", { name: "Send again" }));

    await waitFor(() => expect(backend().lastCall("retry_notification")).toEqual({ id: 37 }));
    expect(await screen.findByText("Back in the queue for the next run")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("queued")).toHaveLength(2));
    expect(screen.queryByText("failed")).not.toBeInTheDocument();
  });

  it("offers to send a skipped message again", async () => {
    const { user } = show();
    await openLog(user);

    const skipped = rowWith("Your Motor policy expires on 9 Aug 2026");
    await user.click(within(skipped).getByRole("button", { name: "Send again" }));

    await waitFor(() => expect(backend().lastCall("retry_notification")).toEqual({ id: 38 }));
  });

  it("cancels a message that is still waiting", async () => {
    const { user } = show();
    await openLog(user);

    const queued = rowWith("Your Motor policy expires on 1 Nov 2026");
    await user.click(within(queued).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(backend().lastCall("cancel_notification")).toEqual({ id: 36 }));
    expect(await screen.findByText("Cancelled", { selector: "span" })).toBeInTheDocument();
    expect(await screen.findByText("cancelled")).toBeInTheDocument();
  });

  it("offers nothing to do to a message that has already gone", async () => {
    const { user } = show();
    await openLog(user);

    const sent = rowWith("Your Personal Accident policy expires on 11 Oct 2026");
    expect(within(sent).queryByRole("button", { name: "Send again" })).not.toBeInTheDocument();
    expect(within(sent).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("says what went wrong when a retry is refused", async () => {
    backend().fail("retry_notification", { kind: "not_found", message: "That message was not found" });
    const { user } = show();
    await openLog(user);

    await user.click(within(rowWith("3 tries")).getByRole("button", { name: "Send again" }));

    expect(await screen.findByText("That message was not found")).toBeInTheDocument();
  });

  it("opens a message to read why it failed", async () => {
    const { user } = show();
    await openLog(user);

    await user.click(within(rowWith("3 tries")).getByRole("button", { name: "View" }));

    const reading = await screen.findByRole("dialog");
    expect(within(reading).getByText("— · failed")).toBeInTheDocument();
    expect(within(reading).getByText("30 days before expiry")).toBeInTheDocument();
    expect(within(reading).getByText("SH/2024/0088410")).toBeInTheDocument();
    expect(within(reading).getByText("29 Jun 2026")).toBeInTheDocument();
    expect(within(reading).getByText("Not yet")).toBeInTheDocument();
    expect(
      within(reading).getByText("The server rejected the username or password."),
    ).toBeInTheDocument();

    await user.click(within(reading).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("says nothing has gone out yet when the log is empty", async () => {
    backend().book.notifications = [];
    const { user } = show();
    await openLog(user);

    expect(screen.getByText("Nothing has been sent yet.")).toBeInTheDocument();
    expect(screen.getByText("0–0 of 0")).toBeInTheDocument();
  });

  it("says it is reading the log while it waits", async () => {
    const gate = backend().hold("list_notifications");
    const { user } = show();
    await loaded();
    await user.click(tab("History"));

    expect(await screen.findByText("Loading")).toBeInTheDocument();
    gate.release();
    expect(await screen.findAllByText("Vikram Patel")).not.toHaveLength(0);
  });

  it("says so when the log cannot be read", async () => {
    backend().fail("list_notifications", { kind: "internal", message: "The book would not open" });
    const { user } = show();
    await loaded();
    await user.click(tab("History"));

    expect(await screen.findByText("The book would not open")).toBeInTheDocument();
    expect(screen.queryByText("Nothing has been sent yet.")).not.toBeInTheDocument();
  });

  it("finds one client's messages by name", async () => {
    const { user } = show();
    await openLog(user);

    await user.type(screen.getByPlaceholderText(/Search/), "Vikram");

    await waitFor(() =>
      expect(backend().lastCall("list_notifications")?.filter).toMatchObject({ search: "Vikram" }),
    );
  });

  it("sorts the log by when each message was sent", async () => {
    const { user } = show();
    await openLog(user);
    backend().clearCalls();

    await user.click(screen.getByText("When"));

    await waitFor(() =>
      expect(backend().lastCall("list_notifications")?.filter).toMatchObject({
        sort: "scheduledFor",
      }),
    );
  });
});

describe("a sweep that runs while the screen is open", () => {
  it("listens for the sweep and reads everything again", async () => {
    show();
    await loaded();
    await waitFor(() => expect(listenerCount("reminders:swept")).toBe(1));
    backend().clearCalls();

    backend().book.notifications.push({
      ...backend().book.notifications[0],
      id: 99,
      status: "queued",
    } as Notification);
    emitTauriEvent("reminders:swept", { sent: 1 });

    await waitFor(() => expect(within(figure("Waiting to send")).getByText("2")).toBeInTheDocument());
    expect(backend().countOf("plan_reminders")).toBe(1);
  });

  it("stops listening once the screen is closed", async () => {
    const { unmount } = show();
    await loaded();
    await waitFor(() => expect(listenerCount("reminders:swept")).toBe(1));

    unmount();

    await waitFor(() => expect(listenerCount("reminders:swept")).toBe(0));
  });
});

describe("when the day's figures cannot be read", () => {
  it("says it is loading while it waits", async () => {
    const gate = backend().hold("reminder_overview");
    show();

    expect(await screen.findByText("Loading reminders")).toBeInTheDocument();
    gate.release();
    await loaded();
  });

  it("says what went wrong instead of drawing nothing", async () => {
    backend().fail("reminder_overview", { kind: "internal", message: "The book would not open" });
    show();

    expect(await screen.findByText("The book would not open")).toBeInTheDocument();
  });

  it("says so when the messages cannot be read", async () => {
    backend().fail("list_templates", { kind: "internal", message: "The book would not open" });
    const { user } = show();
    await loaded();
    await user.click(tab("Messages"));

    expect(await screen.findByText("The book would not open")).toBeInTheDocument();
  });
});
