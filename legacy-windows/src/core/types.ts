/**
 * The wire shapes, mirroring `src-tauri/src/models.rs`.
 *
 * These exist twice, once here and once in the app's `src/lib/types.ts`, and no
 * compiler checks that they agree — the interface is built separately and casts
 * whatever the bridge returns. That is the first and cheapest instance of the
 * drift this whole edition has to live with, so the rule is: when a model changes
 * in Rust, it changes in both places, and `tests/` is where the disagreement is
 * meant to surface.
 */

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LookupItem {
  id: number;
  label: string;
  secondary: string | null;
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
  /**
   * `individual` or `company`. A company holds policies like anybody else but has
   * no date of birth and no gender, so the screens read this rather than
   * inferring an entity from which fields happen to be filled in.
   */
  kind: string;
  /** The group this client sits in. Cleared, not cascaded, when the group goes. */
  groupId: number | null;
  contactPerson: string | null;
  contactDesignation: string | null;
  registrationNo: string | null;
  activePolicies: number;
  totalPolicies: number;
  nextExpiry: string | null;
  relatives: number;
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
  remindersOptedOut?: boolean | null;
  notes?: string | null;
  kind?: string | null;
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
  search?: string | null;
  city?: string | null;
  state?: string | null;
  category?: string | null;
  includeArchived?: boolean | null;
  includeFamily?: boolean | null;
  missingEmail?: boolean | null;
  kind?: string | null;
  /** The group roster: this list narrowed to one folder. */
  groupId?: number | null;
  sort?: string | null;
  descending?: boolean | null;
  page?: number | null;
  pageSize?: number | null;
}

/**
 * A named set of clients the agency works as one book, and the client who
 * referred them.
 *
 * Unlike a family this is a row, because it has the boundary a family lacks: it
 * is named, entered deliberately, holds a client at a time, and the operator can
 * say where it ends.
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
  headClientId?: number | null;
  notes?: string | null;
}

export interface GroupFilter {
  search?: string | null;
  includeArchived?: boolean | null;
  /** Groups this client referred: headship read from the referrer's end. */
  headClientId?: number | null;
  sort?: string | null;
  descending?: boolean | null;
  page?: number | null;
  pageSize?: number | null;
}

/** One client related to another, as a row of the family panel. */
export interface Relative {
  clientId: number;
  clientCode: string;
  fullName: string;
  relationship: string;
  /**
   * Which side of the stored edge this person sits on: true where they are the
   * client's `relationship`, false where the client is theirs. The word is never
   * inverted, because choosing between father and mother needs a gender the book
   * may not hold.
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
  relationship: string;
}

export interface RelationInput {
  clientId: number;
  relatedClientId: number;
  relationship: string;
}

/** What a client delete takes with it besides the client. */
export type DeleteScope = "linksOnly" | "immediateFamily";

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
  isActive?: boolean | null;
}

export interface Product {
  id: number;
  insurerId: number;
  insurerName: string;
  name: string;
  category: string;
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
  isActive?: boolean | null;
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
  category: string;
  status: string;
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
  /** The riders bought on top, split out of the one column that stores them. */
  riders: string[];
  planType: string | null;
  /** Years of cover bought in one go, 1 to `MAX_TERM`. */
  term: number | null;
  policyType: string | null;
  broker: string | null;
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
  riders?: string[] | null;
  planType?: string | null;
  term?: number | null;
  policyType?: string | null;
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
  search?: string | null;
  clientId?: number | null;
  insurerId?: number | null;
  productId?: number | null;
  categories?: string[] | null;
  statuses?: string[] | null;
  expiryFrom?: string | null;
  expiryTo?: string | null;
  expiringWithinDays?: number | null;
  minPremium?: number | null;
  maxPremium?: number | null;
  city?: string | null;
  latestOnly?: boolean | null;
  unrenewedOnly?: boolean | null;
  sort?: string | null;
  descending?: boolean | null;
  page?: number | null;
  pageSize?: number | null;
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
  /** field key -> header name */
  suggestedMapping: Record<string, string>;
  unmappedHeaders: string[];
}

export interface ImportOptions {
  path: string;
  sheet?: string | null;
  /** field key -> header name */
  mapping: Record<string, string>;
  defaultCategory?: string | null;
  /** Update clients and policies that already exist instead of skipping them. */
  updateExisting?: boolean | null;
  /** Validate and report without keeping any changes. */
  dryRun?: boolean | null;
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

export interface ExpiryBucket {
  label: string;
  count: number;
  premiumTotal: number;
}

export interface CategoryBreakdown {
  category: string;
  policyCount: number;
  premiumTotal: number;
  sumInsuredTotal: number;
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

/**
 * Attaching names the file to copy in; the bytes are read by the backend rather
 * than carried across the bridge.
 */
export interface DocumentInput {
  clientId: number;
  policyId?: number | null;
  title?: string | null;
  path: string;
}

export interface EmailTemplate {
  id: number;
  name: string;
  trigger: string;
  subject: string;
  bodyHtml: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** How many rules send this template; one in use cannot be deleted. */
  usedByRules: number;
}

export interface EmailTemplateInput {
  name: string;
  trigger: string;
  subject: string;
  bodyHtml: string;
  isActive?: boolean | null;
}

export interface Placeholder {
  name: string;
  description: string;
}

/** A rendered template, as it would arrive. */
export interface TemplatePreview {
  subject: string;
  html: string;
  text: string;
  /** Names in the template that no value will ever fill — almost always a typo. */
  unknownPlaceholders: string[];
  /** The policy the sample values came from, or null when the book is empty. */
  samplePolicy: string | null;
}

export interface ReminderRule {
  id: number;
  name: string;
  /** Days before expiry; negative means after it. */
  offsetDays: number;
  category: string | null;
  audience: string;
  channel: string;
  templateId: number | null;
  templateName: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface ReminderRuleInput {
  name: string;
  offsetDays: number;
  category?: string | null;
  audience: string;
  channel: string;
  templateId?: number | null;
  isActive?: boolean | null;
  sortOrder?: number | null;
}

/** One row of the outbox. */
export interface Notification {
  id: number;
  ruleId: number | null;
  ruleName: string | null;
  policyId: number | null;
  policyNumber: string | null;
  clientId: number | null;
  clientName: string | null;
  policyPeriod: string;
  audience: string;
  channel: string;
  toAddress: string | null;
  subject: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  scheduledFor: string;
  sentAt: string | null;
  createdAt: string;
}

export interface NotificationFilter {
  statuses?: string[] | null;
  clientId?: number | null;
  policyId?: number | null;
  search?: string | null;
  sort?: string | null;
  descending?: boolean | null;
  page?: number | null;
  pageSize?: number | null;
}

/** A reminder the sweep would queue, shown before anything is written. */
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
  channel: string;
  subject: string;
  /** Set when the reminder will not go out, saying why. */
  blockedReason: string | null;
}

export interface ReminderRun {
  dryRun: boolean;
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Reminders left queued because the daily cap was reached. */
  heldByCap: number;
  desktopAlerts: number;
  digestSent: boolean;
  issues: string[];
}

/** What the reminders screen needs to describe the current state in a sentence. */
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
