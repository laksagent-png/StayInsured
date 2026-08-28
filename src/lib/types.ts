export type Category =
  | "health"
  | "life"
  | "motor"
  | "travel"
  | "home"
  | "personal_accident"
  | "critical_illness"
  | "other";

export type PolicyStatus = "active" | "expired" | "renewed" | "lapsed" | "cancelled";

/** A rider sold on top of a health plan. */
export type Rider =
  | "safeguard"
  | "safeguard_plus"
  | "pa_main_member"
  | "future_ready"
  | "fast_forwarded";

/** One life, or a family sharing a sum insured. */
export type PlanType = "individual" | "family_floater";

/**
 * How a policy year was written. Not a status: a policy ported in from another
 * insurer stays a `portability`, while `renewed` says a later year exists.
 */
export type PolicyType = "fresh" | "portability" | "renewal";

/** The most years of health cover that can be bought in one go. */
export const MAX_TERM = 5;

/**
 * How one client is related to another. There is no `self`: a family member is a
 * client, so a client does not relate to themselves.
 */
export type Relationship =
  | "spouse"
  | "son"
  | "daughter"
  | "father"
  | "mother"
  | "brother"
  | "sister"
  | "other";

/** What a client delete takes with it besides the client. */
export type DeleteScope = "linksOnly" | "immediateFamily";

/**
 * Whether a client is a person or a company. A company holds policies like
 * anybody else but has no date of birth and no gender, so the forms read this
 * rather than inferring an entity from which fields happen to be filled in.
 */
export type ClientKind = "individual" | "company";

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SessionState {
  initialised: boolean;
  unlocked: boolean;
  canUseKeychain: boolean;
  /**
   * Whether the password protects the file or only the screens. The Tauri core
   * derives the SQLCipher key from it and answers true; the Electron edition for
   * Windows 7 opens a plain file and answers false. The screens that promise
   * encryption read this rather than assuming it.
   */
  encrypted: boolean;
  schemaVersion: number;
  dataDir: string;
}

export interface Client {
  id: number;
  clientCode: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  altPhone: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  occupation: string | null;
  pan: string | null;
  gstin: string | null;
  preferredLanguage: string;
  remindersOptedOut: boolean;
  notes: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  kind: ClientKind;
  /** The group this client sits in. Cleared, not cascaded, when the group goes. */
  groupId: number | null;
  /** Who to ask for at a company, and what they do there. */
  contactPerson: string | null;
  contactDesignation: string | null;
  /** CIN, LLPIN or whatever the registrar issued. */
  registrationNo: string | null;
  activePolicies: number;
  totalPolicies: number;
  nextExpiry: string | null;
  /** People related to this client, either direction of the edge. */
  relatives: number;
  /**
   * No policy of their own and listed under somebody else. Derived on read.
   *
   * Group membership is no part of this: a subsidiary that has not placed cover
   * yet is a client the agent browses to, not somebody's dependent.
   */
  isDependent: boolean;
  groupName: string | null;
}

export interface ClientInput {
  clientCode?: string | null;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  altPhone?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  occupation?: string | null;
  pan?: string | null;
  gstin?: string | null;
  preferredLanguage?: string | null;
  remindersOptedOut?: boolean;
  notes?: string | null;
  kind?: ClientKind | null;
  /**
   * Coalesced rather than assigned: leaving it out keeps a client in the group
   * they are in, so a form that draws no group cannot empty one. Moving between
   * groups goes through `setClientGroup`.
   */
  groupId?: number | null;
  contactPerson?: string | null;
  contactDesignation?: string | null;
  registrationNo?: string | null;
}

export interface ClientFilter {
  search?: string;
  city?: string;
  state?: string;
  category?: string;
  includeArchived?: boolean;
  /**
   * Brings dependents into the list. They are always reachable by search; this
   * is about whether browsing shows them.
   */
  includeFamily?: boolean;
  missingEmail?: boolean;
  kind?: ClientKind | "";
  /** The group roster: this list, narrowed to one folder. */
  groupId?: number;
  sort?: string;
  descending?: boolean;
  page?: number;
  pageSize?: number;
}

