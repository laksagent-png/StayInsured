/**
 * The wire shapes, mirroring `src-tauri/src/models.rs`.
 *
 * These exist twice, once here and once in the app's `src/lib/types.ts`, and no
 * compiler checks that they agree — the interface is built separately and casts
 * whatever the bridge returns. That is the first and cheapest instance of the
 * drift this whole edition has to live with, so the rule is: when a model changes
 * in Rust, it changes in both places, and `tests/` is where the disagreement is
 * meant to surface.
 *
 * Only what is built so far appears here. The unbuilt commands in `commands.ts`
 * have no shapes yet on purpose, so nothing looks finished that is not.
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
