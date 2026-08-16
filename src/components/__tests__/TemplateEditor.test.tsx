/**
 * Writing a message: the fields, the placeholders, the live preview and what
 * reaches the core when it is saved.
 */

import { describe, expect, it, vi } from "vitest";

import { backend, renderWithProviders, screen, waitFor, within } from "@/test";
import { TemplateEditor } from "@/components/TemplateEditor";
import type { EmailTemplate } from "@/lib/types";

const templateNamed = (name: string): EmailTemplate =>
  backend().book.templates.find((template) => template.name === name)!;

function open(template: EmailTemplate | "new" = "new") {
  const onClose = vi.fn();
  const rendered = renderWithProviders(<TemplateEditor template={template} onClose={onClose} />);
  return { ...rendered, onClose };
}

const nameBox = () => screen.getByLabelText(/^Name/);
const usedForBox = () => screen.getByLabelText(/^Used for/);
const subjectBox = () => screen.getByLabelText(/^Subject/) as HTMLInputElement;
const bodyBox = () => screen.getByLabelText(/^Message/) as HTMLTextAreaElement;
const saveButton = () => screen.getByRole("button", { name: "Save message" });

/** user-event reads a lone "{" as a key name, so a placeholder has to be doubled. */
const typed = (text: string) => text.replace(/\{/g, "{{");

/** The preview is debounced, so wait for the core to answer before reading it. */
const previewed = () => screen.findByText(/Dear/, { selector: "p" }, { timeout: 3000 });

describe("a new message", () => {
  it("starts from a blank message with the greeting already written", async () => {
    open();

    expect(screen.getByRole("heading", { name: "New message" })).toBeInTheDocument();
    expect(nameBox()).toHaveValue("");
    expect(usedForBox()).toHaveValue("expiry_reminder");
    expect(subjectBox()).toHaveValue("");
    expect(bodyBox().value).toContain("Dear {{client_name}}");
    expect(bodyBox().value).toContain("{{provider_name}}");
  });

  it("explains what each trigger is for", async () => {
    const { user } = open();

    expect(usedForBox().closest("label")).toHaveTextContent(
      "Sent by the rules that count down to the expiry date",
    );
    await user.selectOptions(usedForBox(), "provider_digest");
    expect(usedForBox().closest("label")).toHaveTextContent(
      "The summary that comes to you, not to a client",
    );
  });

  it("lists every detail that can be dropped into the message", async () => {
    open();

    const client = await screen.findByRole("button", { name: "client_name" });
    expect(client).toHaveAttribute("title", "The client's full name");
    expect(screen.getByRole("button", { name: "days_to_expiry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "digest_table" })).toBeInTheDocument();
    expect(backend().countOf("template_placeholders")).toBe(1);
  });

  it("drops a placeholder into the message where the cursor is", async () => {
    const { user } = open();
    await screen.findByRole("button", { name: "client_name" });

    await user.clear(bodyBox());
    await user.type(bodyBox(), "Dear , your cover ends soon.");
    await user.keyboard("{ArrowLeft>23/}");
    await user.click(screen.getByRole("button", { name: "client_name" }));

    expect(bodyBox()).toHaveValue("Dear {{client_name}}, your cover ends soon.");
  });

  it("drops a placeholder into the subject when the subject was last used", async () => {
    const { user } = open();
    await screen.findByRole("button", { name: "expiry_date" });

    await user.type(subjectBox(), "Renewal due  — act now");
    await user.keyboard("{ArrowLeft>10/}");
    await user.click(screen.getByRole("button", { name: "expiry_date" }));

    expect(subjectBox()).toHaveValue("Renewal due {{expiry_date}} — act now");
  });

  it("shows the message as a client will read it, against a real policy", async () => {
    open();

    expect(await previewed()).toHaveTextContent("Dear Rohit Sharma,");
    expect(screen.getByText(/Warm regards,/, { selector: "p" })).toHaveTextContent(
      "Sharma Insurance Services",
    );
    expect(screen.getByText("SH/2025/0091823 · Rohit Sharma")).toBeInTheDocument();
  });

  it("falls back to example details when the book has no policy to borrow", async () => {
    backend().book.policies = [];
    open();

    expect(await screen.findByText("Example details")).toBeInTheDocument();
  });

  it("fills the subject line in the preview too", async () => {
    const { user } = open();

    await user.type(subjectBox(), typed("Your {{category_label}} cover ends {{expiry_date}}"));

    expect(
      await screen.findByText("Your Health cover ends 21 Aug 2026", undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it("keeps a plain text copy alongside the formatted one", async () => {
    open();
    await previewed();

    expect(
      screen.getByText("Plain text copy, for mail apps that will not show the formatted one"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Dear Rohit Sharma,/, { selector: "pre" })).toBeInTheDocument();
  });

  it("waits for the typing to stop before asking for a preview", async () => {
    const { user } = open();
    await previewed();
    backend().clearCalls();

    await user.type(subjectBox(), "Renewal due");

    await waitFor(
      () => expect(backend().lastCall("preview_template")?.subject).toBe("Renewal due"),
      { timeout: 3000 },
    );
    expect(backend().countOf("preview_template")).toBeLessThan(3);
  });

  it("warns about a placeholder nothing will fill", async () => {
    const { user } = open();

    await user.type(subjectBox(), typed("Hello {{clint_name}}"));

    expect(
      await screen.findByText(/Nothing will fill \{\{clint_name\}\}/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it("keeps quiet while every placeholder is one the core knows", async () => {
    open();
    await previewed();

    expect(screen.queryByText(/Nothing will fill/)).not.toBeInTheDocument();
  });

  it("sends what was written to create_template", async () => {
    const { user, onClose } = open();

    await user.type(nameBox(), "Motor renewal nudge");
    await user.selectOptions(usedForBox(), "post_expiry");
    await user.type(subjectBox(), "Your cover has lapsed");
    await user.clear(bodyBox());
    await user.type(bodyBox(), "<p>Please call us.</p>");
    await user.click(saveButton());

    await waitFor(() => {
      expect(backend().lastCall("create_template")).toEqual({
        input: {
          name: "Motor renewal nudge",
          trigger: "post_expiry",
          subject: "Your cover has lapsed",
          bodyHtml: "<p>Please call us.</p>",
          isActive: true,
        },
      });
    });
    expect(await screen.findByText("Message saved")).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
    expect(backend().book.templates.at(-1)?.name).toBe("Motor renewal nudge");
  });

  it("repeats what the core says about a blank name", async () => {
    const { user, onClose } = open();

    // The name is the only thing missing: with a subject written, the form has
    // nothing of its own to say and the core is the one refusing.
    await user.type(subjectBox(), "Your cover ends soon");
    await user.click(saveButton());

    expect(await screen.findByText("Template name is required")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("will not save a message with no subject", async () => {
    const { user, onClose } = open();

    await user.type(nameBox(), "No subject");
    await user.click(saveButton());

    expect(backend().countOf("create_template")).toBe(0);
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText("Subject is required")).toBeInTheDocument();
    expect(subjectBox()).toHaveFocus();
  });

  it("stays open when the core refuses the message", async () => {
    backend().fail("create_template", {
      kind: "conflict",
      message: "A message with that name already exists",
    });
    const { user, onClose } = open();

    await user.type(nameBox(), "Policy expiry reminder");
    await user.type(subjectBox(), "Your cover ends soon");
    await user.click(saveButton());

    expect(await screen.findByText("A message with that name already exists")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the save working while the core is writing", async () => {
    const gate = backend().hold("create_template");
    const { user, onClose } = open();

    await user.type(nameBox(), "Slow one");
    await user.type(subjectBox(), "Your cover ends soon");
    await user.click(saveButton());

    await waitFor(() => expect(saveButton()).toBeDisabled());
    gate.release();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("carries on when the preview cannot be rendered", async () => {
    backend().fail("preview_template", { kind: "internal", message: "Preview blew up" });
    const { user, onClose } = open();

    await user.type(nameBox(), "Still saveable");
    await user.type(subjectBox(), "Your cover ends soon");
    await waitFor(() => expect(backend().countOf("preview_template")).toBeGreaterThan(0), {
      timeout: 3000,
    });
    expect(screen.queryByText("Preview blew up")).not.toBeInTheDocument();

    await user.click(saveButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("closes without writing anything when cancelled", async () => {
    const { user, onClose } = open();

    await user.type(nameBox(), "Never mind");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
    expect(backend().countOf("create_template")).toBe(0);
  });

  it("closes on Escape", async () => {
    const { user, onClose } = open();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });
});

describe("an existing message", () => {
  it("opens with the message as it was saved", async () => {
    const template = templateNamed("Lapsed policy follow up");
    open(template);

    expect(screen.getByRole("heading", { name: "Lapsed policy follow up" })).toBeInTheDocument();
    expect(nameBox()).toHaveValue("Lapsed policy follow up");
    expect(usedForBox()).toHaveValue("post_expiry");
    expect(subjectBox()).toHaveValue("Your {{category_label}} policy has lapsed");
    expect(bodyBox()).toHaveValue(template.bodyHtml);
  });

  it("previews the saved wording straight away", async () => {
    open(templateNamed("Policy expiry reminder"));

    expect(
      await screen.findByText("Your Health policy expires on 21 Aug 2026", undefined, {
        timeout: 3000,
      }),
    ).toBeInTheDocument();
    const preview = await previewed();
    expect(preview).toHaveTextContent("Dear Rohit Sharma,");
  });

  it("sends the whole message to update_template", async () => {
    const template = templateNamed("Final expiry notice");
    const { user, onClose } = open(template);

    await user.type(
      subjectBox(),
      `{Control>}a{/Control}${typed("Last call before {{expiry_date}}")}`,
    );
    await user.click(saveButton());

    await waitFor(() => {
      expect(backend().lastCall("update_template")).toEqual({
        id: template.id,
        input: {
          name: "Final expiry notice",
          trigger: "expiry_reminder",
          subject: "Last call before {{expiry_date}}",
          bodyHtml: template.bodyHtml,
          isActive: true,
        },
      });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("adds a placeholder to wording that is already there", async () => {
    const { user } = open(templateNamed("Renewal confirmation"));
    await screen.findByRole("button", { name: "policy_year" });

    await user.click(bodyBox());
    await user.keyboard("{End}");
    await user.click(screen.getByRole("button", { name: "policy_year" }));

    expect(bodyBox().value.endsWith("{{policy_year}}")).toBe(true);
  });

  it("says what went wrong when the message has gone", async () => {
    backend().fail("update_template", { kind: "not_found", message: "That template was not found" });
    const { user, onClose } = open(templateNamed("Provider daily digest"));

    await user.click(saveButton());

    expect(await screen.findByText("That template was not found")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("previews the digest table the provider message drops in", async () => {
    open(templateNamed("Provider daily digest"));

    const table = await screen.findByRole("table", undefined, { timeout: 3000 });
    expect(within(table).getByText("Ananya Sharma")).toBeInTheDocument();
    expect(
      await screen.findByText("StayInsured: 12 policies need attention"),
    ).toBeInTheDocument();
  });
});