export interface Document {
  id: number;
  clientId: number;
  policyId: number | null;
  policyNumber: string | null;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface DocumentInput {
  clientId: number;
  policyId?: number | null;
  title?: string | null;
  path: string;
}

/** One client related to another, as a row of the family panel. */
export interface Relative {
  clientId: number;
  clientCode: string;
  fullName: string;
  relationship: Relationship;
  /**
   * Which side of the stored edge this person sits on. `true` — they are the
   * client's `relationship`, read as "Son: Aarav". `false` — the client is
   * theirs, read as "Son of: Rajesh".
   *
   * The word is never inverted into its opposite, because choosing between
   * father and mother needs a gender the book may not hold.
   */
  outgoing: boolean;
  dateOfBirth: string | null;
  gender: string | null;
  isArchived: boolean;
  ownPolicies: number;
  notes: string | null;
}

/**
 * A whole family: everybody reachable from one client, and the edges between
 * them. There is no family record — this is what a walk over the relationships
 * found.
 */
export interface Family {
  members: FamilyMember[];
  edges: FamilyEdge[];
}

export interface FamilyMember {
  clientId: number;
  clientCode: string;
  fullName: string;
  dateOfBirth: string | null;
  gender: string | null;
  isArchived: boolean;
  ownPolicies: number;
  /** Edges walked to reach this person; zero is the client asked about. */
  steps: number;
}

/** Stored in one direction: the related client is the `relationship` of the client. */
export interface FamilyEdge {
  clientId: number;
  relatedClientId: number;
  relationship: Relationship;
}

export interface RelationInput {
  clientId: number;
  relatedClientId: number;
  relationship: string;
}

/**
 * A named set of clients the agency works as one book, and the client who
 * referred them.
 *
 * Unlike a family this is a record of its own, because it has the boundary a
 * family lacks: it is named, entered deliberately, holds a client at a time, and
 * the operator can say where it ends. The roster is not part of this shape —
 * it is `listClients` with `groupId` set.
 */
export interface Group {
  id: number;
  groupCode: string;
  name: string;
  /** The referrer, who need not be a member of the group they brought in. */
  headClientId: number | null;
  headName: string | null;
  headClientCode: string | null;
  notes: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  /** The group's book, summed across its members and not its referrer. */
  members: number;
  activePolicies: number;
  totalPolicies: number;
  premiumUnderManagement: number;
  nextExpiry: string | null;
}

export interface GroupInput {
  groupCode?: string | null;
  name: string;
  /** Required: a group without a referrer is a referral nobody recorded. */
  headClientId?: number | null;
  notes?: string | null;
}

export interface GroupFilter {
  search?: string;
  includeArchived?: boolean;
  /** Groups this client referred: headship read from the referrer's end. */
  headClientId?: number;
  sort?: string;
  descending?: boolean;
  page?: number;
  pageSize?: number;
}

export interface Insurer {
  id: number;
  name: string;
  shortCode: string | null;
  website: string | null;
  claimHelpline: string | null;
  supportEmail: string | null;
  notes: string | null;
  isActive: boolean;
  policyCount: number;
}

export interface InsurerInput {
  name: string;
  shortCode?: string | null;
  website?: string | null;
  claimHelpline?: string | null;
  supportEmail?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export interface Product {
  id: number;
  insurerId: number;
  insurerName: string;
  name: string;
  category: Category;
  code: string | null;
  notes: string | null;
  isActive: boolean;
  policyCount: number;
}

export interface ProductInput {
  insurerId: number;
  name: string;
  category: string;
  code?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

export interface Policy {
  id: number;
  chainId: string;
  policyYear: number;
  previousPolicyId: number | null;
  policyNumber: string;
  clientId: number;
  clientCode: string;
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  clientCity: string | null;
  remindersOptedOut: boolean;
  insurerId: number;
  insurerName: string;
  productId: number | null;
  productName: string | null;
  category: Category;
  status: PolicyStatus;
  startDate: string;
  expiryDate: string;
  sumInsured: number | null;
  premiumAmount: number | null;
  gstAmount: number | null;
  premiumFrequency: string;
  paymentMode: string | null;
  nextDueDate: string | null;
  commissionRate: number | null;
  commissionExpected: number | null;
  nomineeName: string | null;
  nomineeRelation: string | null;
  vehicleNumber: string | null;
  variant: string | null;
  /** The riders bought on top, always in the core's own order. */
  riders: Rider[];
  planType: PlanType | null;
  /** Years of cover bought in one go, 1 to `MAX_TERM`. */
  term: number | null;
  policyType: PolicyType | null;
  broker: string | null;
  /** A rider the plan comes with, as against one bought on top. */
  inbuiltRider: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  daysToExpiry: number;
  isRenewed: boolean;
}

export interface PolicyInput {
  policyNumber: string;
  clientId: number;
  insurerId: number;
  productId?: number | null;
  category: string;
  status?: string | null;
  startDate: string;
  expiryDate: string;
  sumInsured?: number | null;
  premiumAmount?: number | null;
  gstAmount?: number | null;
  premiumFrequency?: string | null;
  paymentMode?: string | null;
  nextDueDate?: string | null;
  commissionRate?: number | null;
  commissionExpected?: number | null;
  nomineeName?: string | null;
  nomineeRelation?: string | null;
  vehicleNumber?: string | null;
  variant?: string | null;
  riders?: Rider[] | null;
  planType?: PlanType | null;
  term?: number | null;
  policyType?: PolicyType | null;
  broker?: string | null;
  inbuiltRider?: string | null;
  notes?: string | null;
  /** The clients this policy year covers, which may include the holder. */
  insuredClientIds?: number[] | null;
}

export interface RenewalInput {
  policyId: number;
  policyNumber?: string | null;
  startDate?: string | null;
  expiryDate?: string | null;
  sumInsured?: number | null;
  premiumAmount?: number | null;
  gstAmount?: number | null;
  commissionRate?: number | null;
  commissionExpected?: number | null;
  notes?: string | null;
}

export interface PolicyFilter {
  search?: string;
  clientId?: number;
  insurerId?: number;
  productId?: number;
  categories?: string[];
  statuses?: string[];
  expiryFrom?: string;
  expiryTo?: string;
  expiringWithinDays?: number;
  minPremium?: number;
  maxPremium?: number;
  city?: string;
  latestOnly?: boolean;
  unrenewedOnly?: boolean;
  sort?: string;
  descending?: boolean;
  page?: number;
  pageSize?: number;
}

export interface CategoryBreakdown {
  category: Category;
  policyCount: number;
  premiumTotal: number;
  sumInsuredTotal: number;
}

export interface ExpiryBucket {
  label: string;
  count: number;
  premiumTotal: number;
}

export interface Dashboard {
  totalClients: number;
  activeClients: number;
  activePolicies: number;
  expiringThisWeek: number;
  expiringThisMonth: number;
  expiredUnrenewed: number;
  premiumUnderManagement: number;
  commissionExpected: number;
  clientsWithoutEmail: number;
  buckets: ExpiryBucket[];
  byCategory: CategoryBreakdown[];
  upcoming: Policy[];
  recentlyLapsed: Policy[];
}

export interface LookupItem {
  id: number;
  label: string;
  secondary: string | null;
}

export interface ImportFieldInfo {
  key: string;
  label: string;
  group: string;
  required: boolean;
}

export interface ImportPreview {
  fileName: string;
  sheetNames: string[];
  sheet: string;
  headers: string[];
  sampleRows: string[][];
  totalRows: number;
  suggestedMapping: Record<string, string>;
  unmappedHeaders: string[];
}

export interface ImportOptions {
  path: string;
  sheet?: string | null;
  mapping: Record<string, string>;
  defaultCategory?: string | null;
  updateExisting?: boolean;
  dryRun?: boolean;
}

export interface ImportIssue {
  row: number;
  column: string | null;
  value: string | null;
  message: string;
}

export interface ImportReport {
  dryRun: boolean;
  totalRows: number;
  policiesInserted: number;
  policiesUpdated: number;
  clientsCreated: number;
  clientsUpdated: number;
  insurersCreated: number;
  skipped: number;
  failed: number;
  issues: ImportIssue[];
}

export type TemplateTrigger =
  | "expiry_reminder"
  | "post_expiry"
  | "welcome"
  | "renewal_confirmation"
  | "annual_summary"
  | "provider_digest"
  | "custom";

export interface EmailTemplate {
  id: number;
  name: string;
  trigger: TemplateTrigger;
  subject: string;
  bodyHtml: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  usedByRules: number;
}

export interface EmailTemplateInput {
  name: string;
  trigger: TemplateTrigger;
  subject: string;
  bodyHtml: string;
  isActive?: boolean;
}

export interface Placeholder {
  name: string;
  description: string;
}

export interface TemplatePreview {
  subject: string;
  html: string;
  text: string;
  unknownPlaceholders: string[];
  samplePolicy: string | null;
}

export type ReminderAudience = "client" | "provider";
export type ReminderChannel = "email" | "desktop" | "both";

export interface ReminderRule {
  id: number;
  name: string;
  offsetDays: number;
  category: string | null;
  audience: ReminderAudience;
  channel: ReminderChannel;
  templateId: number | null;
  templateName: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface ReminderRuleInput {
  name: string;
  offsetDays: number;
  category?: string | null;
  audience: ReminderAudience;
  channel: ReminderChannel;
  templateId?: number | null;
  isActive?: boolean;
  sortOrder?: number;
}

export type NotificationStatus = "queued" | "sent" | "failed" | "skipped" | "cancelled";

export interface Notification {
  id: number;
  ruleId: number | null;
  ruleName: string | null;
  policyId: number | null;
  policyNumber: string | null;
  clientId: number | null;
  clientName: string | null;
  policyPeriod: string;
  audience: ReminderAudience;
  channel: ReminderChannel;
  toAddress: string | null;
  subject: string | null;
  status: NotificationStatus;
  attempts: number;
  lastError: string | null;
  scheduledFor: string;
  sentAt: string | null;
  createdAt: string;
}

export interface NotificationFilter {
  statuses?: NotificationStatus[];
  clientId?: number;
  policyId?: number;
  search?: string;
  sort?: string;
  descending?: boolean;
  page?: number;
  pageSize?: number;
}

export interface PlannedReminder {
  ruleId: number;
  ruleName: string;
  policyId: number;
  policyNumber: string;
  clientId: number;
  clientName: string;
  toAddress: string | null;
  expiryDate: string;
  daysToExpiry: number;
  channel: ReminderChannel;
  subject: string;
  blockedReason: string | null;
}

export interface ReminderRun {
  dryRun: boolean;
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  heldByCap: number;
  desktopAlerts: number;
  digestSent: boolean;
  issues: string[];
}

export interface ReminderOverview {
  enabled: boolean;
  dryRun: boolean;
  smtpConfigured: boolean;
  smtpPasswordSet: boolean;
  fromEmail: string;
  sendTime: string;
  dailyCap: number;
  digestEnabled: boolean;
  desktopAlerts: boolean;
  activeRules: number;
  dueToday: number;
  queued: number;
  failed: number;
  sentToday: number;
  lastSweep: string | null;
  clientsOptedOut: number;
  expiringWithoutEmail: number;
}
