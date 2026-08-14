import { invoke } from "@tauri-apps/api/core";
import type {
  Client,
  ClientFilter,
  ClientInput,
  Dashboard,
  ImportFieldInfo,
  ImportOptions,
  ImportPreview,
  ImportReport,
  InsuredMember,
  Insurer,
  InsurerInput,
  LookupItem,
  MemberInput,
  Page,
  Policy,
  PolicyFilter,
  PolicyInput,
  Product,
  ProductInput,
  RenewalInput,
  SessionState,
} from "./types";

export type ErrorKind =
  | "locked"
  | "bad_password"
  | "already_initialised"
  | "validation"
  | "not_found"
  | "conflict"
  | "internal";

/** Errors cross the bridge as `{ kind, message }`; this restores that shape. */
export class ApiError extends Error {
  kind: ErrorKind;

  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = "ApiError";
  }
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    if (raw && typeof raw === "object" && "kind" in raw && "message" in raw) {
      const { kind, message } = raw as { kind: ErrorKind; message: string };
      throw new ApiError(kind, message);
    }
    throw new ApiError("internal", typeof raw === "string" ? raw : "Something went wrong");
  }
}

export const api = {
  // session
  sessionState: () => call<SessionState>("session_state"),
  setup: (password: string, displayName: string, remember: boolean) =>
    call<SessionState>("setup", { password, displayName, remember }),
  unlock: (password: string, remember: boolean) =>
    call<SessionState>("unlock", { password, remember }),
  unlockWithKeychain: () => call<SessionState>("unlock_with_keychain"),
  lock: () => call<SessionState>("lock"),
  forgetDevice: () => call<SessionState>("forget_device"),
  changePassword: (current: string, replacement: string) =>
    call<void>("change_password", { current, replacement }),

  // dashboard & lookups
  dashboard: () => call<Dashboard>("load_dashboard"),
  categories: () => call<LookupItem[]>("category_options"),
  cities: () => call<string[]>("client_cities"),

  // clients
  listClients: (filter: ClientFilter) => call<Page<Client>>("list_clients", { filter }),
  getClient: (id: number) => call<Client>("get_client", { id }),
  createClient: (input: ClientInput) => call<number>("create_client", { input }),
  updateClient: (id: number, input: ClientInput) => call<void>("update_client", { id, input }),
  setClientArchived: (id: number, archived: boolean) =>
    call<void>("set_client_archived", { id, archived }),
  deleteClient: (id: number) => call<void>("delete_client", { id }),
  nextClientCode: () => call<string>("next_client_code"),

  // members
  listMembers: (clientId: number) => call<InsuredMember[]>("list_members", { clientId }),
  createMember: (input: MemberInput) => call<number>("create_member", { input }),
  updateMember: (id: number, input: MemberInput) => call<void>("update_member", { id, input }),
  deleteMember: (id: number) => call<void>("delete_member", { id }),

  // insurers & products
  listInsurers: (includeInactive = false) =>
    call<Insurer[]>("list_insurers", { includeInactive }),
  insurerOptions: () => call<LookupItem[]>("insurer_options"),
  createInsurer: (input: InsurerInput) => call<number>("create_insurer", { input }),
  updateInsurer: (id: number, input: InsurerInput) => call<void>("update_insurer", { id, input }),
  deleteInsurer: (id: number) => call<void>("delete_insurer", { id }),
  listProducts: (insurerId?: number, includeInactive = false) =>
    call<Product[]>("list_products", { insurerId: insurerId ?? null, includeInactive }),
  createProduct: (input: ProductInput) => call<number>("create_product", { input }),
  updateProduct: (id: number, input: ProductInput) => call<void>("update_product", { id, input }),
  deleteProduct: (id: number) => call<void>("delete_product", { id }),

  // policies
  listPolicies: (filter: PolicyFilter) => call<Page<Policy>>("list_policies", { filter }),
  getPolicy: (id: number) => call<Policy>("get_policy", { id }),
  policyChain: (id: number) => call<Policy[]>("policy_chain", { id }),
  policyMemberIds: (id: number) => call<number[]>("policy_member_ids", { id }),
  createPolicy: (input: PolicyInput) => call<number>("create_policy", { input }),
  updatePolicy: (id: number, input: PolicyInput) => call<void>("update_policy", { id, input }),
  renewPolicy: (input: RenewalInput) => call<number>("renew_policy", { input }),
  setPolicyStatus: (id: number, status: string) =>
    call<void>("set_policy_status", { id, status }),
  deletePolicy: (id: number) => call<void>("delete_policy", { id }),
  refreshStatuses: () => call<number>("refresh_statuses"),

  // import & export
  importFields: () => call<ImportFieldInfo[]>("import_fields"),
  previewImport: (path: string, sheet?: string) =>
    call<ImportPreview>("preview_import", { path, sheet: sheet ?? null }),
  runImport: (options: ImportOptions) => call<ImportReport>("run_import", { options }),
  writeImportTemplate: (path: string) => call<string>("write_import_template", { path }),
  exportPolicies: (filter: PolicyFilter, path: string) =>
    call<number>("export_policies", { filter, path }),
  exportClients: (filter: ClientFilter, path: string) =>
    call<number>("export_clients", { filter, path }),

  // settings & maintenance
  getSettings: () => call<Record<string, string>>("get_settings"),
  saveSettings: (values: Record<string, string>) => call<void>("save_settings", { values }),
  backupNow: () => call<string>("backup_now"),
  revealDataDir: () => call<void>("reveal_data_dir"),
};
