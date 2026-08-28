import { format, parseISO } from "date-fns";
import type {
  Category,
  ClientKind,
  CoverType,
  PlanType,
  PolicyStatus,
  PolicyType,
  Relationship,
  Rider,
  VehicleType,
} from "./types";

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const compact = new Intl.NumberFormat("en-IN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return currency.format(value);
}

/** Short form for tiles, where "₹1.2Cr" reads better than the full number. */
export function moneyCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  // The sign belongs outside the symbol: a loss is "-₹5L", never "₹-5L".
  const sign = value < 0 ? "-" : "";
  return `${sign}₹${compact.format(Math.abs(value))}`;
}

export function count(value: number): string {
  return new Intl.NumberFormat("en-IN").format(value);
}

/**
 * A counted noun that reads properly at one: "1 rule", "3 rules".
 *
 * Pass the plural where adding an "s" will not do — `plural(n, "policy",
 * "policies")`.
 */
export function plural(value: number, singular: string, many?: string): string {
  const word = value === 1 ? singular : (many ?? `${singular}s`);
  return `${count(value)} ${word}`;
}

export function fileSize(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  // Round to kilobytes first: a file a byte short of a megabyte should read
  // "1.0 MB" rather than the "1024 KB" that no file manager would show.
  const kilobytes = Math.max(1, Math.round(bytes / 1024));
  if (kilobytes >= 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${kilobytes} KB`;
}

export function date(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return format(parseISO(value), "dd MMM yyyy");
  } catch {
    return value;
  }
}

export function dateInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}

export function relativeDays(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `in ${days} days`;
}

export const categoryLabels: Record<Category, string> = {
  health: "Health",
  life: "Life",
  motor: "Motor",
  travel: "Travel / International",
  home: "Home",
  personal_accident: "Personal Accident",
  critical_illness: "Critical Illness",
  other: "Other",
};

export function categoryLabel(category: string): string {
  // An imported category is any string at all, and a plain object lookup would
  // answer "constructor" with a function that React refuses to draw.
  return Object.hasOwn(categoryLabels, category)
    ? categoryLabels[category as Category]
    : "Other";
}

/** The riders a health plan is sold with, in the order the insurer lists them. */
export const riderLabels: Record<Rider, string> = {
  safeguard: "Safeguard",
  safeguard_plus: "Safeguard +",
  pa_main_member: "PA to main member",
  future_ready: "Future Ready",
  fast_forwarded: "Fast Forwarded",
};

export const planTypeLabels: Record<PlanType, string> = {
  individual: "Individual",
  family_floater: "Family floater",
};

export const policyTypeLabels: Record<PolicyType, string> = {
  fresh: "Fresh",
  portability: "Portability",
  renewal: "Renewal",
};

/** What a motor policy is written on, in the words the agency's sheet uses. */
export const vehicleTypeLabels: Record<VehicleType, string> = {
  pvt_car: "Private car",
  goods_carrying: "Goods carrying vehicle",
  passenger: "Passenger vehicle",
  two_wheeler: "Two wheeler",
};

/** The covers a motor policy was sold with, as the schedule names them. */
export const coverTypeLabels: Record<CoverType, string> = {
  bundle_1_3: "Bundle (1+3)",
  bundle_3_3: "Bundle (3+3)",
  standalone_od: "Standalone OD",
  package: "Package",
  liability: "Liability",
};

export const statusLabels: Record<PolicyStatus, string> = {
  active: "Active",
  expired: "Expired",
  renewed: "Renewed",
  lapsed: "Lapsed",
  cancelled: "Cancelled",
};

/** Colour by urgency so a long list can be scanned rather than read. */
export function urgencyTone(days: number, status: PolicyStatus): "danger" | "warning" | "ok" | "muted" {
  if (status === "renewed" || status === "cancelled") return "muted";
  if (days < 0) return "danger";
  if (days <= 15) return "danger";
  if (days <= 45) return "warning";
  return "ok";
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * What a client is, in the words the screens use. "Company" covers the LLP and
 * the partnership firm too: the book only needs to know that the client is not a
 * person, because that is what changes the fields it asks for.
 */
export const clientKindLabels: Record<ClientKind, string> = {
  individual: "Individual",
  company: "Company",
};

export function clientKindLabel(kind: string): string {
  return Object.hasOwn(clientKindLabels, kind) ? clientKindLabels[kind as ClientKind] : "Individual";
}

export const relationshipLabels: Record<Relationship, string> = {
  spouse: "Spouse",
  son: "Son",
  daughter: "Daughter",
  father: "Father",
  mother: "Mother",
  brother: "Brother",
  sister: "Sister",
  other: "Related",
};

/**
 * How a relationship reads from the side you are standing on.
 *
 * A relationship is stored once, in the direction it was recorded, so the
 * father's page says "Son" and the son's page says "Son of" about the same row.
 * The word is never swapped for its opposite: choosing between father and mother
 * would need a gender, and a dependent entered as a name on a policy has none.
 */
export function relationshipLabel(relationship: string, outgoing: boolean): string {
  const word = Object.hasOwn(relationshipLabels, relationship)
    ? relationshipLabels[relationship as Relationship]
    : "Related";
  return outgoing ? word : `${word} of`;
}
