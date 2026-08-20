/**
 * The bridge every screen sends its work over.
 *
 * Two things matter here: that a wrapper names the command the Rust side
 * registered and sends the arguments it expects — a filter that reads correctly
 * but arrives as `undefined` is a bug no screen can see — and that a failure
 * comes back as an ApiError the screens can put in a toast.
 */

import { describe, expect, it } from "vitest";

import { ApiError, api, type ErrorKind } from "@/lib/api";
import type {
  ClientFilter,
  ClientInput,
  DocumentInput,
  EmailTemplateInput,
  ImportOptions,
  InsurerInput,
  NotificationFilter,
  PolicyFilter,
  PolicyInput,
  ProductInput,
  RelationInput,
  ReminderRuleInput,
  RenewalInput,
} from "@/lib/types";
import { backend } from "@/test";

const clientFilter: ClientFilter = { search: "anita", city: "Pune", page: 2, pageSize: 25 };
const clientInput: ClientInput = { fullName: "Anita Desai", email: "anita@example.com" };
const relationInput: RelationInput = { clientId: 1, relatedClientId: 9, relationship: "spouse" };
const documentInput: DocumentInput = { clientId: 1, path: "/tmp/schedule.pdf", title: "Schedule" };
const insurerInput: InsurerInput = { name: "Star Health", shortCode: "SH" };
const productInput: ProductInput = { insurerId: 1, name: "Family Optima", category: "health" };
const policyFilter: PolicyFilter = { search: "SH/2025", statuses: ["active"], page: 1 };
const policyInput: PolicyInput = {
  policyNumber: "SH/2026/0000001",
  clientId: 1,
  insurerId: 1,
  category: "health",
  startDate: "2026-08-14",
  expiryDate: "2027-08-13",
};
const renewalInput: RenewalInput = { policyId: 1, policyNumber: "SH/2026/0000002" };
const importOptions: ImportOptions = {
  path: "/tmp/book.xlsx",
  mapping: { policy_number: "Policy No" },
  dryRun: true,
};
const templateInput: EmailTemplateInput = {
  name: "Expiry notice",
  trigger: "expiry_reminder",
  subject: "Your policy is due",
  bodyHtml: "<p>Hello {{client_name}}</p>",
};
const ruleInput: ReminderRuleInput = {
  name: "Thirty days out",
  offsetDays: 30,
  audience: "client",
  channel: "email",
};
const notificationFilter: NotificationFilter = { statuses: ["failed"], page: 1 };

interface Wrapper {
  name: string;
  send: () => Promise<unknown>;
  command: string;
  args: Record<string, unknown>;
}

/**
 * Drives a wrapper for the call it makes. The fake core rejects some of these
 * sample arguments — a duplicate insurer, a client that still has policies —
 * and that is fine: the call is recorded before the answer comes back.
 */
async function drive(send: () => Promise<unknown>): Promise<void> {
  await send().catch(() => {});
}

