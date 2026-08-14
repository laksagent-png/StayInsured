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

export type Relationship =
  | "self"
  | "spouse"
  | "son"
  | "daughter"
  | "father"
  | "mother"
  | "other";

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
  remindersOptedOut?: boolean;
  notes?: string | null;
}

export interface ClientFilter {
  search?: string;
  city?: string;
  state?: string;
  category?: string;
  includeArchived?: boolean;
  missingEmail?: boolean;
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

export interface InsuredMember {
  id: number;
  clientId: number;
  fullName: string;
  relationship: Relationship;
  dateOfBirth: string | null;
  gender: string | null;
  notes: string | null;
}

export interface MemberInput {
  clientId: number;
  fullName: string;
  relationship?: string;
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
