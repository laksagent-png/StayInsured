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
  activePolicies: number;
  totalPolicies: number;
  nextExpiry: string | null;
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
}

export interface ClientFilter {
  search?: string | null;
  city?: string | null;
  state?: string | null;
  category?: string | null;
  includeArchived?: boolean | null;
  missingEmail?: boolean | null;
  sort?: string | null;
  descending?: boolean | null;
  page?: number | null;
  pageSize?: number | null;
}

export interface InsuredMember {
  id: number;
  clientId: number;
  fullName: string;
  relationship: string;
  dateOfBirth: string | null;
  gender: string | null;
  notes: string | null;
}

export interface MemberInput {
  clientId: number;
  fullName: string;
  relationship?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  notes?: string | null;
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
  notes?: string | null;
  memberIds?: number[] | null;
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