const wrappers: Wrapper[] = [
  // session
  { name: "sessionState", send: () => api.sessionState(), command: "session_state", args: {} },
  {
    name: "setup",
    send: () => api.setup("correct-horse", "Anita Desai", true),
    command: "setup",
    args: { password: "correct-horse", displayName: "Anita Desai", remember: true },
  },
  {
    name: "unlock",
    send: () => api.unlock("correct-horse", false),
    command: "unlock",
    args: { password: "correct-horse", remember: false },
  },
  {
    name: "unlockWithKeychain",
    send: () => api.unlockWithKeychain(),
    command: "unlock_with_keychain",
    args: {},
  },
  { name: "lock", send: () => api.lock(), command: "lock", args: {} },
  { name: "forgetDevice", send: () => api.forgetDevice(), command: "forget_device", args: {} },
  {
    name: "changePassword",
    send: () => api.changePassword("correct-horse", "a longer one"),
    command: "change_password",
    args: { current: "correct-horse", replacement: "a longer one" },
  },

  // dashboard & lookups
  { name: "dashboard", send: () => api.dashboard(), command: "load_dashboard", args: {} },
  { name: "categories", send: () => api.categories(), command: "category_options", args: {} },
  { name: "cities", send: () => api.cities(), command: "client_cities", args: {} },

  // clients
  {
    name: "listClients",
    send: () => api.listClients(clientFilter),
    command: "list_clients",
    args: { filter: clientFilter },
  },
  { name: "getClient", send: () => api.getClient(7), command: "get_client", args: { id: 7 } },
  {
    name: "createClient",
    send: () => api.createClient(clientInput),
    command: "create_client",
    args: { input: clientInput },
  },
  {
    name: "updateClient",
    send: () => api.updateClient(7, clientInput),
    command: "update_client",
    args: { id: 7, input: clientInput },
  },
  {
    name: "setClientArchived",
    send: () => api.setClientArchived(7, true),
    command: "set_client_archived",
    args: { id: 7, archived: true },
  },
  {
    name: "deleteClient",
    send: () => api.deleteClient(7),
    command: "delete_client",
    args: { id: 7, scope: "linksOnly" },
  },
  {
    name: "deleteClient with the family",
    send: () => api.deleteClient(7, "immediateFamily"),
    command: "delete_client",
    args: { id: 7, scope: "immediateFamily" },
  },
  {
    name: "setFamilyArchived",
    send: () => api.setFamilyArchived(1, true),
    command: "set_family_archived",
    args: { id: 1, archived: true },
  },
  {
    name: "nextClientCode",
    send: () => api.nextClientCode(),
    command: "next_client_code",
    args: {},
  },

  // family
  {
    name: "listRelatives",
    send: () => api.listRelatives(1),
    command: "list_relatives",
    args: { clientId: 1 },
  },
  {
    name: "clientFamily",
    send: () => api.clientFamily(1),
    command: "client_family",
    args: { clientId: 1 },
  },
  {
    name: "linkClients",
    send: () => api.linkClients(relationInput),
    command: "link_clients",
    args: { input: relationInput },
  },
  {
    name: "unlinkClients",
    send: () => api.unlinkClients(1, 9),
    command: "unlink_clients",
    args: { clientId: 1, relatedClientId: 9 },
  },

  // documents
  {
    name: "listDocuments",
    send: () => api.listDocuments(1),
    command: "list_documents",
    args: { clientId: 1 },
  },
  {
    name: "attachDocument",
    send: () => api.attachDocument(documentInput),
    command: "attach_document",
    args: { input: documentInput },
  },
  {
    name: "documentContent",
    send: () => api.documentContent(9),
    command: "document_content",
    args: { id: 9 },
  },
  {
    name: "saveDocumentCopy",
    send: () => api.saveDocumentCopy(9, "/tmp/copy.pdf"),
    command: "save_document_copy",
    args: { id: 9, path: "/tmp/copy.pdf" },
  },
  {
    name: "deleteDocument",
    send: () => api.deleteDocument(9),
    command: "delete_document",
    args: { id: 9 },
  },

  // insurers & products
  {
    name: "insurerOptions",
    send: () => api.insurerOptions(),
    command: "insurer_options",
    args: {},
  },
  {
    name: "createInsurer",
    send: () => api.createInsurer(insurerInput),
    command: "create_insurer",
    args: { input: insurerInput },
  },
  {
    name: "updateInsurer",
    send: () => api.updateInsurer(2, insurerInput),
    command: "update_insurer",
    args: { id: 2, input: insurerInput },
  },
  {
    name: "deleteInsurer",
    send: () => api.deleteInsurer(2),
    command: "delete_insurer",
    args: { id: 2 },
  },
  {
    name: "createProduct",
    send: () => api.createProduct(productInput),
    command: "create_product",
    args: { input: productInput },
  },
  {
    name: "updateProduct",
    send: () => api.updateProduct(5, productInput),
    command: "update_product",
    args: { id: 5, input: productInput },
  },
  {
    name: "deleteProduct",
    send: () => api.deleteProduct(5),
    command: "delete_product",
    args: { id: 5 },
  },

  // policies
  {
    name: "listPolicies",
    send: () => api.listPolicies(policyFilter),
    command: "list_policies",
    args: { filter: policyFilter },
  },
  { name: "getPolicy", send: () => api.getPolicy(1), command: "get_policy", args: { id: 1 } },
  {
    name: "policyChain",
    send: () => api.policyChain(1),
    command: "policy_chain",
    args: { id: 1 },
  },
  {
    name: "policyInsuredIds",
    send: () => api.policyInsuredIds(1),
    command: "policy_insured_ids",
    args: { id: 1 },
  },
  {
    name: "createPolicy",
    send: () => api.createPolicy(policyInput),
    command: "create_policy",
    args: { input: policyInput },
  },
  {
    name: "updatePolicy",
    send: () => api.updatePolicy(1, policyInput),
    command: "update_policy",
    args: { id: 1, input: policyInput },
  },
  {
    name: "renewPolicy",
    send: () => api.renewPolicy(renewalInput),
    command: "renew_policy",
    args: { input: renewalInput },
  },
  {
    name: "setPolicyStatus",
    send: () => api.setPolicyStatus(1, "cancelled"),
    command: "set_policy_status",
    args: { id: 1, status: "cancelled" },
  },
  {
    name: "deletePolicy",
    send: () => api.deletePolicy(1),
    command: "delete_policy",
    args: { id: 1 },
  },
  {
    name: "refreshStatuses",
    send: () => api.refreshStatuses(),
    command: "refresh_statuses",
    args: {},
  },

  // import & export
  { name: "importFields", send: () => api.importFields(), command: "import_fields", args: {} },
  {
    name: "runImport",
    send: () => api.runImport(importOptions),
    command: "run_import",
    args: { options: importOptions },
  },
  {
    name: "writeImportTemplate",
    send: () => api.writeImportTemplate("/tmp/template.xlsx"),
    command: "write_import_template",
    args: { path: "/tmp/template.xlsx" },
  },
  {
    name: "exportPolicies",
    send: () => api.exportPolicies(policyFilter, "/tmp/policies.xlsx"),
    command: "export_policies",
    args: { filter: policyFilter, path: "/tmp/policies.xlsx" },
  },
  {
    name: "exportClients",
    send: () => api.exportClients(clientFilter, "/tmp/clients.xlsx"),
    command: "export_clients",
    args: { filter: clientFilter, path: "/tmp/clients.xlsx" },
  },

  // message templates
  { name: "listTemplates", send: () => api.listTemplates(), command: "list_templates", args: {} },
  {
    name: "createTemplate",
    send: () => api.createTemplate(templateInput),
    command: "create_template",
    args: { input: templateInput },
  },
  {
    name: "updateTemplate",
    send: () => api.updateTemplate(2, templateInput),
    command: "update_template",
    args: { id: 2, input: templateInput },
  },
  {
    name: "deleteTemplate",
    send: () => api.deleteTemplate(2),
    command: "delete_template",
    args: { id: 2 },
  },
  {
    name: "templatePlaceholders",
    send: () => api.templatePlaceholders(),
    command: "template_placeholders",
    args: {},
  },
  {
    name: "previewTemplate",
    send: () => api.previewTemplate("Due soon", "<p>Hello</p>"),
    command: "preview_template",
    args: { subject: "Due soon", bodyHtml: "<p>Hello</p>" },
  },

  // reminder rules
  { name: "listRules", send: () => api.listRules(), command: "list_rules", args: {} },
  {
    name: "createRule",
    send: () => api.createRule(ruleInput),
    command: "create_rule",
    args: { input: ruleInput },
  },
  {
    name: "updateRule",
    send: () => api.updateRule(3, ruleInput),
    command: "update_rule",
    args: { id: 3, input: ruleInput },
  },
  { name: "deleteRule", send: () => api.deleteRule(3), command: "delete_rule", args: { id: 3 } },

  // reminders
  {
    name: "reminderOverview",
    send: () => api.reminderOverview(),
    command: "reminder_overview",
    args: {},
  },
  { name: "planReminders", send: () => api.planReminders(), command: "plan_reminders", args: {} },
  {
    name: "listNotifications",
    send: () => api.listNotifications(notificationFilter),
    command: "list_notifications",
    args: { filter: notificationFilter },
  },
  {
    name: "retryNotification",
    send: () => api.retryNotification(11),
    command: "retry_notification",
    args: { id: 11 },
  },
  {
    name: "cancelNotification",
    send: () => api.cancelNotification(11),
    command: "cancel_notification",
    args: { id: 11 },
  },
  {
    name: "sendTestEmail",
    send: () => api.sendTestEmail("anita@example.com"),
    command: "send_test_email",
    args: { to: "anita@example.com" },
  },

  // settings & maintenance
  { name: "getSettings", send: () => api.getSettings(), command: "get_settings", args: {} },
  {
    name: "saveSettings",
    send: () => api.saveSettings({ provider_name: "Desai Insurance" }),
    command: "save_settings",
    args: { values: { provider_name: "Desai Insurance" } },
  },
  { name: "backupNow", send: () => api.backupNow(), command: "backup_now", args: {} },
  { name: "revealDataDir", send: () => api.revealDataDir(), command: "reveal_data_dir", args: {} },
];

describe("the commands the wrappers send", () => {
  it.each(wrappers)("$name asks the core for $command", async ({ send, command, args }) => {
    await drive(send);

    expect(backend().calls).toEqual([{ command, args }]);
  });

  it("hands the answer back to the caller", async () => {
    backend().on("next_client_code", () => "CL-00042");

    await expect(api.nextClientCode()).resolves.toBe("CL-00042");
  });
});

describe("the arguments the wrappers fill in", () => {
  it("asks for the active insurers unless told otherwise", async () => {
    await drive(() => api.listInsurers());
    expect(backend().lastCall("list_insurers")).toEqual({ includeInactive: false });

    await drive(() => api.listInsurers(true));
    expect(backend().lastCall("list_insurers")).toEqual({ includeInactive: true });
  });

  it("asks for every insurer's plans when given no insurer", async () => {
    await drive(() => api.listProducts());

    expect(backend().lastCall("list_products")).toEqual({
      insurerId: null,
      includeInactive: false,
    });
  });

  it("narrows the plans to one insurer when given one", async () => {
    await drive(() => api.listProducts(4));
    expect(backend().lastCall("list_products")).toEqual({ insurerId: 4, includeInactive: false });

    await drive(() => api.listProducts(4, true));
    expect(backend().lastCall("list_products")).toEqual({ insurerId: 4, includeInactive: true });

    await drive(() => api.listProducts(undefined, true));
    expect(backend().lastCall("list_products")).toEqual({
      insurerId: null,
      includeInactive: true,
    });
  });

  it("leaves the dry run to the settings when the caller does not say", async () => {
    await drive(() => api.runReminders());

    expect(backend().lastCall("run_reminders")).toEqual({ dryRun: null });
  });

  it("sends the dry run the caller chose, including a deliberate false", async () => {
    await drive(() => api.runReminders(true));
    expect(backend().lastCall("run_reminders")).toEqual({ dryRun: true });

    await drive(() => api.runReminders(false));
    expect(backend().lastCall("run_reminders")).toEqual({ dryRun: false });
  });

  it("lets the core pick the sheet when the caller has not chosen one", async () => {
    await drive(() => api.previewImport("/tmp/book.xlsx"));
    expect(backend().lastCall("preview_import")).toEqual({ path: "/tmp/book.xlsx", sheet: null });

    await drive(() => api.previewImport("/tmp/book.xlsx", "Renewals"));
    expect(backend().lastCall("preview_import")).toEqual({
      path: "/tmp/book.xlsx",
      sheet: "Renewals",
    });
  });

  it("forgets the stored SMTP password by sending a null one", async () => {
    await drive(() => api.setSmtpPassword(null));
    expect(backend().lastCall("set_smtp_password")).toEqual({ password: null });

    await drive(() => api.setSmtpPassword("hunter2"));
    expect(backend().lastCall("set_smtp_password")).toEqual({ password: "hunter2" });
  });
});

describe("what a failure comes back as", () => {
  const kinds: ErrorKind[] = [
    "locked",
    "bad_password",
    "already_initialised",
    "validation",
    "not_found",
    "conflict",
    "mail",
    "internal",
  ];

  it("restores the kind and message the core sent", async () => {
    backend().fail("delete_client", {
      kind: "conflict",
      message: "This client still has policies",
    });

    const error = await api.deleteClient(1).catch((raw: unknown) => raw);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: "ApiError",
      kind: "conflict",
      message: "This client still has policies",
    });
  });

  it.each(kinds)("carries a %s failure through unchanged", async (kind) => {
    backend().fail("lock", { kind, message: `a ${kind} problem` });

    const error = await api.lock().catch((raw: unknown) => raw);

    expect(error).toMatchObject({ kind, message: `a ${kind} problem` });
  });

  it("treats a bare string as something internal, keeping what it said", async () => {
    backend().on("lock", () => {
      throw "the vault is sealed shut";
    });

    const error = await api.lock().catch((raw: unknown) => raw);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: "internal", message: "the vault is sealed shut" });
  });

  it("falls back to a general apology for anything else thrown", async () => {
    backend().on("lock", () => {
      throw 42;
    });

    const error = await api.lock().catch((raw: unknown) => raw);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: "internal", message: "Something went wrong" });
  });

  it("survives a failure with nothing in it", async () => {
    backend().on("lock", () => {
      throw null;
    });

    const error = await api.lock().catch((raw: unknown) => raw);

    expect(error).toMatchObject({ kind: "internal", message: "Something went wrong" });
  });

  it("treats a half-shaped failure as internal rather than trusting it", async () => {
    backend().on("lock", () => {
      throw { kind: "validation" };
    });

    const error = await api.lock().catch((raw: unknown) => raw);

    expect(error).toMatchObject({ kind: "internal", message: "Something went wrong" });
  });

  it("keeps what a thrown Error said", async () => {
    backend().on("lock", () => {
      throw new Error("the bridge is down");
    });

    const error = await api.lock().catch((raw: unknown) => raw);

    expect(error).toMatchObject({ kind: "internal", message: "the bridge is down" });
  });
});
